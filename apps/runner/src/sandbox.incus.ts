import { createHash } from 'node:crypto'
import type { ExecRequest, ExecResult, SandboxDriver, SandboxLease, SandboxOperation, SandboxSpec } from './sandbox'
import { SandboxError } from './sandbox'

export type IncusInstance = {
  name: string
  status: string
  config: Record<string, string>
  storagePool?: string
}

export interface IncusGateway {
  list(): Promise<IncusInstance[]>
  launch(input: { name: string; image: string; config: Record<string, string> }, signal: AbortSignal): Promise<void>
  exec(name: string, request: ExecRequest, signal: AbortSignal): Promise<ExecResult>
  readFile(name: string, path: string): Promise<Uint8Array>
  writeFile(name: string, path: string, data: Uint8Array): Promise<void>
  stop(name: string): Promise<void>
  delete(name: string): Promise<void>
  volumeExists(pool: string, name: string): Promise<boolean>
}

const prefix = 'user.ornn.'

export function createIncusSandboxDriver(options: { gateway: IncusGateway; now?: () => string }): SandboxDriver {
  const now = options.now ?? (() => new Date().toISOString())
  const gateway = options.gateway

  async function find(name: string, operation: SandboxOperation): Promise<IncusInstance | undefined> {
    const instances = await incus(operation, 'none', () => gateway.list())
    return instances.find((instance) => instance.name === name)
  }

  async function owned(lease: SandboxLease, operation: SandboxOperation): Promise<IncusInstance | undefined> {
    const instance = await find(lease.providerRef, operation)
    if (instance && !owns(instance, lease)) throw conflict(operation)
    return instance
  }

  async function running(lease: SandboxLease, operation: 'exec' | 'read' | 'write' | 'collect'): Promise<void> {
    const instance = await owned(lease, operation)
    if (!instance) throw new SandboxError('not_found', operation, 'none', 'instance-absent')
    if (instance.status !== 'Running') throw new SandboxError('conflict', operation, 'none', 'instance-not-running')
  }

  async function verifyStorageAbsent(lease: SandboxLease, operation: 'inspect' | 'destroy'): Promise<void> {
    if (lease.volumeIds.length !== 1) throw new SandboxError('unavailable', operation, 'unknown', 'root-volume-identity-missing')
    const [pool, type, name] = lease.volumeIds[0]!.split('/')
    if (!pool || type !== 'container' || name !== lease.providerRef) throw conflict(operation)
    if (await incus(operation, 'none', () => gateway.volumeExists(pool, name))) {
      throw new SandboxError('unavailable', operation, 'unknown', 'root-volume-still-present')
    }
  }

  return {
    async create(spec, signal) {
      rejectAborted(signal, 'create')
      if (spec.command.length !== 0) throw new SandboxError('rejected', 'create', 'none', 'incus-does-not-use-start-command')
      if (!/^[0-9a-f]{64}$/i.test(spec.image) || !Number.isSafeInteger(spec.resources.memoryBytes) || spec.resources.memoryBytes <= 0 || !Number.isSafeInteger(spec.resources.pidsLimit) || spec.resources.pidsLimit <= 0) {
        throw new SandboxError('rejected', 'create', 'none', 'invalid-instance-spec')
      }
      const name = instanceName(spec)
      const current = await find(name, 'create')
      if (current) {
        if (!owns(current, spec)) throw conflict('create')
        return leaseFrom(spec, current)
      }
      await incus('create', 'unknown', () => gateway.launch({
        name,
        image: spec.image,
        config: {
          ...metadata(spec),
          'limits.memory': String(spec.resources.memoryBytes),
          'limits.processes': String(spec.resources.pidsLimit),
          'security.privileged': 'false',
        },
      }, signal))
      const launched = await find(name, 'create')
      if (!launched) throw new SandboxError('unavailable', 'create', 'unknown', 'launched-instance-absent')
      if (!owns(launched, spec)) throw conflict('create')
      return leaseFrom(spec, launched)
    },

    async discover(scope) {
      const instances = await incus('discover', 'none', () => gateway.list())
      return instances.flatMap((instance) => {
        if (instance.config[`${prefix}managed`] !== 'true' || instance.config[`${prefix}runner-id`] !== scope.runnerId) return []
        const lease = leaseFromInstance(instance)
        return lease ? [lease] : []
      })
    },

    async inspect(lease) {
      const instance = await owned(lease, 'inspect')
      if (!instance) {
        await verifyStorageAbsent(lease, 'inspect')
        return { state: 'absent', observedAt: now() }
      }
      const phase = instance.status === 'Running' ? 'ready' : instance.status === 'Stopped' ? 'stopped' : 'faulted'
      return { state: 'present', phase, processes: phase === 'ready' ? 'running' : phase === 'stopped' ? 'stopped' : 'unknown', specFingerprint: lease.specFingerprint, observedAt: now() }
    },

    async exec(lease, request, signal) {
      rejectAborted(signal, 'exec')
      if (!Array.isArray(request.command) || request.command.length === 0 || !request.command.every((part) => typeof part === 'string')) {
        throw new SandboxError('rejected', 'exec', 'none', 'invalid-command')
      }
      await running(lease, 'exec')
      return incus('exec', 'unknown', () => gateway.exec(lease.providerRef, request, signal))
    },

    async readFile(lease, path) {
      assertPath(path, 'read')
      await running(lease, 'read')
      return incus('read', 'none', () => gateway.readFile(lease.providerRef, path))
    },

    async writeFile(lease, path, data) {
      assertPath(path, 'write')
      await running(lease, 'write')
      await incus('write', 'unknown', () => gateway.writeFile(lease.providerRef, path, data))
    },

    async collectArtifacts(lease, paths) {
      const artifacts = new Map<string, Uint8Array>()
      for (const path of paths) {
        assertPath(path, 'collect')
        await running(lease, 'collect')
        artifacts.set(path, await incus('collect', 'none', () => gateway.readFile(lease.providerRef, path)))
      }
      return artifacts
    },

    async terminate(lease) {
      const instance = await owned(lease, 'terminate')
      if (!instance || instance.status === 'Stopped') return
      await incus('terminate', 'unknown', () => gateway.stop(lease.providerRef))
      const stopped = await owned(lease, 'terminate')
      if (stopped && stopped.status !== 'Stopped') throw new SandboxError('unavailable', 'terminate', 'unknown', 'instance-still-running')
    },

    async destroy(lease) {
      const instance = await owned(lease, 'destroy')
      if (instance) await incus('destroy', 'unknown', () => gateway.delete(lease.providerRef))
      if (await find(lease.providerRef, 'destroy')) throw new SandboxError('unavailable', 'destroy', 'unknown', 'owned-instance-still-present')
      await verifyStorageAbsent(lease, 'destroy')
    },
  }
}

function instanceName(lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation'>): string {
  const hash = createHash('sha256').update(JSON.stringify([lease.runnerId, lease.sandboxId, lease.generation])).digest('hex')
  return `ornn-${hash.slice(0, 40)}`
}

function metadata(lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation' | 'specFingerprint' | 'createdAt' | 'expiresAt'>): Record<string, string> {
  return {
    [`${prefix}managed`]: 'true',
    [`${prefix}runner-id`]: lease.runnerId,
    [`${prefix}sandbox-id`]: lease.sandboxId,
    [`${prefix}generation`]: String(lease.generation),
    [`${prefix}spec-fingerprint`]: lease.specFingerprint,
    [`${prefix}created-at`]: lease.createdAt,
    [`${prefix}expires-at`]: lease.expiresAt,
  }
}

function owns(instance: IncusInstance, lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation' | 'specFingerprint'>): boolean {
  return instance.config[`${prefix}managed`] === 'true'
    && instance.config[`${prefix}runner-id`] === lease.runnerId
    && instance.config[`${prefix}sandbox-id`] === lease.sandboxId
    && instance.config[`${prefix}generation`] === String(lease.generation)
    && instance.config[`${prefix}spec-fingerprint`] === lease.specFingerprint
}

function leaseFrom(spec: SandboxSpec, instance: IncusInstance): SandboxLease {
  const providerRef = instance.name
  if (!instance.storagePool) throw new SandboxError('unavailable', 'create', 'unknown', 'root-storage-pool-missing')
  return { sandboxId: spec.sandboxId, generation: spec.generation, runnerId: spec.runnerId, providerRef, specFingerprint: spec.specFingerprint, createdAt: spec.createdAt, expiresAt: spec.expiresAt, volumeIds: [`${instance.storagePool}/container/${providerRef}`] }
}

function leaseFromInstance(instance: IncusInstance): SandboxLease | undefined {
  const config = instance.config
  const generation = Number(config[`${prefix}generation`])
  if (!config[`${prefix}sandbox-id`] || !config[`${prefix}runner-id`] || !config[`${prefix}spec-fingerprint`] || !Number.isSafeInteger(generation) || generation < 1) return undefined
  if (!instance.storagePool) throw new SandboxError('unavailable', 'discover', 'none', 'root-storage-pool-missing')
  return {
    sandboxId: config[`${prefix}sandbox-id`], runnerId: config[`${prefix}runner-id`], generation,
    providerRef: instance.name, specFingerprint: config[`${prefix}spec-fingerprint`],
    createdAt: config[`${prefix}created-at`] ?? '', expiresAt: config[`${prefix}expires-at`] ?? '', volumeIds: [`${instance.storagePool}/container/${instance.name}`],
  }
}

function assertPath(path: string, operation: 'read' | 'write' | 'collect'): void {
  if (!path.startsWith('/workspace/') || path.includes('/../') || path.endsWith('/..')) throw new SandboxError('rejected', operation, 'none', 'path-outside-workspace')
}

function rejectAborted(signal: AbortSignal, operation: 'create' | 'exec'): void {
  if (signal.aborted) throw new SandboxError('deadline_exceeded', operation, 'none', 'aborted-before-start')
}

function conflict(operation: SandboxOperation): SandboxError {
  return new SandboxError('conflict', operation, 'none', 'ownership-mismatch')
}

async function incus<T>(operation: SandboxOperation, effect: 'none' | 'unknown', call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof SandboxError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new SandboxError('deadline_exceeded', operation, effect, 'operation-aborted')
    throw new SandboxError('unavailable', operation, effect, error instanceof Error ? error.name : 'incus-error')
  }
}

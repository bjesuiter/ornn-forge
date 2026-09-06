export type SandboxErrorCode =
  | 'rejected'
  | 'not_found'
  | 'conflict'
  | 'resource_exhausted'
  | 'unavailable'
  | 'deadline_exceeded'
  | 'internal'

export type SandboxOperation = 'create' | 'discover' | 'inspect' | 'exec' | 'read' | 'write' | 'collect' | 'terminate' | 'destroy'
export type OperationEffect = 'none' | 'unknown'

export class SandboxError extends Error {
  readonly schemaVersion = 1
  constructor(
    readonly code: SandboxErrorCode,
    readonly operation: SandboxOperation,
    readonly effect: OperationEffect,
    readonly diagnosticRef: string,
  ) {
    super(`${operation} failed: ${code}`)
  }
}

export type SandboxLease = {
  sandboxId: string
  generation: number
  runnerId: string
  providerRef: string
  specFingerprint: string
  createdAt: string
  expiresAt: string
  volumeIds: string[]
}

export type SandboxSpec = Omit<SandboxLease, 'providerRef' | 'volumeIds'> & {
  image: string
  command: string[]
  resources: { memoryBytes: number; pidsLimit: number }
}

export type SandboxObservation =
  | { state: 'absent'; observedAt: string }
  | { state: 'present'; phase: 'starting' | 'ready' | 'stopped' | 'removing' | 'faulted'; processes: 'running' | 'stopped' | 'unknown'; specFingerprint: string; observedAt: string }

export type ExecRequest = { command: string[]; cwd?: string; timeoutMs?: number }
export type ExecResult = { exitCode: number; stdout: Uint8Array; stderr: Uint8Array }
export type TerminationReason = 'completed' | 'cancelled' | 'failed' | 'timeout'

export interface SandboxDriver {
  create(spec: SandboxSpec, signal: AbortSignal): Promise<SandboxLease>
  discover(scope: { runnerId: string }): Promise<readonly SandboxLease[]>
  inspect(lease: SandboxLease): Promise<SandboxObservation>
  exec(lease: SandboxLease, request: ExecRequest, signal: AbortSignal): Promise<ExecResult>
  readFile(lease: SandboxLease, path: string): Promise<Uint8Array>
  writeFile(lease: SandboxLease, path: string, data: Uint8Array): Promise<void>
  collectArtifacts(lease: SandboxLease, paths: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>>
  terminate(lease: SandboxLease, reason: TerminationReason): Promise<void>
  destroy(lease: SandboxLease): Promise<void>
}

type DockerContainer = {
  id: string
  labels: Record<string, string>
  state: 'running' | 'created' | 'exited' | 'removing' | 'dead'
  processes?: 'running' | 'stopped' | 'unknown'
  volumes: string[]
}

type DockerCreate = {
  name: string
  image: string
  command: string[]
  labels: Record<string, string>
  network: 'none'
  restart: 'no'
  init: true
  autoRemove: false
  resources: SandboxSpec['resources']
}

export interface DockerGateway {
  list(labels: readonly string[]): Promise<DockerContainer[]>
  create(input: DockerCreate): Promise<{ id: string; volumes: string[] }>
  inspect(id: string): Promise<DockerContainer | undefined>
  exec(id: string, command: string[], options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<ExecResult>
  copyTo(id: string, path: string, data: Uint8Array): Promise<void>
  copyFrom(id: string, path: string): Promise<Uint8Array>
  stop(id: string, timeoutSeconds: number): Promise<void>
  remove(id: string, volumes: boolean): Promise<void>
  inspectVolume(id: string): Promise<boolean | undefined>
}

export function createDockerSandboxDriver(options: { gateway: DockerGateway; now?: () => string }): SandboxDriver {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async create(spec, signal) {
      rejectAborted(signal, 'create')
      const labels = ownershipLabels(spec)
      const found = await docker('create', 'none', () => options.gateway.list(labelFilters(labels)))
      if (found.length > 1 || found.some((container) => !owns(container, spec))) throw conflict('create')
      if (found.length === 1) {
        const current = await docker('create', 'none', () => options.gateway.inspect(found[0].id))
        if (!current) throw new SandboxError('unavailable', 'create', 'unknown', 'owned-container-disappeared')
        return leaseFrom(spec, current.id, current.volumes)
      }
      const created = await docker('create', 'unknown', () => options.gateway.create({
        name: containerName(spec), image: requireDigest(spec.image), command: spec.command, labels,
        network: 'none', restart: 'no', init: true, autoRemove: false, resources: spec.resources,
      }))
      return leaseFrom(spec, created.id, created.volumes)
    },

    async discover(scope) {
      const containers = await docker('discover', 'none', () => options.gateway.list(['io.ornn.managed=true', `io.ornn.runner-id=${scope.runnerId}`]))
      const inspected = await Promise.all(containers.map(async (container) => {
        const current = await docker('discover', 'none', () => options.gateway.inspect(container.id))
        return current ? leaseFromLabels(current) : undefined
      }))
      return inspected.filter((lease): lease is SandboxLease => lease !== undefined)
    },

    async inspect(lease) {
      const container = await docker('inspect', 'none', () => options.gateway.inspect(lease.providerRef))
      if (!container) return { state: 'absent', observedAt: now() }
      assertOwned(container, lease, 'inspect')
      return {
        state: 'present',
        phase: container.state === 'running' ? 'ready' : container.state === 'exited' ? 'stopped' : container.state === 'removing' ? 'removing' : 'faulted',
        processes: container.processes ?? (container.state === 'running' ? 'running' : 'stopped'),
        specFingerprint: lease.specFingerprint,
        observedAt: now(),
      }
    },

    async exec(lease, request, signal) {
      rejectAborted(signal, 'exec')
      await requirePresent(options.gateway, lease, 'exec')
      if (!Array.isArray(request.command) || request.command.length === 0 || !request.command.every((part) => typeof part === 'string')) {
        throw new SandboxError('rejected', 'exec', 'none', 'invalid-command')
      }
      return docker('exec', 'unknown', () => options.gateway.exec(lease.providerRef, request.command, { cwd: request.cwd, timeoutMs: request.timeoutMs, signal }))
    },

    async readFile(lease, path) {
      assertPath(path, 'read')
      await requirePresent(options.gateway, lease, 'read')
      return docker('read', 'none', () => options.gateway.copyFrom(lease.providerRef, path))
    },

    async writeFile(lease, path, data) {
      assertPath(path, 'write')
      await requirePresent(options.gateway, lease, 'write')
      await docker('write', 'unknown', () => options.gateway.copyTo(lease.providerRef, path, data))
    },

    async collectArtifacts(lease, paths) {
      const artifacts = new Map<string, Uint8Array>()
      for (const path of paths) {
        assertPath(path, 'collect')
        artifacts.set(path, await docker('collect', 'none', () => options.gateway.copyFrom(lease.providerRef, path)))
      }
      return artifacts
    },

    async terminate(lease) {
      const current = await docker('terminate', 'none', () => options.gateway.inspect(lease.providerRef))
      if (!current) return
      assertOwned(current, lease, 'terminate')
      await docker('terminate', 'unknown', () => options.gateway.stop(lease.providerRef, 5))
      const stopped = await docker('terminate', 'none', () => options.gateway.inspect(lease.providerRef))
      if (stopped && (stopped.state === 'running' || stopped.processes === 'running')) throw new SandboxError('unavailable', 'terminate', 'unknown', 'container-still-running')
    },

    async destroy(lease) {
      const current = await docker('destroy', 'none', () => options.gateway.inspect(lease.providerRef))
      if (current) {
        assertOwned(current, lease, 'destroy')
        await docker('destroy', 'unknown', () => options.gateway.remove(lease.providerRef, true))
      }
      const exact = await docker('destroy', 'none', () => options.gateway.inspect(lease.providerRef))
      const matches = await docker('destroy', 'none', () => options.gateway.list(labelFilters(ownershipLabels(lease))))
      const volumeIds = [...new Set([...lease.volumeIds, ...(current?.volumes ?? [])])]
      const volumes = await Promise.all(volumeIds.map((id) => docker('destroy', 'none', () => options.gateway.inspectVolume(id))))
      if (exact || matches.length > 0 || volumes.some((volume) => volume !== undefined)) {
        throw new SandboxError('unavailable', 'destroy', 'unknown', 'owned-resource-still-present')
      }
    },
  }
}

function requireDigest(image: string): string {
  if (!/^[^\s]+@sha256:[0-9a-f]{64}$/i.test(image)) throw new SandboxError('rejected', 'create', 'none', 'image-must-be-digest-pinned')
  return image
}

function assertPath(path: string, operation: 'read' | 'write' | 'collect'): void {
  if (!path.startsWith('/workspace/') || path.includes('/../') || path.endsWith('/..')) {
    throw new SandboxError('rejected', operation, 'none', 'path-outside-workspace')
  }
}

function rejectAborted(signal: AbortSignal, operation: 'create' | 'exec'): void {
  if (signal.aborted) throw new SandboxError('deadline_exceeded', operation, 'none', 'aborted-before-start')
}

async function requirePresent(gateway: DockerGateway, lease: SandboxLease, operation: 'exec' | 'read' | 'write'): Promise<void> {
  const container = await docker(operation, 'none', () => gateway.inspect(lease.providerRef))
  if (!container) throw new SandboxError('not_found', operation, 'none', 'container-absent')
  assertOwned(container, lease, operation)
  if (container.state !== 'running') throw new SandboxError('conflict', operation, 'none', 'container-not-running')
}

async function docker<T>(operation: SandboxOperation, effect: OperationEffect, operationCall: () => Promise<T>): Promise<T> {
  try {
    return await operationCall()
  } catch (error) {
    if (error instanceof SandboxError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new SandboxError('deadline_exceeded', operation, effect, 'operation-aborted')
    throw new SandboxError('unavailable', operation, effect, error instanceof Error ? error.name : 'docker-error')
  }
}

function assertOwned(container: DockerContainer, lease: SandboxLease, operation: SandboxOperation): void {
  if (!owns(container, lease)) throw conflict(operation)
}

function conflict(operation: SandboxOperation): SandboxError {
  return new SandboxError('conflict', operation, 'none', 'ownership-mismatch')
}

function owns(container: DockerContainer, lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation' | 'specFingerprint'>): boolean {
  return Object.entries(ownershipLabels(lease)).every(([key, value]) => container.labels[key] === value)
}

function leaseFrom(spec: SandboxSpec, providerRef: string, volumeIds: string[]): SandboxLease {
  return {
    sandboxId: spec.sandboxId,
    generation: spec.generation,
    runnerId: spec.runnerId,
    providerRef,
    specFingerprint: spec.specFingerprint,
    createdAt: spec.createdAt,
    expiresAt: spec.expiresAt,
    volumeIds,
  }
}

function leaseFromLabels(container: DockerContainer): SandboxLease | undefined {
  const labels = container.labels
  const generation = Number(labels['io.ornn.generation'])
  if (labels['io.ornn.managed'] !== 'true' || !labels['io.ornn.runner-id'] || !labels['io.ornn.sandbox-id'] || !labels['io.ornn.spec-fingerprint'] || !Number.isSafeInteger(generation) || generation < 1) return undefined
  return {
    sandboxId: labels['io.ornn.sandbox-id'], generation, runnerId: labels['io.ornn.runner-id'], providerRef: container.id,
    specFingerprint: labels['io.ornn.spec-fingerprint'], createdAt: '', expiresAt: '', volumeIds: container.volumes,
  }
}

function ownershipLabels(lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation' | 'specFingerprint'>): Record<string, string> {
  return {
    'io.ornn.managed': 'true',
    'io.ornn.runner-id': lease.runnerId,
    'io.ornn.sandbox-id': lease.sandboxId,
    'io.ornn.generation': String(lease.generation),
    'io.ornn.spec-fingerprint': lease.specFingerprint,
  }
}

function labelFilters(labels: Record<string, string>): string[] {
  return Object.entries(labels).map(([key, value]) => `${key}=${value}`)
}

function containerName(lease: Pick<SandboxLease, 'runnerId' | 'sandboxId' | 'generation'>): string {
  return `ornn-${lease.runnerId}-${lease.sandboxId}-${lease.generation}`
}

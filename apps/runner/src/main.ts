import {
  envelope,
  parseRunnerEnvelope,
  type LeaseGrant,
  type RunnerCommandJournalEntry,
  type RunnerLeaseClaim,
  type RunnerProfile,
} from '@ornn-forge/protocol'
import { unlink } from 'node:fs/promises'
import { createDockerCliGateway } from './docker-gateway'
import { createRepositoryWorkspaceImporter, type RepositoryWorkspaceImporter } from './repository-workspace'
import { createDockerSandboxDriver, type SandboxDriver } from './sandbox'

export type RemoteRunnerConfig = {
  controlPlaneUrl: string
  runnerId: string
  credential: string
  profile: RunnerProfile
  sandboxImage?: string
}

export type RunnerControlState = {
  activeLeases: RunnerLeaseClaim[]
  commandJournal: RunnerCommandJournalEntry[]
}

export type RunnerStateStore = {
  load(): Promise<RunnerControlState>
  save(state: RunnerControlState): Promise<void>
  markSynchronized(): Promise<void>
  clearSynchronization?(): Promise<void>
}

export type ControlSocket = {
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void
  close(): void
  send(message: string): void
}

export type WebSocketFactory = (url: string, headers: Record<string, string>) => ControlSocket

type Sleep = (milliseconds: number) => Promise<void>
export type LeaseExecutor = (lease: LeaseGrant, signal: AbortSignal) => Promise<{ artifact: ReturnType<typeof fixtureArtifact>; cleanupStatus: 'verified' | 'failed' }>

export async function remoteRunnerConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  readCredentialFile: (path: string) => Promise<string> = (path) => Bun.file(path).text(),
): Promise<RemoteRunnerConfig> {
  const controlPlaneUrl = environment.ORNN_CONTROL_PLANE_URL
  const runnerId = environment.ORNN_RUNNER_ID
  const credential = environment.ORNN_RUNNER_CREDENTIAL
    ?? (environment.ORNN_RUNNER_CREDENTIAL_FILE
      ? (await readCredentialFile(environment.ORNN_RUNNER_CREDENTIAL_FILE)).trim()
      : undefined)

  if (!controlPlaneUrl || !runnerId || !credential) {
    throw new Error('ORNN_CONTROL_PLANE_URL, ORNN_RUNNER_ID, and ORNN_RUNNER_CREDENTIAL or ORNN_RUNNER_CREDENTIAL_FILE are required')
  }

  const executor = environment.ORNN_RUNNER_EXECUTOR ?? 'docker'
  const sandboxImage = environment.ORNN_SANDBOX_IMAGE
  if (executor === 'docker' && !sandboxImage) throw new Error('ORNN_SANDBOX_IMAGE is required when ORNN_RUNNER_EXECUTOR is docker')
  return {
    controlPlaneUrl,
    runnerId,
    credential,
    profile: {
      release: environment.ORNN_RUNNER_RELEASE ?? 'development',
      platform: process.platform,
      architecture: process.arch,
      runtime: `Bun ${Bun.version}`,
      executor,
      capacity: runnerCapacity(environment.ORNN_RUNNER_CAPACITY),
      logicalCpuCount: Math.max(1, navigator.hardwareConcurrency ?? 1),
      memoryLimitBytes: 128 * 1024 * 1024,
    },
    sandboxImage,
  }
}

export async function runRemoteRunner(
  config: RemoteRunnerConfig,
  options: {
    stateStore?: RunnerStateStore
    createSocket?: WebSocketFactory
    sleep?: Sleep
    random?: () => number
    signal?: AbortSignal
    onSynchronized?: () => void
    executeLease?: LeaseExecutor
  } = {},
): Promise<void> {
  const stateStore = options.stateStore ?? fileRunnerStateStore()
  const createSocket = options.createSocket ?? bunWebSocket
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const random = options.random ?? Math.random
  await stateStore.clearSynchronization?.()
  let attempt = 0
  while (!options.signal?.aborted) {
    try {
      const connection = await openControlConnection(config, stateStore, createSocket, options.onSynchronized, options.executeLease ?? defaultLeaseExecutor(config))
      attempt = 0
      await connection.closed
    } catch {
      attempt += 1
    }
    if (!options.signal?.aborted) await sleep(reconnectDelay(attempt, random))
  }
}

function defaultLeaseExecutor(config: RemoteRunnerConfig): LeaseExecutor {
  if (config.profile.executor !== 'docker') return async () => ({ artifact: fixtureArtifact(), cleanupStatus: 'verified' })
  if (!config.sandboxImage) throw new Error('Docker Runner is missing its digest-pinned sandbox image')
  const driver = createDockerSandboxDriver({ gateway: createDockerCliGateway() })
  const importWorkspace = createRepositoryWorkspaceImporter()
  return (lease, signal) => executeDockerFixture({ runnerId: config.runnerId, image: config.sandboxImage as string, driver, importWorkspace }, lease, signal)
}

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const cappedAttempt = Math.max(0, Math.min(attempt, 6))
  const base = Math.min(30_000, 250 * 2 ** cappedAttempt)
  return Math.round(base * (0.75 + Math.max(0, Math.min(random(), 1)) * 0.5))
}

async function openControlConnection(
  config: RemoteRunnerConfig,
  stateStore: RunnerStateStore,
  createSocket: WebSocketFactory,
  onSynchronized: (() => void) | undefined,
  executeLease: LeaseExecutor,
): Promise<{ closed: Promise<void> }> {
  const state = await stateStore.load()
  const socket = createSocket(controlSocketUrl(config.controlPlaneUrl), {
    authorization: `Bearer ${config.credential}`,
    'x-ornn-runner-id': config.runnerId,
  })
  const instanceId = opaqueInstanceId()
  let synchronized = false
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let resolveClosed: () => void = () => {}
  let resolveSynchronized: () => void = () => {}
  let rejectSynchronized: (error: Error) => void = () => {}
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  const synchronizedPromise = new Promise<void>((resolve, reject) => {
    resolveSynchronized = resolve
    rejectSynchronized = reject
  })

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify(envelope('runner.synchronize', {
      runnerId: config.runnerId,
      instanceId,
      profile: config.profile,
      activeLeases: state.activeLeases,
      commandJournal: state.commandJournal,
    })))
  })
  socket.addEventListener('message', (event) => {
    void handleControlMessage(event.data, { config, socket, state, stateStore, executeLease, markSynchronized: async () => {
      synchronized = true
      await stateStore.markSynchronized()
      const heartbeat = () => socket.send(JSON.stringify(envelope('runner.heartbeat', { runnerId: config.runnerId, instanceId })))
      heartbeat()
      heartbeatTimer = setInterval(heartbeat, 30_000)
      onSynchronized?.()
      resolveSynchronized()
    } }).catch((error) => {
      socket.send(JSON.stringify(envelope('runner.report', {
        runnerId: config.runnerId,
        fault: { code: error instanceof Error ? 'runner.control_message_failed' : 'runner.unknown_failure' },
      })))
      socket.close()
    })
  })
  socket.addEventListener('error', () => socket.close())
  socket.addEventListener('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (!synchronized) rejectSynchronized(new Error('Runner control connection closed before synchronization'))
    resolveClosed()
  })

  await synchronizedPromise
  return { closed }
}

async function handleControlMessage(
  raw: unknown,
  context: {
    config: RemoteRunnerConfig
    socket: ControlSocket
    state: RunnerControlState
    stateStore: RunnerStateStore
    executeLease: LeaseExecutor
    markSynchronized: () => Promise<void>
  },
): Promise<void> {
  const parsed = parseRunnerEnvelope(parseJson(raw))
  if (!parsed.ok) throw new Error(`Control protocol rejected: ${parsed.code}`)
  if (parsed.value.type === 'protocol.unsupported') throw new Error('Control plane rejected the Runner protocol major')
  if (parsed.value.type === 'runner.synchronized') {
    const activeLeases = Array.isArray(parsed.value.payload.activeLeases) ? parsed.value.payload.activeLeases : []
    const acceptedJobs = new Set(activeLeases.filter((lease) => lease && typeof lease === 'object' && (lease as { accepted?: unknown }).accepted === true)
      .map((lease) => (lease as { jobId?: unknown }).jobId).filter((jobId): jobId is string => typeof jobId === 'string'))
    context.state.activeLeases = context.state.activeLeases.filter((lease) => acceptedJobs.has(lease.jobId))
    const commands = Array.isArray(parsed.value.payload.pendingCommands) ? parsed.value.payload.pendingCommands : []
    for (const command of commands) {
      if (!command || typeof command !== 'object') continue
      const { commandId } = command as { commandId?: unknown }
      if (typeof commandId !== 'string' || context.state.commandJournal.some((entry) => entry.commandId === commandId)) continue
      context.state.commandJournal.push({ commandId, state: 'accepted' })
      context.socket.send(JSON.stringify(envelope('runner.command.acknowledged', {
        runnerId: context.config.runnerId, commandId, state: 'accepted',
      })))
    }
    await context.stateStore.save(context.state)
    await context.markSynchronized()
    return
  }
  if (parsed.value.type === 'runner.lease') {
    const lease = parsed.value.payload as LeaseGrant
    if (!isLeaseGrant(lease)) throw new Error('Control plane sent an invalid lease')
    if (!context.state.activeLeases.some((active) => active.jobId === lease.jobId)) {
      context.state.activeLeases.push({ jobId: lease.jobId, leaseToken: lease.leaseToken })
      await context.stateStore.save(context.state)
    }
    context.socket.send(JSON.stringify(envelope('lease.accept', leaseScope(context.config, lease))))
    context.socket.send(JSON.stringify(envelope('lease.heartbeat', leaseScope(context.config, lease))))
    const completion = await context.executeLease(lease, new AbortController().signal)
    context.socket.send(JSON.stringify(envelope('lease.result', { ...leaseScope(context.config, lease), ...completion })))
  }
}

function fileRunnerStateStore(
  statePath = process.env.ORNN_RUNNER_STATE_PATH ?? '/var/lib/ornn-runner/control-state.json',
  readyPath = process.env.ORNN_RUNNER_READY_PATH ?? '/var/lib/ornn-runner/control-connection.ready',
): RunnerStateStore {
  return {
    async load() {
      const text = await Bun.file(statePath).text().catch(() => '')
      if (!text) return { activeLeases: [], commandJournal: [] }
      try {
        const value = JSON.parse(text)
        return isRunnerControlState(value) ? value : { activeLeases: [], commandJournal: [] }
      } catch {
        return { activeLeases: [], commandJournal: [] }
      }
    },
    async save(state) {
      await Bun.write(statePath, JSON.stringify(state))
    },
    async markSynchronized() {
      await Bun.write(readyPath, `${new Date().toISOString()}\n`)
    },
    async clearSynchronization() {
      await unlink(readyPath).catch((error: unknown) => {
        if ((error as { code?: unknown }).code !== 'ENOENT') throw error
      })
    },
  }
}

function bunWebSocket(url: string, headers: Record<string, string>): ControlSocket {
  return new WebSocket(url, { headers } as unknown as string[]) as unknown as ControlSocket
}

function controlSocketUrl(controlPlaneUrl: string): string {
  const url = new URL('/api/v1/runner/connect', controlPlaneUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function reconnectStateEntry(value: unknown): value is RunnerCommandJournalEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { commandId?: unknown }).commandId === 'string'
    && ['accepted', 'completed', 'failed'].includes(String((value as { state?: unknown }).state))
}

function isRunnerControlState(value: unknown): value is RunnerControlState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as { activeLeases?: unknown; commandJournal?: unknown }
  return Array.isArray(state.activeLeases) && state.activeLeases.every((lease) =>
    typeof lease === 'object' && lease !== null && typeof (lease as { jobId?: unknown }).jobId === 'string' && typeof (lease as { leaseToken?: unknown }).leaseToken === 'string',
  ) && Array.isArray(state.commandJournal) && state.commandJournal.every(reconnectStateEntry)
}

function isLeaseGrant(value: unknown): value is LeaseGrant {
  return typeof value === 'object' && value !== null && typeof (value as { jobId?: unknown }).jobId === 'string'
    && typeof (value as { leaseToken?: unknown }).leaseToken === 'string'
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Control plane sent a non-text message')
  return JSON.parse(value)
}

function leaseScope(config: RemoteRunnerConfig, lease: LeaseGrant) {
  return { runnerId: config.runnerId, jobId: lease.jobId, leaseToken: lease.leaseToken }
}

function fixtureArtifact() {
  return {
    schemaVersion: 1 as const,
    kind: 'plan' as const,
    summary: 'Fixture analysis complete',
    details: 'The deterministic Remote Runner fixture completed through the production control connection.',
  }
}

export async function executeDockerFixture(
  options: { runnerId: string; image: string; driver: SandboxDriver; now?: () => string; importWorkspace?: RepositoryWorkspaceImporter },
  lease: LeaseGrant,
  signal: AbortSignal,
): Promise<{ artifact: ReturnType<typeof fixtureArtifact>; cleanupStatus: 'verified' | 'failed' }> {
  const createdAt = (options.now ?? (() => new Date().toISOString()))()
  const sandbox = await options.driver.create({
    sandboxId: `sandbox_v1_${lease.jobId}-${lease.generation}`,
    generation: lease.generation,
    runnerId: options.runnerId,
    specFingerprint: `docker-fixture-v1:${options.image}`,
    createdAt,
    expiresAt: lease.expiresAt,
    image: options.image,
    command: ['sh', '-ceu', 'mkdir -p /workspace && sleep infinity'],
    resources: { memoryBytes: 128 * 1024 * 1024, pidsLimit: 64 },
  }, signal)
  try {
    if (!lease.checkout) throw new Error('Docker execution requires a pinned repository checkout')
    if (!options.importWorkspace) throw new Error('Docker execution is missing its repository workspace importer')
    await options.importWorkspace(lease.checkout, sandbox, options.driver, signal)
    const result = await options.driver.exec(sandbox, { command: ['sh', '-ceu', "printf '{\"kind\":\"plan\"}\\n' > /workspace/fixture-artifact.json"] }, signal)
    if (result.exitCode !== 0) throw new Error('Docker fixture command failed')
    const files = await options.driver.collectArtifacts(sandbox, ['/workspace/fixture-artifact.json'])
    if (new TextDecoder().decode(files.get('/workspace/fixture-artifact.json')) !== '{"kind":"plan"}\n') throw new Error('Docker fixture artifact was invalid')
    const artifact = fixtureArtifact()
    try {
      await options.driver.terminate(sandbox, 'completed').catch(() => undefined)
      await options.driver.destroy(sandbox)
      return { artifact, cleanupStatus: 'verified' }
    } catch {
      return { artifact, cleanupStatus: 'failed' }
    }
  } catch (error) {
    await options.driver.terminate(sandbox, 'failed').catch(() => undefined)
    await options.driver.destroy(sandbox).catch(() => undefined)
    throw error
  }
}

function opaqueInstanceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `instance_v1_${Buffer.from(bytes).toString('base64url')}`
}

function runnerCapacity(value: string | undefined): number {
  if (value === undefined) return 1
  const capacity = Number(value)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('ORNN_RUNNER_CAPACITY must be an integer between 1 and 32')
  return capacity
}

if (import.meta.main) {
  await runRemoteRunner(await remoteRunnerConfigFromEnvironment())
}

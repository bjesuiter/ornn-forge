import {
  envelope,
  parseRunnerEnvelope,
  type LeaseGrant,
  type RunnerCommandJournalEntry,
  type RunnerLeaseClaim,
  type RunnerLeaseStage,
  type RunnerForceQuitCommand,
  type RunnerProfile,
} from '@ornn-forge/protocol'
import { readFile, unlink } from 'node:fs/promises'
import { createDockerCliGateway } from './docker-gateway'
import { createIncusCliGateway } from './incus-gateway'
import { createRepositoryWorkspaceCloner, createRepositoryWorkspaceImporter, type RepositoryWorkspaceImporter } from './repository-workspace'
import { createDockerSandboxDriver, type SandboxDriver, type SandboxLease } from './sandbox'
import { createIncusSandboxDriver } from './sandbox.incus'

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
  sandboxes: RunnerSandboxRecord[]
}

export type RunnerSandboxRecord = { jobId?: string; leaseToken?: string; sandbox: SandboxLease }

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
type SandboxLifecycle = { created(sandbox: SandboxLease): Promise<void>; cleaned(sandbox: SandboxLease): Promise<void>; observed(stage: RunnerLeaseStage, faultCode?: string): void }
export type LeaseExecutor = (lease: LeaseGrant, signal: AbortSignal, lifecycle: SandboxLifecycle) => Promise<{ artifact: ReturnType<typeof fixtureArtifact>; cleanupStatus: 'verified' | 'failed' }>
type ActiveExecution = { controller: AbortController; finished: Promise<void> }

export async function remoteRunnerConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  readCredentialFile: (path: string) => Promise<string> = (path) => Bun.file(path).text(),
  readHardwareModel: () => Promise<string> = hardwareModelFromSystem,
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
  if ((executor === 'docker' || executor === 'incus') && !sandboxImage) throw new Error('ORNN_SANDBOX_IMAGE is required for sandbox execution')
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
      hardwareModel: environment.ORNN_RUNNER_HARDWARE_MODEL
        ? hardwareModel(environment.ORNN_RUNNER_HARDWARE_MODEL)
        : await readHardwareModel(),
      capacity: runnerCapacity(environment.ORNN_RUNNER_CAPACITY),
      logicalCpuCount: Math.max(1, navigator.hardwareConcurrency ?? 1),
      memoryLimitBytes: 128 * 1024 * 1024,
    },
    sandboxImage,
  }
}

export async function hardwareModelFromSystem(
  platform = process.platform,
  readSystemFile: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  runCommand: (command: string, arguments_: string[]) => string = (command, arguments_) =>
    new TextDecoder().decode(Bun.spawnSync([command, ...arguments_]).stdout),
): Promise<string> {
  if (platform === 'darwin') return hardwareModel(runCommand('sysctl', ['-n', 'hw.model']))
  if (platform === 'linux') {
    try {
      return hardwareModel(await readSystemFile('/sys/devices/virtual/dmi/id/product_name'))
    } catch {
      try {
        const cpuInfo = await readSystemFile('/proc/cpuinfo')
        const model = cpuInfo.match(/^model name\s*:\s*(.+)$/m)?.[1]
        if (model) return hardwareModel(model)
      } catch {}
    }
  }
  return 'Nicht erkannt'
}

function hardwareModel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized.slice(0, 100) : 'Nicht erkannt'
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
    reconcileSandboxes?: (state: RunnerControlState) => Promise<void>
    forceQuitDriver?: () => SandboxDriver
  } = {},
): Promise<void> {
  const stateStore = options.stateStore ?? fileRunnerStateStore()
  const createSocket = options.createSocket ?? bunWebSocket
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const random = options.random ?? Math.random
  const state = await stateStore.load()
  const reconcileSandboxes = options.reconcileSandboxes ?? defaultSandboxReconciler(config)
  await stateStore.clearSynchronization?.()
  let attempt = 0
  while (!options.signal?.aborted) {
    try {
      try {
        await reconcileSandboxes(state)
      } finally {
        await stateStore.save(state)
      }
      const connection = await openControlConnection(config, state, stateStore, createSocket, options.onSynchronized, options.executeLease ?? defaultLeaseExecutor(config), options.forceQuitDriver ?? (() => sandboxDriver(config)))
      attempt = 0
      await connection.closed
    } catch {
      attempt += 1
    }
    if (!options.signal?.aborted) await sleep(reconnectDelay(attempt, random))
  }
}

function defaultLeaseExecutor(config: RemoteRunnerConfig): LeaseExecutor {
  if (config.profile.executor !== 'docker' && config.profile.executor !== 'incus') return async () => ({ artifact: fixtureArtifact(), cleanupStatus: 'verified' })
  if (!config.sandboxImage) throw new Error('Runner is missing its pinned sandbox image')
  const driver = sandboxDriver(config)
  const importWorkspace = config.profile.executor === 'docker' ? createRepositoryWorkspaceImporter() : undefined
  return (lease, signal, lifecycle) => executeDockerFixture({
    runnerId: config.runnerId, image: config.sandboxImage as string, driver, importWorkspace,
    executor: config.profile.executor === 'incus' ? 'incus' : 'docker',
    onSandboxCreated: lifecycle.created, onSandboxCleaned: lifecycle.cleaned, onObserved: lifecycle.observed,
  }, lease, signal)
}

function defaultSandboxReconciler(config: RemoteRunnerConfig): (state: RunnerControlState) => Promise<void> {
  if (config.profile.executor !== 'docker' && config.profile.executor !== 'incus') return async () => undefined
  const driver = sandboxDriver(config)
  return (state) => reconcileDockerSandboxes(state, driver, config.runnerId)
}

function sandboxDriver(config: RemoteRunnerConfig): SandboxDriver {
  return config.profile.executor === 'incus'
    ? createIncusSandboxDriver({ gateway: createIncusCliGateway({ project: requiredIncusProject() }) })
    : createDockerSandboxDriver({ gateway: createDockerCliGateway() })
}

function requiredIncusProject(): string {
  const project = process.env.ORNN_INCUS_PROJECT
  if (!project || !/^[a-z0-9][a-z0-9-]*$/.test(project) || project === 'default') throw new Error('Runner requires a restricted ORNN_INCUS_PROJECT')
  return project
}

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const cappedAttempt = Math.max(0, Math.min(attempt, 6))
  const base = Math.min(30_000, 250 * 2 ** cappedAttempt)
  return Math.round(base * (0.75 + Math.max(0, Math.min(random(), 1)) * 0.5))
}

async function openControlConnection(
  config: RemoteRunnerConfig,
  state: RunnerControlState,
  stateStore: RunnerStateStore,
  createSocket: WebSocketFactory,
  onSynchronized: (() => void) | undefined,
  executeLease: LeaseExecutor,
  forceQuitDriver: () => SandboxDriver,
): Promise<{ closed: Promise<void> }> {
  const socket = createSocket(controlSocketUrl(config.controlPlaneUrl), {
    authorization: `Bearer ${config.credential}`,
    'x-ornn-runner-id': config.runnerId,
  })
  const instanceId = opaqueInstanceId()
  const active = new Map<string, ActiveExecution>()
  const forceQuitJobs = new Set<string>()
  const runningCommands = new Set<string>()
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
    void handleControlMessage(event.data, { config, socket, state, stateStore, executeLease, forceQuitDriver, active, forceQuitJobs, runningCommands, markSynchronized: async () => {
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
    forceQuitDriver: () => SandboxDriver
    active: Map<string, ActiveExecution>
    forceQuitJobs: Set<string>
    runningCommands: Set<string>
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
    await context.stateStore.save(context.state)
    await context.markSynchronized()
    const commands = Array.isArray(parsed.value.payload.pendingCommands) ? parsed.value.payload.pendingCommands : []
    for (const command of commands) {
      if (isForceQuitCommand(command)) {
        void runForceQuit(command, context).catch(() => context.socket.close())
        continue
      }
      if (!command || typeof command !== 'object') continue
      const { commandId } = command as { commandId?: unknown }
      if (typeof commandId !== 'string' || context.state.commandJournal.some((entry) => entry.commandId === commandId)) continue
      context.state.commandJournal.push({ commandId, state: 'accepted' })
      context.socket.send(JSON.stringify(envelope('runner.command.acknowledged', {
        runnerId: context.config.runnerId, commandId, state: 'accepted',
      })))
      await context.stateStore.save(context.state)
    }
    return
  }
  if (parsed.value.type === 'runner.command' && isForceQuitCommand(parsed.value.payload)) {
    void runForceQuit(parsed.value.payload, context).catch(() => context.socket.close())
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
    const controller = new AbortController()
    if (context.forceQuitJobs.has(lease.jobId)) controller.abort()
    const finished = (async () => {
      if (controller.signal.aborted) return
      const completion = await context.executeLease(lease, controller.signal, {
      async created(sandbox) {
        context.state.sandboxes = context.state.sandboxes.filter((record) => record.sandbox.providerRef !== sandbox.providerRef)
        context.state.sandboxes.push({ jobId: lease.jobId, leaseToken: lease.leaseToken, sandbox })
        await context.stateStore.save(context.state)
      },
      async cleaned(sandbox) {
        context.state.sandboxes = context.state.sandboxes.filter((record) => record.sandbox.providerRef !== sandbox.providerRef)
        await context.stateStore.save(context.state)
      },
      observed(stage, faultCode) {
        context.socket.send(JSON.stringify(envelope('lease.observation', { ...leaseScope(context.config, lease), stage, ...(faultCode ? { faultCode } : {}) })))
      },
      })
      if (!controller.signal.aborted && !context.forceQuitJobs.has(lease.jobId)) {
        context.socket.send(JSON.stringify(envelope('lease.result', { ...leaseScope(context.config, lease), ...completion })))
        context.state.activeLeases = context.state.activeLeases.filter((active) => active.jobId !== lease.jobId)
        await context.stateStore.save(context.state)
      }
    })()
    context.active.set(lease.jobId, { controller, finished })
    try { await finished } catch (error) { if (!controller.signal.aborted) throw error }
    finally { context.active.delete(lease.jobId) }
  }
}

function isForceQuitCommand(value: unknown): value is RunnerForceQuitCommand {
  if (!value || typeof value !== 'object') return false
  const command = value as Partial<RunnerForceQuitCommand>
  return command.type === 'force_quit' && typeof command.commandId === 'string'
    && typeof command.payload?.jobId === 'string' && Number.isSafeInteger(command.payload.generation)
}

async function runForceQuit(command: RunnerForceQuitCommand, context: {
  config: RemoteRunnerConfig; socket: ControlSocket; state: RunnerControlState; stateStore: RunnerStateStore
  active: Map<string, ActiveExecution>; forceQuitJobs: Set<string>; runningCommands: Set<string>; forceQuitDriver: () => SandboxDriver
}): Promise<void> {
  if (context.runningCommands.has(command.commandId)) return
  context.runningCommands.add(command.commandId)
  const { jobId, generation } = command.payload
  context.forceQuitJobs.add(jobId)
  const execution = context.active.get(jobId)
  execution?.controller.abort()
  let cleanupStatus: 'verified' | 'failed' = 'failed'
  try {
    const driver = context.forceQuitDriver()
    const stop = async () => {
      const discovered = await driver.discover({ runnerId: context.config.runnerId })
      const recorded = context.state.sandboxes.filter((record) => record.jobId === jobId && record.sandbox.generation === generation).map((record) => record.sandbox)
      const exact = new Map([...discovered.filter((sandbox) => sandbox.sandboxId === `sandbox_v1_${jobId}-${generation}` && sandbox.generation === generation), ...recorded]
        .map((sandbox) => [sandbox.providerRef, sandbox]))
      for (const sandbox of exact.values()) {
        await driver.terminate(sandbox, 'cancelled')
        await driver.destroy(sandbox)
      }
    }
    await stop()
    if (execution) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          execution.finished.catch(() => undefined),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Execution did not stop')), 10_000) }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }
    await stop()
    const remaining = await driver.discover({ runnerId: context.config.runnerId })
    if (remaining.some((sandbox) => sandbox.sandboxId === `sandbox_v1_${jobId}-${generation}`)) throw new Error('Job sandbox remains')
    context.state.activeLeases = context.state.activeLeases.filter((lease) => lease.jobId !== jobId)
    context.state.sandboxes = context.state.sandboxes.filter((record) => record.jobId !== jobId)
    await context.stateStore.save(context.state)
    cleanupStatus = 'verified'
  } catch {}
  try {
    context.socket.send(JSON.stringify(envelope('runner.force_quit_result', {
      runnerId: context.config.runnerId, commandId: command.commandId, jobId, cleanupStatus,
    })))
  } finally {
    context.runningCommands.delete(command.commandId)
  }
}

function fileRunnerStateStore(
  statePath = process.env.ORNN_RUNNER_STATE_PATH ?? '/var/lib/ornn-runner/control-state.json',
  readyPath = process.env.ORNN_RUNNER_READY_PATH ?? '/var/lib/ornn-runner/control-connection.ready',
): RunnerStateStore {
  return {
    async load() {
      const text = await Bun.file(statePath).text().catch(() => '')
      if (!text) return { activeLeases: [], commandJournal: [], sandboxes: [] }
      try {
        const value = JSON.parse(text)
        return isRunnerControlState(value) ? { ...value, sandboxes: value.sandboxes ?? [] } : { activeLeases: [], commandJournal: [], sandboxes: [] }
      } catch {
        return { activeLeases: [], commandJournal: [], sandboxes: [] }
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
  const state = value as { activeLeases?: unknown; commandJournal?: unknown; sandboxes?: unknown }
  return Array.isArray(state.activeLeases) && state.activeLeases.every((lease) =>
    typeof lease === 'object' && lease !== null && typeof (lease as { jobId?: unknown }).jobId === 'string' && typeof (lease as { leaseToken?: unknown }).leaseToken === 'string',
  ) && Array.isArray(state.commandJournal) && state.commandJournal.every(reconnectStateEntry)
    && (state.sandboxes === undefined || (Array.isArray(state.sandboxes) && state.sandboxes.every(isRunnerSandboxRecord)))
}

function isRunnerSandboxRecord(value: unknown): value is RunnerSandboxRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as { jobId?: unknown; leaseToken?: unknown; sandbox?: unknown }
  return (record.jobId === undefined || typeof record.jobId === 'string')
    && (record.leaseToken === undefined || typeof record.leaseToken === 'string')
    && isSandboxLease(record.sandbox)
}

function isSandboxLease(value: unknown): value is SandboxLease {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const sandbox = value as Partial<SandboxLease>
  return typeof sandbox.sandboxId === 'string' && typeof sandbox.runnerId === 'string' && typeof sandbox.providerRef === 'string'
    && typeof sandbox.specFingerprint === 'string' && typeof sandbox.createdAt === 'string' && typeof sandbox.expiresAt === 'string'
    && Number.isSafeInteger(sandbox.generation) && Array.isArray(sandbox.volumeIds) && sandbox.volumeIds.every((volume) => typeof volume === 'string')
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
  options: { runnerId: string; image: string; driver: SandboxDriver; executor?: 'docker' | 'incus'; now?: () => string; importWorkspace?: RepositoryWorkspaceImporter; onSandboxCreated?: (sandbox: SandboxLease) => Promise<void>; onSandboxCleaned?: (sandbox: SandboxLease) => Promise<void>; onObserved?: (stage: RunnerLeaseStage, faultCode?: string) => void },
  lease: LeaseGrant,
  signal: AbortSignal,
): Promise<{ artifact: ReturnType<typeof fixtureArtifact>; cleanupStatus: 'verified' | 'failed' }> {
  const createdAt = (options.now ?? (() => new Date().toISOString()))()
  options.onObserved?.('execution_started')
  let phase = 'sandbox_create'
  let sandbox: SandboxLease
  try {
    sandbox = await options.driver.create({
      sandboxId: `sandbox_v1_${lease.jobId}-${lease.generation}`,
      generation: lease.generation,
      runnerId: options.runnerId,
      specFingerprint: `${options.executor ?? 'docker'}-fixture-v1:${options.image}`,
      createdAt,
      expiresAt: lease.expiresAt,
      image: options.image,
      command: options.executor === 'incus' ? [] : ['sh', '-ceu', 'mkdir -p /workspace && sleep infinity'],
      resources: options.executor === 'incus' ? { memoryBytes: 1024 * 1024 * 1024, pidsLimit: 256 } : { memoryBytes: 128 * 1024 * 1024, pidsLimit: 64 },
    }, signal)
  } catch (error) {
    options.onObserved?.('execution_failed', errorCode(error, phase))
    throw error
  }
  try {
    phase = 'sandbox_record'
    await options.onSandboxCreated?.(sandbox)
    options.onObserved?.('sandbox_created')
    phase = 'checkout'
    signal.throwIfAborted()
    if (!lease.checkout) throw new Error('Sandbox execution requires a pinned repository checkout')
    const importWorkspace = options.executor === 'incus'
      ? createRepositoryWorkspaceCloner(lease.repository.fullName)
      : options.importWorkspace
    if (!importWorkspace) throw new Error('Sandbox execution is missing its repository workspace importer')
    phase = 'workspace_import'
    options.onObserved?.('workspace_import_started')
    await importWorkspace(lease.checkout, sandbox, options.driver, signal)
    signal.throwIfAborted()
    options.onObserved?.('workspace_imported')
    phase = 'fixture_execution'
    const result = await options.driver.exec(sandbox, { command: ['sh', '-ceu', "printf '{\"kind\":\"plan\"}\\n' > /workspace/fixture-artifact.json"] }, signal)
    signal.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('Docker fixture command failed')
    options.onObserved?.('fixture_executed')
    phase = 'artifact_collect'
    const files = await options.driver.collectArtifacts(sandbox, ['/workspace/fixture-artifact.json'])
    signal.throwIfAborted()
    if (new TextDecoder().decode(files.get('/workspace/fixture-artifact.json')) !== '{"kind":"plan"}\n') throw new Error('Docker fixture artifact was invalid')
    const artifact = fixtureArtifact()
    try {
      options.onObserved?.('cleanup_started')
      await options.driver.terminate(sandbox, 'completed').catch(() => undefined)
      await options.driver.destroy(sandbox)
      await options.onSandboxCleaned?.(sandbox)
      options.onObserved?.('cleanup_verified')
      return { artifact, cleanupStatus: 'verified' }
    } catch {
      return { artifact, cleanupStatus: 'failed' }
    }
  } catch (error) {
    options.onObserved?.('execution_failed', errorCode(error, phase))
    await options.driver.terminate(sandbox, 'failed').catch(() => undefined)
    const destroyed = await options.driver.destroy(sandbox).then(() => true, () => false)
    if (destroyed) await options.onSandboxCleaned?.(sandbox)
    throw error
  }
}

function errorCode(error: unknown, phase: string): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code.slice(0, 100)
  return `runner.${phase}_failed`
}

export async function reconcileDockerSandboxes(state: RunnerControlState, driver: SandboxDriver, runnerId: string): Promise<void> {
  const discovered = await driver.discover({ runnerId })
  const records = new Map(state.sandboxes.map((record) => [record.sandbox.providerRef, record]))
  for (const sandbox of discovered) {
    if (!records.has(sandbox.providerRef)) records.set(sandbox.providerRef, { sandbox })
  }
  const unresolved: RunnerSandboxRecord[] = []
  for (const record of records.values()) {
    try {
      await driver.terminate(record.sandbox, 'failed').catch(() => undefined)
      await driver.destroy(record.sandbox)
    } catch {
      unresolved.push(record)
    }
  }
  state.sandboxes = unresolved
  if (unresolved.length > 0) throw new Error('Runner has unresolved sandbox cleanup')
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

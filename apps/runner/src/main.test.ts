import { expect, test } from 'bun:test'
import { envelope, type RunnerProfile } from '@ornn-forge/protocol'
import { reconnectDelay, remoteRunnerConfigFromEnvironment, runRemoteRunner, type ControlSocket, type RunnerControlState } from './main'

const profile: RunnerProfile = {
  release: 'test', platform: 'linux', architecture: 'arm64', runtime: 'Bun test', executor: 'fixture', capacity: 1,
  logicalCpuCount: 1, memoryLimitBytes: 134_217_728,
}

test('the Runner reads its mounted credential file without placing the secret in its environment', async () => {
  const config = await remoteRunnerConfigFromEnvironment({
    ORNN_CONTROL_PLANE_URL: 'https://control.test',
    ORNN_RUNNER_ID: 'runner_local_debug',
    ORNN_RUNNER_CREDENTIAL_FILE: '/run/secrets/runner_credential',
  }, async (path) => {
    expect(path).toBe('/run/secrets/runner_credential')
    return 'credential-from-file\n'
  })

  expect(config).toMatchObject({
    controlPlaneUrl: 'https://control.test',
    runnerId: 'runner_local_debug',
    credential: 'credential-from-file',
    profile: { platform: process.platform, architecture: process.arch, executor: 'fixture', capacity: 1 },
  })
})

test('the Runner synchronizes its credential-free recovery state before accepting fixture work', async () => {
  const controller = new AbortController()
  const saved: RunnerControlState[] = []
  let ready = 0
  let cleared = 0
  let url = ''
  let headers: Record<string, string> | undefined
  const socket = new FixtureSocket()
  const state: RunnerControlState = {
    activeLeases: [{ jobId: 'job_recovered', leaseToken: 'lease_recovered' }],
    commandJournal: [{ commandId: 'command_recovered', state: 'completed' }],
  }

  await runRemoteRunner({ controlPlaneUrl: 'https://control.test', runnerId: 'runner_homeserv1', credential: 'r'.repeat(32), profile }, {
    signal: controller.signal,
    stateStore: {
      async load() { return structuredClone(state) },
      async save(next) { saved.push(structuredClone(next)) },
      async markSynchronized() { ready += 1 },
      async clearSynchronization() { cleared += 1 },
    },
    createSocket(nextUrl, nextHeaders) {
      url = nextUrl
      headers = nextHeaders
      queueMicrotask(() => socket.emit('open'))
      return socket
    },
    onSynchronized() { controller.abort(); socket.close() },
  })

  expect(url).toBe('wss://control.test/api/v1/runner/connect')
  expect(headers).toEqual({ authorization: `Bearer ${'r'.repeat(32)}`, 'x-ornn-runner-id': 'runner_homeserv1' })
  expect(JSON.parse(socket.sent[0])).toMatchObject({
    type: 'runner.synchronize', payload: { runnerId: 'runner_homeserv1', activeLeases: state.activeLeases, commandJournal: state.commandJournal },
  })
  expect(saved).toHaveLength(1)
  expect(cleared).toBe(1)
  expect(ready).toBe(1)
})

test('the Runner persists a lease before accepting and completing it', async () => {
  const controller = new AbortController()
  const saved: RunnerControlState[] = []
  const socket = new FixtureSocket()

  await runRemoteRunner({ controlPlaneUrl: 'https://control.test', runnerId: 'runner_homeserv1', credential: 'r'.repeat(32), profile }, {
    signal: controller.signal,
    stateStore: {
      async load() { return { activeLeases: [], commandJournal: [] } },
      async save(state) { saved.push(structuredClone(state)) },
      async markSynchronized() {},
    },
    createSocket() {
      queueMicrotask(() => socket.emit('open'))
      return socket
    },
    onSynchronized() {
      socket.emit('message', JSON.stringify(envelope('runner.lease', {
        jobId: 'job_v1_123', leaseToken: 'lease_v1_123', generation: 1, expiresAt: '2026-09-06T00:00:00.000Z',
        workOrder: { issueNumber: 1, title: 'Fixture', body: '', comment: '@ornn' },
      })))
      controller.abort()
      queueMicrotask(() => socket.close())
    },
  })

  await Bun.sleep(0)

  expect(saved[1].activeLeases).toEqual([{ jobId: 'job_v1_123', leaseToken: 'lease_v1_123' }])
  expect(socket.sent.slice(-3).map((message) => JSON.parse(message).type)).toEqual(['lease.accept', 'lease.heartbeat', 'lease.result'])
})

test('the Runner reconnect delay is bounded exponential backoff with jitter', () => {
  expect(reconnectDelay(0, () => 0)).toBe(188)
  expect(reconnectDelay(1, () => 1)).toBe(625)
  expect(reconnectDelay(99, () => 1)).toBeLessThanOrEqual(37_500)
})

class FixtureSocket implements ControlSocket {
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void { this.emit('close') }
  send(message: string): void {
    this.sent.push(message)
    const value = JSON.parse(message)
    if (value.type === 'runner.synchronize') {
      queueMicrotask(() => this.emit('message', JSON.stringify(envelope('runner.synchronized', {
        desiredConfiguration: { paused: false, capacity: 1 }, activeLeases: [], pendingCommands: [],
      }))))
    }
  }

  emit(type: 'open' | 'message' | 'close' | 'error', data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

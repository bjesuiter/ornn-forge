import { expect, test } from 'bun:test'
import { userInfo } from 'node:os'
import { envelope, type LeaseGrant } from '@ornn-forge/protocol'
import { createIncusCliGateway } from './incus-gateway'
import { runRemoteRunner, type ControlSocket, type RunnerControlState } from './main'
import { createIncusSandboxDriver } from './sandbox.incus'
import type { SandboxLease } from './sandbox'

const image = process.env.ORNN_INCUS_TEST_IMAGE
const project = process.env.ORNN_INCUS_PROJECT

for (const fault of ['none', 'stop', 'delete', 'delete_reply', 'storage_inspection'] as const) {
  test.skipIf(!image || !project)(`Incus Force Quit stops the whole Job and recovers from ${fault}`, async () => {
    if (userInfo().username !== 'ornn-forge-incus') throw new Error('run as ornn-forge-incus')
    const runnerId = `runner_forcequit_test_${crypto.randomUUID()}`
    const jobId = `job_v1_${crypto.randomUUID()}`
    const command = { commandId: `command_${crypto.randomUUID()}`, type: 'force_quit', payload: { jobId, generation: 1 } }
    const cli = createIncusCliGateway({ project })
    const gateway = { ...cli, launch: (input: Parameters<typeof cli.launch>[0], signal: AbortSignal) =>
      cli.launch({ ...input, config: { ...input.config, 'limits.cpu': '1' } }, signal) }
    const realDriver = createIncusSandboxDriver({ gateway })
    let inject = true
    const driver = createIncusSandboxDriver({ gateway: {
      ...gateway,
      async stop(name) {
        if (fault === 'stop' && inject) { inject = false; throw new Error('injected stop failure') }
        return gateway.stop(name)
      },
      async delete(name) {
        if (fault === 'delete' && inject) { inject = false; throw new Error('injected delete failure') }
        await gateway.delete(name)
        if (fault === 'delete_reply' && inject) { inject = false; throw new Error('injected lost delete reply') }
      },
      async volumeExists(pool, name) {
        if (fault === 'storage_inspection' && inject) { inject = false; throw new Error('injected unavailable volume inspection') }
        return gateway.volumeExists(pool, name)
      },
    } })
    const controller = new AbortController()
    const state: RunnerControlState = { activeLeases: [], commandJournal: [], sandboxes: [] }
    const saved: RunnerControlState[] = []
    let sandbox: SandboxLease | undefined
    let peer: SandboxLease | undefined
    let failure: unknown
    const results: string[] = []
    const spec = (sandboxId: string) => ({
      runnerId, sandboxId, generation: 1, specFingerprint: `forcequit:${image}`,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      image: image!, command: [], resources: { memoryBytes: 512 * 1024 * 1024, pidsLimit: 128 },
    })
    const socket = new ProbeSocket(async (message) => {
      if (message.type === 'runner.report') {
        failure ??= new Error(`Runner probe failed: ${JSON.stringify(message.payload.fault)}`)
        controller.abort()
        socket.close()
        return
      }
      if (message.type !== 'runner.force_quit_result') return
      const status = String(message.payload.cleanupStatus)
      results.push(status)
      try {
        if (status === 'failed') {
          expect(state.activeLeases.map((lease) => lease.jobId)).toContain(jobId)
          expect(state.sandboxes.map((record) => record.sandbox.providerRef)).toContain(sandbox!.providerRef)
          expect(results).toEqual(['failed'])
          socket.emit('message', JSON.stringify(envelope('runner.command', command)))
        } else {
          expect(await realDriver.inspect(sandbox!)).toMatchObject({ state: 'absent' })
          expect(state.activeLeases).toEqual([])
          expect(state.sandboxes).toEqual([])
          expect(await realDriver.inspect(peer!)).toMatchObject({ state: 'present', phase: 'ready' })
          expect((await realDriver.exec(peer!, { command: ['true'] }, new AbortController().signal)).exitCode).toBe(0)
          controller.abort()
          socket.close()
        }
      } catch (error) { failure = error; controller.abort(); socket.close() }
    })
    const timeout = setTimeout(() => { failure = new Error('Force Quit probe timed out'); controller.abort(); socket.close() }, 90_000)
    try {
      peer = await realDriver.create(spec(`sandbox_peer_${crypto.randomUUID()}`), new AbortController().signal)
      await runRemoteRunner({
        runnerId, controlPlaneUrl: 'https://probe.invalid', credential: 'probe-only-credential',
        profile: { release: 'probe', platform: 'linux', architecture: process.arch, runtime: `Bun ${Bun.version}`, executor: 'incus', capacity: 1, logicalCpuCount: 2, memoryLimitBytes: 512 * 1024 * 1024, hardwareModel: 'probe' },
      }, {
        signal: controller.signal, forceQuitDriver: () => driver,
        reconcileSandboxes: async () => {},
        stateStore: { async load() { return state }, async save(value) { saved.push(structuredClone(value)) }, async markSynchronized() {} },
        createSocket() { queueMicrotask(() => socket.emit('open')); return socket },
        onSynchronized() {
          socket.emit('message', JSON.stringify(envelope('runner.lease', {
            jobId, generation: 1, leaseToken: 'probe-lease', expiresAt: new Date(Date.now() + 60_000).toISOString(),
            repository: { fullName: 'bjesuiter/ornn-forge' }, workOrder: { issueNumber: 24, title: 'Force Quit probe', body: '', comment: '' },
          } satisfies LeaseGrant)))
        },
        async executeLease(_lease, signal, lifecycle) {
          try {
            if (sandbox) throw new Error('the probe must never execute the Job twice')
            sandbox = await realDriver.create(spec(`sandbox_v1_${jobId}-1`), signal)
            await lifecycle.created(sandbox)
            const pool = sandbox.volumeIds[0]!.split('/')[0]!
            expect(await gateway.volumeExists(pool, sandbox.providerRef)).toBe(true)
            const started = await realDriver.exec(sandbox, { command: ['bash', '-c', 'mkdir -p /workspace; nohup sh -c \'trap "" TERM INT; while :; do date +%s >> /workspace/child-alive; sleep 1; done\' >/workspace/child.log 2>&1 </dev/null &'] }, signal)
            expect(started.exitCode).toBe(0)
            for (let attempt = 0; ; attempt++) {
              const ready = await realDriver.exec(sandbox, { command: ['test', '-s', '/workspace/child-alive'] }, signal)
              if (ready.exitCode === 0) break
              if (attempt >= 20) throw new Error('child did not start')
              await Bun.sleep(100)
            }
            const running = realDriver.exec(sandbox, { command: ['sleep', '600'] }, signal)
            setTimeout(() => socket.emit('message', JSON.stringify(envelope('runner.command', command))), 50)
            await running
            throw new Error('the running Job unexpectedly completed')
          } catch (error) { if (!signal.aborted) failure = error; throw error }
        },
      })
      if (failure) throw failure
      expect(results).toEqual(fault === 'none' ? ['verified'] : ['failed', 'verified'])
      expect(socket.sent.some((message) => message.type === 'lease.result')).toBe(false)
      expect(saved.some((value) => value.sandboxes.some((record) => record.sandbox.volumeIds.length === 1))).toBe(true)
      console.log(`Force Quit ${fault}: ${sandbox!.providerRef}, ${sandbox!.volumeIds[0]}, ${results.join(' -> ')}`)
    } finally {
      clearTimeout(timeout)
      controller.abort()
      socket.close()
      const discovered = await realDriver.discover({ runnerId })
      const owned = new Map([...discovered, ...[sandbox, peer].filter((lease): lease is SandboxLease => !!lease)].map((lease) => [lease.providerRef, lease]))
      for (const lease of owned.values()) {
        await realDriver.terminate(lease, 'failed')
        await realDriver.destroy(lease)
      }
      expect(await realDriver.discover({ runnerId })).toEqual([])
    }
  }, 120_000)
}

type Message = { type: string; payload: Record<string, unknown> }

class ProbeSocket implements ControlSocket {
  readonly sent: Message[] = []
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()
  constructor(private readonly onMessage: (message: Message) => Promise<void>) {}
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string, data?: string): void { for (const listener of this.listeners.get(type) ?? []) listener({ data }) }
  close(): void { this.emit('close') }
  send(text: string): void {
    const message = JSON.parse(text) as Message
    this.sent.push(message)
    if (message.type === 'runner.synchronize') queueMicrotask(() => this.emit('message', JSON.stringify(envelope('runner.synchronized', {
      activeLeases: [], pendingCommands: [], desiredConfiguration: { paused: true, capacity: 1 },
    }))))
    // A control-plane retry arrives on a later heartbeat, after the current handler returns.
    setTimeout(() => { void this.onMessage(message) }, 0)
  }
}

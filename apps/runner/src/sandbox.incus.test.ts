import { expect, test } from 'bun:test'
import { createIncusCliGateway, readIncusOutput } from './incus-gateway'
import { createIncusSandboxDriver, type IncusGateway, type IncusInstance } from './sandbox.incus'
import type { SandboxSpec } from './sandbox'

const now = '2026-09-28T12:00:00.000Z'
const spec: SandboxSpec = {
  sandboxId: 'sandbox_v1_test', generation: 1, runnerId: 'runner_v1_test',
  specFingerprint: 'incus-test-v1', createdAt: now, expiresAt: '2026-09-28T12:15:00.000Z',
  image: 'a'.repeat(64), command: [], resources: { memoryBytes: 256 * 1024 * 1024, pidsLimit: 128 },
}

test('Incus creates, discovers, executes, transfers, stops and verifies an owned instance', async () => {
  let instance: IncusInstance | undefined
  const calls: string[] = []
  const gateway: IncusGateway = {
    async list() { return instance ? [instance] : [] },
    async launch(input) {
      calls.push('launch')
      expect(input.image).toBe(spec.image)
      expect(input.config['limits.memory']).toBe(String(spec.resources.memoryBytes))
      expect(input.config['limits.processes']).toBe(String(spec.resources.pidsLimit))
      expect(input.config['security.privileged']).toBe('false')
      instance = { name: input.name, status: 'Running', config: input.config }
    },
    async exec(name, request) { calls.push(`exec:${name}:${request.command.join(' ')}`); return { exitCode: 0, stdout: new TextEncoder().encode('ok'), stderr: new Uint8Array() } },
    async readFile(name, path) { calls.push(`read:${name}:${path}`); return new TextEncoder().encode('artifact') },
    async writeFile(name, path, data) { calls.push(`write:${name}:${path}:${data.length}`) },
    async stop(name) { calls.push(`stop:${name}`); instance!.status = 'Stopped' },
    async delete(name) { calls.push(`delete:${name}`); instance = undefined },
  }
  const driver = createIncusSandboxDriver({ gateway, now: () => now })
  const lease = await driver.create(spec, new AbortController().signal)
  expect(lease.providerRef).toMatch(/^ornn-[0-9a-f]{40}$/)
  expect(await driver.discover({ runnerId: spec.runnerId })).toEqual([lease])
  expect((await driver.exec(lease, { command: ['git', 'rev-parse', 'HEAD'], cwd: '/workspace' }, new AbortController().signal)).exitCode).toBe(0)
  await driver.writeFile(lease, '/workspace/.ornn-credential', new Uint8Array([1, 2, 3]))
  expect(new TextDecoder().decode(await driver.readFile(lease, '/workspace/result.txt'))).toBe('artifact')
  expect((await driver.collectArtifacts(lease, ['/workspace/result.txt'])).size).toBe(1)
  await driver.terminate(lease, 'completed')
  expect(await driver.inspect(lease)).toMatchObject({ state: 'present', phase: 'stopped', processes: 'stopped' })
  await driver.destroy(lease)
  expect(await driver.inspect(lease)).toEqual({ state: 'absent', observedAt: now })
  expect(calls).toEqual([
    'launch', `exec:${lease.providerRef}:git rev-parse HEAD`,
    `write:${lease.providerRef}:/workspace/.ornn-credential:3`,
    `read:${lease.providerRef}:/workspace/result.txt`,
    `read:${lease.providerRef}:/workspace/result.txt`,
    `stop:${lease.providerRef}`, `delete:${lease.providerRef}`,
  ])
})

test('Incus rejects a foreign instance before any destructive call', async () => {
  const instance: IncusInstance = { name: 'foreign', status: 'Running', config: { 'user.ornn.managed': 'true', 'user.ornn.runner-id': 'another-runner' } }
  let changed = false
  const gateway: IncusGateway = {
    async list() { return [instance] },
    async launch() { changed = true }, async exec() { changed = true; throw new Error('not used') },
    async readFile() { changed = true; throw new Error('not used') }, async writeFile() { changed = true },
    async stop() { changed = true }, async delete() { changed = true },
  }
  const driver = createIncusSandboxDriver({ gateway })
  const lease = { ...spec, providerRef: 'foreign', volumeIds: [] }
  await expect(driver.destroy(lease)).rejects.toMatchObject({ code: 'conflict', operation: 'destroy' })
  await expect(driver.exec(lease, { command: ['true'] }, new AbortController().signal)).rejects.toMatchObject({ code: 'conflict', operation: 'exec' })
  expect(changed).toBe(false)
})

test('Incus refuses a Docker-style start command and a mutable image reference', async () => {
  const gateway: IncusGateway = {
    async list() { return [] }, async launch() { throw new Error('not used') },
    async exec() { throw new Error('not used') }, async readFile() { throw new Error('not used') },
    async writeFile() {}, async stop() {}, async delete() {},
  }
  const driver = createIncusSandboxDriver({ gateway })
  await expect(driver.create({ ...spec, command: ['sleep', 'infinity'] }, new AbortController().signal)).rejects.toMatchObject({ code: 'rejected' })
  await expect(driver.create({ ...spec, image: 'images:ubuntu/24.04' }, new AbortController().signal)).rejects.toMatchObject({ code: 'rejected' })
})

test('Incus does not report cleanup when the instance remains listed', async () => {
  const gateway: IncusGateway = {
    async list() { return [{ name: 'owned', status: 'Stopped', config: {
      'user.ornn.managed': 'true', 'user.ornn.runner-id': spec.runnerId, 'user.ornn.sandbox-id': spec.sandboxId,
      'user.ornn.generation': '1', 'user.ornn.spec-fingerprint': spec.specFingerprint,
    } }] },
    async launch() {}, async exec() { throw new Error('not used') }, async readFile() { throw new Error('not used') },
    async writeFile() {}, async stop() {}, async delete() {},
  }
  const driver = createIncusSandboxDriver({ gateway })
  await expect(driver.destroy({ ...spec, providerRef: 'owned', volumeIds: [] })).rejects.toMatchObject({ code: 'unavailable', operation: 'destroy', effect: 'unknown' })
})

test('Incus CLI keeps project flag outside exec command and gives pushed files private mode', async () => {
  const calls: Array<{ args: string[]; input?: Uint8Array }> = []
  const gateway = createIncusCliGateway({ project: 'user-996', run: async (args, input) => {
    calls.push({ args, input })
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
  } })
  await gateway.exec('ornn-test', { command: ['git', 'status'], cwd: '/workspace' }, new AbortController().signal)
  await gateway.writeFile('ornn-test', '/workspace/.ornn-credential', new Uint8Array([1, 2]))
  expect(calls[0]?.args).toEqual(['--project', 'user-996', 'exec', 'ornn-test', '--mode=non-interactive', '--disable-stdin', '--cwd', '/workspace', '--', 'git', 'status'])
  expect(calls[1]?.args).toEqual(['--project', 'user-996', 'file', 'push', '-', 'ornn-test/workspace/.ornn-credential', '--mode=0600'])
  expect(calls[1]?.input).toEqual(new Uint8Array([1, 2]))
})

test('Incus output reader stops a command at its byte limit', async () => {
  let stopped = 0
  const withinLimit = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
      controller.enqueue(new Uint8Array([3]))
      controller.close()
    },
  })
  expect(await readIncusOutput(withinLimit, 3, () => { stopped++ })).toEqual(new Uint8Array([1, 2, 3]))
  const overLimit = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
      controller.enqueue(new Uint8Array([3, 4]))
      controller.close()
    },
  })
  await expect(readIncusOutput(overLimit, 3, () => { stopped++ })).rejects.toThrow('Incus output exceeded 3 bytes')
  expect(stopped).toBe(1)
})

test('Incus CLI applies a deadline to management and exec commands', async () => {
  const calls: string[] = []
  const gateway = createIncusCliGateway({
    timeouts: { commandMs: 5, execMs: 5 },
    run: (args, _input, signal) => new Promise((_resolve, reject) => {
      calls.push(args[0] ?? '')
      signal?.addEventListener('abort', () => reject(new Error('child stopped')), { once: true })
    }),
  })
  await expect(gateway.list()).rejects.toMatchObject({ name: 'AbortError', message: 'Incus command timed out after 5 ms' })
  await expect(gateway.exec('ornn-test', { command: ['sleep', '300'] }, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Incus command timed out after 5 ms' })
  expect(calls).toEqual(['list', 'exec'])
})

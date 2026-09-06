import { expect, test } from 'bun:test'
import {
  createDockerSandboxDriver,
  type DockerGateway,
  type SandboxLease,
} from './sandbox'

const now = '2026-09-07T12:00:00.000Z'
const lease: SandboxLease = {
  sandboxId: 'sandbox_v1_abcdefghijklmnopqrstuv',
  generation: 1,
  runnerId: 'runner_v1_abcdefghijklmnopqrstuv',
  providerRef: 'container-123',
  specFingerprint: 'fixture-v1',
  createdAt: now,
  expiresAt: '2026-09-07T12:15:00.000Z',
  volumeIds: [],
}

test('creates an isolated Docker sandbox with deterministic ownership and verifies its destruction', async () => {
  const calls: string[] = []
  let present = false
  let running = false
  const gateway: DockerGateway = {
    async list(labels) {
      calls.push(`list:${labels.join(',')}`)
      return present ? [{ id: 'container-123', labels: ownershipLabels(lease), state: running ? 'running' : 'exited', volumes: [] }] : []
    },
    async create(input) {
      calls.push(`create:${input.name}`)
      expect(input.image).toBe('busybox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      expect(input.network).toBe('none')
      expect(input.restart).toBe('no')
      expect(input.init).toBe(true)
      expect(input.autoRemove).toBe(false)
      expect(input.labels).toEqual(ownershipLabels(lease))
      expect(input.resources).toEqual({ memoryBytes: 64 * 1024 * 1024, pidsLimit: 64 })
      present = true
      running = true
      return { id: 'container-123', volumes: [] }
    },
    async inspect(id) {
      calls.push(`inspect:${id}`)
      return present ? { id: 'container-123', labels: ownershipLabels(lease), state: running ? 'running' : 'exited', processes: running ? 'running' : 'stopped', volumes: [] } : undefined
    },
    async exec(id, command) {
      calls.push(`exec:${id}:${command.join(' ')}`)
      return { exitCode: 0, stdout: new TextEncoder().encode('{"kind":"plan"}\n'), stderr: new Uint8Array() }
    },
    async copyTo(id, path) { calls.push(`copyTo:${id}:${path}`) },
    async copyFrom(id, path) { calls.push(`copyFrom:${id}:${path}`); return new Uint8Array() },
    async stop(id) { calls.push(`stop:${id}`); running = false },
    async remove(id) { calls.push(`remove:${id}`); present = false },
    async inspectVolume() { return undefined },
  }
  const driver = createDockerSandboxDriver({ gateway, now: () => now })

  const created = await driver.create({
    ...lease,
    image: 'busybox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    command: ['sh', '-ceu', 'sleep infinity'],
    resources: { memoryBytes: 64 * 1024 * 1024, pidsLimit: 64 },
  }, new AbortController().signal)
  expect(created).toEqual(lease)

  const result = await driver.exec(lease, { command: ['sh', '-ceu', 'printf \'{"kind":"plan"}\\n\''] }, new AbortController().signal)
  expect(new TextDecoder().decode(result.stdout)).toBe('{"kind":"plan"}\n')

  await driver.terminate(lease, 'completed')
  await driver.destroy(lease)
  expect(await driver.inspect(lease)).toEqual({ state: 'absent', observedAt: now })
  expect(calls).toEqual([
    expect.stringContaining('list:'),
    `create:ornn-${lease.runnerId}-${lease.sandboxId}-${lease.generation}`,
    `inspect:${lease.providerRef}`,
    `exec:${lease.providerRef}:sh -ceu printf '{"kind":"plan"}\\n'`,
    `inspect:${lease.providerRef}`,
    `stop:${lease.providerRef}`,
    `inspect:${lease.providerRef}`,
    `inspect:${lease.providerRef}`,
    `remove:${lease.providerRef}`,
    `inspect:${lease.providerRef}`,
    expect.stringContaining('list:'),
    `inspect:${lease.providerRef}`,
  ])
})

test('does not claim verified cleanup while Docker still reports the owned container', async () => {
  const gateway: DockerGateway = {
    async list() { return [{ id: lease.providerRef, labels: ownershipLabels(lease), state: 'exited', volumes: [] }] },
    async create() { throw new Error('not used') },
    async inspect() { return { id: lease.providerRef, labels: ownershipLabels(lease), state: 'exited', processes: 'stopped', volumes: [] } },
    async exec() { throw new Error('not used') },
    async copyTo() {},
    async copyFrom() { return new Uint8Array() },
    async stop() {},
    async remove() {},
    async inspectVolume() { return undefined },
  }
  const driver = createDockerSandboxDriver({ gateway, now: () => now })

  await expect(driver.destroy(lease)).rejects.toMatchObject({ code: 'unavailable', operation: 'destroy', effect: 'unknown' })
})

test('does not claim verified cleanup while a recorded anonymous volume remains after container removal', async () => {
  let present = true
  const volumeLease = { ...lease, volumeIds: ['volume-123'] }
  const gateway: DockerGateway = {
    async list() { return [] },
    async create() { throw new Error('not used') },
    async inspect() { return present ? { id: lease.providerRef, labels: ownershipLabels(volumeLease), state: 'exited', processes: 'stopped', volumes: ['volume-123'] } : undefined },
    async exec() { throw new Error('not used') },
    async copyTo() {},
    async copyFrom() { return new Uint8Array() },
    async stop() {},
    async remove() { present = false },
    async inspectVolume() { return true },
  }
  const driver = createDockerSandboxDriver({ gateway, now: () => now })

  await expect(driver.destroy(volumeLease)).rejects.toMatchObject({ code: 'unavailable', operation: 'destroy', effect: 'unknown' })
})

function ownershipLabels(value: SandboxLease): Record<string, string> {
  return {
    'io.ornn.managed': 'true',
    'io.ornn.runner-id': value.runnerId,
    'io.ornn.sandbox-id': value.sandboxId,
    'io.ornn.generation': String(value.generation),
    'io.ornn.spec-fingerprint': value.specFingerprint,
  }
}

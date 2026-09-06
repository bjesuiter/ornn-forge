import { expect, test } from 'bun:test'
import { envelope, isRunnerSynchronization, parseRunnerEnvelope } from './index'

test('accepts optional future fields but rejects an unsupported protocol major', () => {
  expect(parseRunnerEnvelope({ ...envelope('runner.poll', { runnerId: 'runner_homeserv1' }), futureField: true })).toMatchObject({ ok: true })
  expect(parseRunnerEnvelope({ protocol: { major: 2 }, type: 'runner.poll', payload: { runnerId: 'runner_homeserv1' } }))
    .toEqual({ ok: false, code: 'unsupported_major' })
})

test('accepts bounded Runner synchronization state', () => {
  expect(isRunnerSynchronization({
    runnerId: 'runner_v1_0123456789012345678901',
    instanceId: 'instance_v1_0123456789012345678901',
    profile: { release: 'v1', platform: 'linux', architecture: 'arm64', runtime: 'Bun', executor: 'fixture', capacity: 1, logicalCpuCount: 4, memoryLimitBytes: 1_073_741_824 },
    activeLeases: [], commandJournal: [],
  })).toBe(true)
})

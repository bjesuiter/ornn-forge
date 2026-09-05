import { expect, test } from 'bun:test'
import { envelope, parseRunnerEnvelope } from './index'

test('accepts optional future fields but rejects an unsupported protocol major', () => {
  expect(parseRunnerEnvelope({ ...envelope('runner.poll', { runnerId: 'runner_homeserv1' }), futureField: true })).toMatchObject({ ok: true })
  expect(parseRunnerEnvelope({ protocol: { major: 2 }, type: 'runner.poll', payload: { runnerId: 'runner_homeserv1' } }))
    .toEqual({ ok: false, code: 'unsupported_major' })
})

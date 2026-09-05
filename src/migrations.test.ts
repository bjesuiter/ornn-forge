import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../migrations/0001_admit_analyze_invocation.sql', import.meta.url), 'utf8')
const runnerMigration = readFileSync(new URL('../migrations/0002_fixture_runner.sql', import.meta.url), 'utf8')

test('the admission migration creates immutable provenance and append-only events', () => {
  const database = new Database(':memory:')
  database.exec(migration)
  database.run(`INSERT INTO deliveries VALUES ('delivery', lower(hex(zeroblob(32))), 'inv_v1_a', 'job_v1_a', '2026-09-05T00:00:00.000Z')`)
  database.run(`INSERT INTO invocations VALUES (
    'inv_v1_a', 1, 'delivery', '42', '99', 'bjesuiter/ornn-forge', 22,
    'title', 'body', '123', 'comment', 'bjesuiter', '{}', 'pv_v1_test', '2026-09-05T00:00:00.000Z'
  )`)
  database.run(`INSERT INTO domain_events VALUES (
    'evt_v1_a', 1, 'job', 'job_v1_a', 1, 'job.created', '{}', lower(hex(zeroblob(32))), '2026-09-05T00:00:00.000Z'
  )`)

  expect(() => database.run("UPDATE invocations SET github_actor = 'other' WHERE invocation_id = 'inv_v1_a'"))
    .toThrow('invocations are immutable')
  expect(() => database.run("DELETE FROM domain_events WHERE event_id = 'evt_v1_a'"))
    .toThrow('domain_events are append-only')
})

test('the fixture Runner migration stores only credential and lease digests', () => {
  const database = new Database(':memory:')
  database.exec(migration)
  database.exec(runnerMigration)
  database.run("INSERT INTO runner_credentials VALUES ('runner_homeserv1', 'digest-only', '2026-09-05T00:00:00.000Z')")
  database.run(`INSERT INTO deliveries VALUES ('delivery', lower(hex(zeroblob(32))), 'inv_v1_a', 'job_v1_a', '2026-09-05T00:00:00.000Z')`)
  database.run(`INSERT INTO invocations VALUES (
    'inv_v1_a', 1, 'delivery', '42', '99', 'bjesuiter/ornn-forge', 22,
    'title', 'body', '123', 'comment', 'bjesuiter', '{}', 'pv_v1_test', '2026-09-05T00:00:00.000Z'
  )`)
  database.run(`INSERT INTO jobs (job_id, schema_version, invocation_id, state, flow_id, flow_version_id, policy_version_id, created_at)
    VALUES ('job_v1_a', 1, 'inv_v1_a', 'pending', 'analyze', 'fv_v1_test', 'pv_v1_test', '2026-09-05T00:00:00.000Z')`)
  database.run(`INSERT INTO runner_leases VALUES (
    'job_v1_a', 'runner_homeserv1', 1, 'lease-digest-only', '2026-09-05T00:01:00.000Z',
    '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z'
  )`)
  expect(database.query('SELECT credential_digest FROM runner_credentials').get()).toEqual({ credential_digest: 'digest-only' })
  expect(database.query('SELECT token_digest FROM runner_leases').get()).toEqual({ token_digest: 'lease-digest-only' })
})

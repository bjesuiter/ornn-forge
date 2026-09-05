import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../migrations/0001_admit_analyze_invocation.sql', import.meta.url), 'utf8')

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

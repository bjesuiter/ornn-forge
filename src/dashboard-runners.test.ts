import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { dashboardRunnersFromRows, listDashboardRunners, type DashboardRunnerDatabase } from './dashboard-runners'

const migrations = [
  '0001_admit_analyze_invocation.sql',
  '0002_fixture_runner.sql',
  '0005_record_runner_presence.sql',
  '0006_pause_runners.sql',
  '0007_record_runner_diagnostics.sql',
  '0008_create_remote_runner_identities.sql',
].map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))

test('the dashboard keeps runner presence, pause, faults, capacity, and work as independent dimensions', () => {
  const runners = dashboardRunnersFromRows([
    {
      runner_id: 'runner_homeserv1',
      enrollment_state: 'enrolled',
      readiness_state: 'ready',
      desired_capacity: 2,
      last_seen_at: '2026-09-06T12:00:00.000Z',
      paused: 1,
      fault_code: 'runner.operation_failed',
      fault_occurred_at: '2026-09-06T11:59:30.000Z',
      release: 'v1.2.3',
      platform: 'linux',
      architecture: 'arm64',
      runtime: 'Bun 1.4.0',
      executor: 'docker',
      capacity: 2,
      reservations: 1,
    },
  ], '2026-09-06T11:59:40.000Z', [
    {
      runner_id: 'runner_homeserv1',
      job_id: 'job_v1_active',
      github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 42,
      github_issue_title: 'Show Runner status in the dashboard',
      generation: 3,
      created_at: '2026-09-06T11:50:00.000Z',
      last_heartbeat_at: '2026-09-06T11:59:55.000Z',
      expires_at: '2026-09-06T12:00:55.000Z',
    },
  ], [
    {
      runner_id: 'runner_homeserv1',
      job_id: 'job_v1_done',
      github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 41,
      github_issue_title: 'Persist Runner diagnostics',
      created_at: '2026-09-06T11:40:00.000Z',
      execution_completed_at: '2026-09-06T11:45:00.000Z',
    },
  ])

  expect(runners).toEqual([{
    id: 'runner_homeserv1',
    enrollment: 'enrolled',
    ready: true,
    desiredCapacity: 2,
    online: true,
    lastSeenAt: '2026-09-06T12:00:00.000Z',
    paused: true,
    fault: { code: 'runner.operation_failed', occurredAt: '2026-09-06T11:59:30.000Z' },
    profile: { release: 'v1.2.3', platform: 'linux', architecture: 'arm64', runtime: 'Bun 1.4.0', executor: 'docker', capacity: 2 },
    reservations: 1,
    activeJobs: [{
      id: 'job_v1_active', repository: 'bjesuiter/ornn-forge', issueNumber: 42,
      issueTitle: 'Show Runner status in the dashboard', generation: 3,
      startedAt: '2026-09-06T11:50:00.000Z', lastHeartbeatAt: '2026-09-06T11:59:55.000Z', expiresAt: '2026-09-06T12:00:55.000Z',
    }],
    lastResult: {
      id: 'job_v1_done', repository: 'bjesuiter/ornn-forge', issueNumber: 41,
      issueTitle: 'Persist Runner diagnostics', status: 'succeeded',
      startedAt: '2026-09-06T11:40:00.000Z', completedAt: '2026-09-06T11:45:00.000Z',
    },
    recentJobs: [{
      id: 'job_v1_done', repository: 'bjesuiter/ornn-forge', issueNumber: 41,
      issueTitle: 'Persist Runner diagnostics', status: 'succeeded',
      startedAt: '2026-09-06T11:40:00.000Z', completedAt: '2026-09-06T11:45:00.000Z',
    }],
  }])
})

test('the dashboard query keeps enrollment, readiness, and presence separate', async () => {
  const database = new Database(':memory:')
  for (const migration of migrations) database.exec(migration)
  database.run(`INSERT INTO remote_runners VALUES
    ('runner_awaiting', 'remote', 2, 'awaiting_setup', 'not_ready', '2026-09-06T12:00:00.000Z'),
    ('runner_enrolled', 'remote', 3, 'enrolled', 'ready', '2026-09-06T12:00:00.000Z')`)
  database.run("INSERT INTO runner_credentials VALUES ('runner_enrolled', 'digest-only', '2026-09-06T12:00:00.000Z')")
  database.run("INSERT INTO runner_presence VALUES ('runner_enrolled', '2026-09-06T12:00:00.000Z')")

  const runners = await listDashboardRunners(sqliteDashboardDatabase(database), new Date('2026-09-06T12:00:05.000Z'))

  expect(runners.map(({ id, enrollment, ready, online, desiredCapacity }) => ({ id, enrollment, ready, online, desiredCapacity }))).toEqual([
    { id: 'runner_awaiting', enrollment: 'awaiting_setup', ready: false, online: false, desiredCapacity: 2 },
    { id: 'runner_enrolled', enrollment: 'enrolled', ready: true, online: true, desiredCapacity: 3 },
  ])
})

function sqliteDashboardDatabase(database: Database): DashboardRunnerDatabase {
  return {
    prepare(query) {
      return {
        async all<T>() {
          return { results: database.query(query).all() as T[] }
        },
      }
    },
  }
}

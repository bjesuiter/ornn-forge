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
  '0011_add_runner_hardware_model.sql',
  '0012_add_runner_labels.sql',
  '0013_add_dashboard_read_models.sql',
  '0014_add_runner_decommissioning.sql',
  '0015_force_quit.sql',
].map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))

test('the dashboard keeps runner presence, pause, faults, capacity, and work as independent dimensions', () => {
  const runners = dashboardRunnersFromRows([
    {
      runner_id: 'runner_homeserv1',
      label: 'forge-01',
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
      hardware_model: 'Macmini9,1',
      capacity: 2,
      reservations: 1,
    },
  ], new Date('2026-09-06T12:00:00.000Z'), [
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
    label: 'forge-01',
    enrollment: 'enrolled',
    ready: true,
    desiredCapacity: 2,
    presence: 'online',
    lastSeenAt: '2026-09-06T12:00:00.000Z',
    paused: true,
    fault: { code: 'runner.operation_failed', occurredAt: '2026-09-06T11:59:30.000Z' },
    profile: { release: 'v1.2.3', platform: 'linux', architecture: 'arm64', runtime: 'Bun 1.4.0', executor: 'docker', hardwareModel: 'Macmini9,1', capacity: 2 },
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
  database.run(`INSERT INTO remote_runners (runner_id, kind, desired_capacity, enrollment_state, readiness_state, created_at) VALUES
    ('runner_awaiting', 'remote', 2, 'awaiting_setup', 'not_ready', '2026-09-06T12:00:00.000Z'),
    ('runner_enrolled', 'remote', 3, 'enrolled', 'ready', '2026-09-06T12:00:00.000Z'),
    ('runner_stale', 'remote', 1, 'enrolled', 'ready', '2026-09-06T12:00:00.000Z'),
    ('runner_decommissioned', 'remote', 1, 'enrolled', 'ready', '2026-09-06T12:00:00.000Z')`)
  database.run("INSERT INTO runner_credentials VALUES ('runner_enrolled', 'digest-only', '2026-09-06T12:00:00.000Z')")
  database.run("INSERT INTO runner_credentials VALUES ('runner_stale', 'stale-digest', '2026-09-06T12:00:00.000Z')")
  database.run("INSERT INTO runner_presence VALUES ('runner_enrolled', '2026-09-06T12:00:00.000Z')")
  database.run("INSERT INTO runner_presence VALUES ('runner_stale', '2026-09-06T11:58:00.000Z')")
  database.run("UPDATE remote_runners SET decommissioned_at = '2026-09-06T12:01:00.000Z', decommission_mode = 'normal' WHERE runner_id = 'runner_decommissioned'")
  for (const [suffix, cleanup] of [['failed', 'failed'], ['verified', 'verified']] as const) {
    database.run(`INSERT INTO invocations VALUES (
      'inv_${suffix}', 1, 'delivery_${suffix}', '42', '99', 'bjesuiter/ornn-forge', 22,
      'Force Quit', '', 'comment_${suffix}', '', 'bjesuiter', '{}', 'policy', '2026-09-06T11:50:00.000Z'
    )`)
    database.run(`INSERT INTO jobs (job_id, schema_version, invocation_id, state, flow_id, flow_version_id, policy_version_id,
      created_at, execution_status, execution_completed_at, cleanup_status, cleanup_updated_at,
      force_quit_requested_at, force_quit_completed_at, force_quit_command_id)
      VALUES ('job_${suffix}', 1, 'inv_${suffix}', 'leased', 'analyze', 'flow', 'policy',
      '2026-09-06T11:50:00.000Z', 'cancelled', '2026-09-06T11:59:00.000Z', '${cleanup}', '2026-09-06T11:59:00.000Z',
      '2026-09-06T11:58:00.000Z', '2026-09-06T11:59:00.000Z', 'command_${suffix}')`)
    database.run(`INSERT INTO runner_leases VALUES ('job_${suffix}', 'runner_enrolled', 1, 'digest',
      '2026-09-06T12:00:30.000Z', '2026-09-06T11:58:00.000Z', '2026-09-06T11:50:00.000Z')`)
  }

  const runners = await listDashboardRunners(sqliteDashboardDatabase(database), new Date('2026-09-06T12:00:05.000Z'))

  expect(runners.map(({ id, label, enrollment, ready, presence, desiredCapacity }) => ({ id, label, enrollment, ready, presence, desiredCapacity }))).toEqual([
    { id: 'runner_awaiting', label: 'Unbenannt', enrollment: 'awaiting_setup', ready: false, presence: 'offline', desiredCapacity: 2 },
    { id: 'runner_enrolled', label: 'Unbenannt', enrollment: 'enrolled', ready: true, presence: 'online', desiredCapacity: 3 },
    { id: 'runner_stale', label: 'Unbenannt', enrollment: 'enrolled', ready: false, presence: 'offline', desiredCapacity: 1 },
  ])
  const betweenHeartbeats = await listDashboardRunners(sqliteDashboardDatabase(database), new Date('2026-09-06T12:00:24.000Z'))
  expect(betweenHeartbeats.find((runner) => runner.id === 'runner_enrolled')).toMatchObject({ ready: true, presence: 'online' })
  expect(runners.find((runner) => runner.id === 'runner_enrolled')).toMatchObject({
    reservations: 1, activeJobs: [{ id: 'job_failed', forceQuitCompletedAt: '2026-09-06T11:59:00.000Z', cleanupStatus: 'failed' }],
  })
})

test('runner presence stays online through 40 seconds, late through 90 seconds, then goes offline', async () => {
  const database = new Database(':memory:')
  for (const migration of migrations) database.exec(migration)
  database.run(`INSERT INTO remote_runners (runner_id, kind, desired_capacity, enrollment_state, readiness_state, created_at)
    VALUES ('runner_enrolled', 'remote', 1, 'enrolled', 'ready', '2026-09-06T12:00:00.000Z')`)
  database.run("INSERT INTO runner_credentials VALUES ('runner_enrolled', 'digest-only', '2026-09-06T12:00:00.000Z')")
  database.run("INSERT INTO runner_presence VALUES ('runner_enrolled', '2026-09-06T12:00:00.000Z')")

  for (const [time, presence] of [
    ['12:00:00.000', 'online'],
    ['12:00:40.000', 'online'],
    ['12:00:40.001', 'late'],
    ['12:01:30.000', 'late'],
    ['12:01:30.001', 'offline'],
  ] as const) {
    const [runner] = await listDashboardRunners(sqliteDashboardDatabase(database), new Date(`2026-09-06T${time}Z`))
    expect(runner.presence).toBe(presence)
  }
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

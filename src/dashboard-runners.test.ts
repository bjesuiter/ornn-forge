import { expect, test } from 'bun:test'
import { dashboardRunnersFromRows } from './dashboard-runners'

test('the dashboard keeps runner presence, pause, faults, capacity, and work as independent dimensions', () => {
  const runners = dashboardRunnersFromRows([
    {
      runner_id: 'runner_homeserv1',
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

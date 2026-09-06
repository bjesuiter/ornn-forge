import { expect, test } from 'bun:test'
import { dashboardRunnersFromRows } from './dashboard-runners'

test('the dashboard runner view keeps online state and its active GitHub Issue together', () => {
  const runners = dashboardRunnersFromRows([
    {
      runner_id: 'runner_homeserv1',
      last_seen_at: '2026-09-06T12:00:00.000Z',
      job_id: 'job_v1_active',
      github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 42,
      github_issue_title: 'Show Runner status in the dashboard',
      paused: 0,
    },
    {
      runner_id: 'runner_backup',
      last_seen_at: '2026-09-06T11:59:00.000Z',
      job_id: null,
      github_repository_full_name: null,
      github_issue_number: null,
      github_issue_title: null,
      paused: 1,
    },
  ], '2026-09-06T11:59:40.000Z')

  expect(runners).toEqual([
    {
      id: 'runner_homeserv1',
      online: true,
      paused: false,
      workingOn: {
        repository: 'bjesuiter/ornn-forge',
        issueNumber: 42,
        issueTitle: 'Show Runner status in the dashboard',
      },
    },
    { id: 'runner_backup', online: false, paused: true },
  ])
})

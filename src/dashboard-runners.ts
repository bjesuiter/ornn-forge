export type DashboardRunner = {
  id: string
  online: boolean
  paused: boolean
  workingOn?: {
    repository: string
    issueNumber: number
    issueTitle: string
  }
}

const onlineWindowMs = 20_000

type DashboardRunnerRow = {
  runner_id: string
  last_seen_at: string | null
  job_id: string | null
  github_repository_full_name: string | null
  github_issue_number: number | null
  github_issue_title: string | null
  paused: number
}

export async function listDashboardRunners(
  database: D1Database,
  now = new Date(),
): Promise<DashboardRunner[]> {
  const onlineSince = new Date(now.getTime() - onlineWindowMs).toISOString()
  const result = await database.prepare(`WITH active_work AS (
    SELECT l.runner_id, j.job_id, i.github_repository_full_name,
      i.github_issue_number, i.github_issue_title
    FROM runner_leases l
    JOIN jobs j ON j.job_id = l.job_id AND j.state = 'leased'
    JOIN invocations i ON i.invocation_id = j.invocation_id
  )
  SELECT c.runner_id, p.last_seen_at, w.job_id, w.github_repository_full_name,
    w.github_issue_number, w.github_issue_title, COALESCE(r.paused, 0) AS paused
  FROM runner_credentials c
  LEFT JOIN runner_presence p ON p.runner_id = c.runner_id
  LEFT JOIN active_work w ON w.runner_id = c.runner_id
  LEFT JOIN runner_pauses r ON r.runner_id = c.runner_id
  ORDER BY c.runner_id ASC`).all<{
    runner_id: string
    last_seen_at: string | null
    job_id: string | null
    github_repository_full_name: string | null
    github_issue_number: number | null
    github_issue_title: string | null
    paused: number
  }>()

  return dashboardRunnersFromRows(result.results, onlineSince)
}

export function dashboardRunnersFromRows(
  rows: DashboardRunnerRow[],
  onlineSince: string,
): DashboardRunner[] {
  return rows.map((runner) => ({
    id: runner.runner_id,
    online: runner.last_seen_at !== null && runner.last_seen_at >= onlineSince,
    paused: runner.paused === 1,
    workingOn: runner.job_id === null || runner.github_repository_full_name === null
      || runner.github_issue_number === null || runner.github_issue_title === null
      ? undefined
      : {
          repository: runner.github_repository_full_name,
          issueNumber: runner.github_issue_number,
          issueTitle: runner.github_issue_title,
        },
  }))
}

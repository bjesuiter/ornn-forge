export type DashboardRunner = {
  id: string
  online: boolean
  lastSeenAt?: string
  paused: boolean
  fault?: { code: string; occurredAt: string }
  profile?: {
    release: string
    platform: string
    architecture: string
    runtime: string
    executor: string
    capacity: number
  }
  reservations: number
  activeJobs: DashboardRunnerJob[]
  lastResult?: DashboardRunnerResult
  recentJobs: DashboardRunnerResult[]
}

export type DashboardRunnerJob = {
  id: string
  repository: string
  issueNumber: number
  issueTitle: string
  generation: number
  startedAt: string
  lastHeartbeatAt: string
  expiresAt: string
}

export type DashboardRunnerResult = {
  id: string
  repository: string
  issueNumber: number
  issueTitle: string
  status: 'succeeded'
  startedAt: string
  completedAt: string
}

const onlineWindowMs = 20_000

type DashboardRunnerRow = {
  runner_id: string
  last_seen_at: string | null
  paused: number
  fault_code: string | null
  fault_occurred_at: string | null
  release: string | null
  platform: string | null
  architecture: string | null
  runtime: string | null
  executor: string | null
  capacity: number
  reservations: number
}

type DashboardRunnerJobRow = {
  runner_id: string
  job_id: string
  github_repository_full_name: string
  github_issue_number: number
  github_issue_title: string
  generation: number
  created_at: string
  last_heartbeat_at: string
  expires_at: string
}

type DashboardRunnerResultRow = {
  runner_id: string
  job_id: string
  github_repository_full_name: string
  github_issue_number: number
  github_issue_title: string
  created_at: string
  execution_completed_at: string
}

export async function listDashboardRunners(
  database: D1Database,
  now = new Date(),
): Promise<DashboardRunner[]> {
  const onlineSince = new Date(now.getTime() - onlineWindowMs).toISOString()
  const [runners, activeJobs, completedJobs] = await Promise.all([
    database.prepare(`SELECT c.runner_id, p.last_seen_at, COALESCE(paused.paused, 0) AS paused,
      fault.code AS fault_code, fault.occurred_at AS fault_occurred_at,
      profile.release, profile.platform, profile.architecture, profile.runtime, profile.executor,
      COALESCE(profile.capacity, 1) AS capacity, COALESCE(reservation.count, 0) AS reservations
      FROM runner_credentials c
      LEFT JOIN runner_presence p ON p.runner_id = c.runner_id
      LEFT JOIN runner_pauses paused ON paused.runner_id = c.runner_id
      LEFT JOIN runner_error_states fault ON fault.runner_id = c.runner_id
      LEFT JOIN runner_profiles profile ON profile.runner_id = c.runner_id
      LEFT JOIN (
        SELECT l.runner_id, COUNT(*) AS count FROM runner_leases l
        JOIN jobs j ON j.job_id = l.job_id
        WHERE j.cleanup_status IS NOT 'verified'
        GROUP BY l.runner_id
      ) reservation ON reservation.runner_id = c.runner_id
      ORDER BY c.runner_id ASC`).all<DashboardRunnerRow>(),
    database.prepare(`SELECT l.runner_id, l.job_id, i.github_repository_full_name, i.github_issue_number,
      i.github_issue_title, l.generation, l.created_at, l.last_heartbeat_at, l.expires_at
      FROM runner_leases l
      JOIN jobs j ON j.job_id = l.job_id AND j.state = 'leased'
      JOIN invocations i ON i.invocation_id = j.invocation_id
      ORDER BY l.created_at ASC`).all<DashboardRunnerJobRow>(),
    database.prepare(`WITH ranked_jobs AS (
      SELECT l.runner_id, l.job_id, i.github_repository_full_name, i.github_issue_number,
        i.github_issue_title, l.created_at, j.execution_completed_at,
        ROW_NUMBER() OVER (PARTITION BY l.runner_id ORDER BY j.execution_completed_at DESC) AS position
      FROM runner_leases l
      JOIN jobs j ON j.job_id = l.job_id AND j.state = 'succeeded'
      JOIN invocations i ON i.invocation_id = j.invocation_id
      WHERE j.execution_completed_at IS NOT NULL
    ) SELECT runner_id, job_id, github_repository_full_name, github_issue_number, github_issue_title,
      created_at, execution_completed_at FROM ranked_jobs WHERE position <= 5
      ORDER BY runner_id ASC, execution_completed_at DESC`).all<DashboardRunnerResultRow>(),
  ])

  return dashboardRunnersFromRows(runners.results, onlineSince, activeJobs.results, completedJobs.results)
}

export function dashboardRunnersFromRows(
  rows: DashboardRunnerRow[],
  onlineSince: string,
  activeRows: DashboardRunnerJobRow[] = [],
  completedRows: DashboardRunnerResultRow[] = [],
): DashboardRunner[] {
  const activeJobs = groupRows(activeRows, runnerJobFromRow)
  const completedJobs = groupRows(completedRows, runnerResultFromRow)
  return rows.map((runner) => {
    const recentJobs = completedJobs.get(runner.runner_id) ?? []
    return {
      id: runner.runner_id,
      online: runner.last_seen_at !== null && runner.last_seen_at >= onlineSince,
      lastSeenAt: runner.last_seen_at ?? undefined,
      paused: runner.paused === 1,
      fault: runner.fault_code === null || runner.fault_occurred_at === null
        ? undefined
        : { code: runner.fault_code, occurredAt: runner.fault_occurred_at },
      profile: runner.release === null || runner.platform === null || runner.architecture === null
        || runner.runtime === null || runner.executor === null
        ? undefined
        : {
            release: runner.release, platform: runner.platform, architecture: runner.architecture,
            runtime: runner.runtime, executor: runner.executor, capacity: runner.capacity,
          },
      reservations: runner.reservations,
      activeJobs: activeJobs.get(runner.runner_id) ?? [],
      lastResult: recentJobs[0],
      recentJobs,
    }
  })
}

function groupRows<T extends { runner_id: string }, TResult>(rows: T[], map: (row: T) => TResult) {
  const grouped = new Map<string, TResult[]>()
  for (const row of rows) grouped.set(row.runner_id, [...(grouped.get(row.runner_id) ?? []), map(row)])
  return grouped
}

function runnerJobFromRow(row: DashboardRunnerJobRow): DashboardRunnerJob {
  return {
    id: row.job_id, repository: row.github_repository_full_name, issueNumber: row.github_issue_number,
    issueTitle: row.github_issue_title, generation: row.generation, startedAt: row.created_at,
    lastHeartbeatAt: row.last_heartbeat_at, expiresAt: row.expires_at,
  }
}

function runnerResultFromRow(row: DashboardRunnerResultRow): DashboardRunnerResult {
  return {
    id: row.job_id, repository: row.github_repository_full_name, issueNumber: row.github_issue_number,
    issueTitle: row.github_issue_title, status: 'succeeded', startedAt: row.created_at,
    completedAt: row.execution_completed_at,
  }
}

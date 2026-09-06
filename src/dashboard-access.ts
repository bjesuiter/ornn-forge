const dashboardLoginRetentionDays = 30
const rejectedDashboardLoginLimit = 1_000

export function allowsDashboardSession(githubId: string | number, configuredGitHubIds: string): boolean {
  return configuredGitHubIds.split(',').some((configuredId) => configuredId.trim() === String(githubId))
}

export interface RejectedDashboardLogin {
  githubId: string | number
  githubLogin: string
  reason: 'github-id-not-allowed'
}

interface RejectedDashboardLoginCleanupStatement {
  sql: string
  params: string[]
}

export function rejectedDashboardLoginCleanupStatements(now: Date): RejectedDashboardLoginCleanupStatement[] {
  const expiredBefore = new Date(
    now.getTime() - dashboardLoginRetentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString()

  return [
    {
      sql: 'DELETE FROM rejected_dashboard_logins WHERE created_at < ?',
      params: [expiredBefore],
    },
    {
      sql: `DELETE FROM rejected_dashboard_logins
        WHERE rejected_dashboard_login_id IN (
          SELECT rejected_dashboard_login_id
          FROM rejected_dashboard_logins
          ORDER BY created_at DESC, rejected_dashboard_login_id DESC
          LIMIT -1 OFFSET ?
        )`,
      params: [String(rejectedDashboardLoginLimit)],
    },
  ]
}

export async function recordRejectedDashboardLogin(
  database: D1Database,
  rejectedLogin: RejectedDashboardLogin,
) {
  const now = new Date()
  const statements = rejectedDashboardLoginCleanupStatements(now)
  await database.batch([
    database.prepare(`INSERT INTO rejected_dashboard_logins (
      rejected_dashboard_login_id, github_id, github_login, reason, created_at
    ) VALUES (?, ?, ?, ?, ?)`).bind(
      `rdl_v1_${crypto.randomUUID()}`,
      String(rejectedLogin.githubId),
      rejectedLogin.githubLogin,
      rejectedLogin.reason,
      now.toISOString(),
    ),
    ...prepareStatements(database, statements),
  ])
}

export async function cleanupRejectedDashboardLogins(database: D1Database, now = new Date()) {
  await database.batch(prepareStatements(database, rejectedDashboardLoginCleanupStatements(now)))
}

function prepareStatements(
  database: D1Database,
  statements: RejectedDashboardLoginCleanupStatement[],
) {
  return statements.map((statement) => database.prepare(statement.sql).bind(...statement.params))
}

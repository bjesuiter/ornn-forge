export type DashboardWebhook = {
  id: string
  repository: string
  issueNumber: number
  issueTitle: string
  receivedAt: string
  source: 'issue' | 'comment'
  status: 'queued' | 'running' | 'completed' | 'message_uncertain'
}

type DashboardWebhookRow = {
  github_delivery_id: string
  github_repository_full_name: string
  github_issue_number: number
  github_issue_title: string
  github_comment_id: string
  accepted_at: string
  state: 'pending' | 'leased' | 'succeeded'
  latest_attempt: 'pending' | 'succeeded' | 'uncertain' | 'failed' | null
}

export async function listDashboardWebhooks(database: D1Database): Promise<DashboardWebhook[]> {
  const result = await database.prepare(`SELECT d.github_delivery_id, i.github_repository_full_name,
    i.github_issue_number, i.github_issue_title, i.github_comment_id, d.accepted_at, j.state,
    m.latest_attempt
    FROM deliveries d
    JOIN invocations i ON i.invocation_id = d.invocation_id
    JOIN jobs j ON j.job_id = d.job_id
    LEFT JOIN ornn_messages m ON m.job_id = j.job_id
    ORDER BY d.accepted_at DESC, d.github_delivery_id DESC
    LIMIT 50`).all<DashboardWebhookRow>()

  return dashboardWebhooksFromRows(result.results)
}

export function dashboardWebhooksFromRows(rows: DashboardWebhookRow[]): DashboardWebhook[] {
  return rows.map((row) => ({
    id: row.github_delivery_id,
    repository: row.github_repository_full_name,
    issueNumber: row.github_issue_number,
    issueTitle: row.github_issue_title,
    receivedAt: row.accepted_at,
    source: row.github_comment_id.startsWith('issue-description:') ? 'issue' : 'comment',
    status: webhookStatus(row.state, row.latest_attempt),
  }))
}

function webhookStatus(
  state: DashboardWebhookRow['state'],
  latestAttempt: DashboardWebhookRow['latest_attempt'],
): DashboardWebhook['status'] {
  if (latestAttempt === 'uncertain' || latestAttempt === 'failed') return 'message_uncertain'
  if (state === 'succeeded') return 'completed'
  return state === 'leased' ? 'running' : 'queued'
}

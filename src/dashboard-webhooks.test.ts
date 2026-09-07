import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { dashboardWebhooksFromRows, listDashboardWebhooks, type DashboardWebhookDatabase } from './dashboard-webhooks'

const migrations = [
  '0001_admit_analyze_invocation.sql',
  '0002_fixture_runner.sql',
  '0007_record_runner_diagnostics.sql',
  '0008_create_remote_runner_identities.sql',
  '0011_add_runner_hardware_model.sql',
  '0012_add_runner_labels.sql',
  '0013_add_dashboard_read_models.sql',
].map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))

test('the dashboard expresses each accepted webhook by its source and latest processing state', () => {
  const webhooks = dashboardWebhooksFromRows([
    {
      github_delivery_id: 'delivery-completed', github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 42, github_issue_title: 'Show recent webhooks', github_comment_id: '18',
      accepted_at: '2026-09-06T12:00:00.000Z', state: 'succeeded', runner_id: 'runner_homeserv1', latest_attempt: 'succeeded',
    },
    {
      github_delivery_id: 'delivery-running', github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 43, github_issue_title: 'Process an issue body', github_comment_id: 'issue-description:503',
      accepted_at: '2026-09-06T11:59:00.000Z', state: 'leased', runner_id: 'runner_homeserv1', latest_attempt: 'pending',
    },
    {
      github_delivery_id: 'delivery-uncertain', github_repository_full_name: 'bjesuiter/ornn-forge',
      github_issue_number: 44, github_issue_title: 'Publish the result', github_comment_id: '19',
      accepted_at: '2026-09-06T11:58:00.000Z', state: 'succeeded', runner_id: null, latest_attempt: 'uncertain',
    },
  ])

  expect(webhooks).toEqual([
    {
      id: 'delivery-completed', repository: 'bjesuiter/ornn-forge', issueNumber: 42,
      issueTitle: 'Show recent webhooks', receivedAt: '2026-09-06T12:00:00.000Z',
      source: 'comment', runnerId: 'runner_homeserv1', status: 'completed',
    },
    {
      id: 'delivery-running', repository: 'bjesuiter/ornn-forge', issueNumber: 43,
      issueTitle: 'Process an issue body', receivedAt: '2026-09-06T11:59:00.000Z',
      source: 'issue', runnerId: 'runner_homeserv1', status: 'running',
    },
    {
      id: 'delivery-uncertain', repository: 'bjesuiter/ornn-forge', issueNumber: 44,
      issueTitle: 'Publish the result', receivedAt: '2026-09-06T11:58:00.000Z',
      source: 'comment', status: 'message_uncertain',
    },
  ])
})

test('the dashboard loads only the 50 newest accepted webhooks before resolving their details', async () => {
  const database = new Database(':memory:')
  for (const migration of migrations) database.exec(migration)
  for (let index = 1; index <= 51; index += 1) {
    const id = String(index).padStart(2, '0')
    database.run(`INSERT INTO invocations VALUES (
      'inv_${id}', 1, 'delivery_${id}', '42', '99', 'bjesuiter/ornn-forge', ${index},
      'Issue ${id}', '', 'comment_${id}', '', 'bjesuiter', '{}', 'policy', '2026-09-07T12:00:${id}.000Z'
    )`)
    database.run(`INSERT INTO jobs (
      job_id, schema_version, invocation_id, state, flow_id, flow_version_id, policy_version_id, created_at
    ) VALUES ('job_${id}', 1, 'inv_${id}', 'pending', 'analyze', 'flow', 'policy', '2026-09-07T12:00:${id}.000Z')`)
    database.run(`INSERT INTO deliveries VALUES (
      'delivery_${id}', 'digest', 'inv_${id}', 'job_${id}', '2026-09-07T12:00:${id}.000Z'
    )`)
  }

  const webhooks = await listDashboardWebhooks(sqliteDashboardDatabase(database))

  expect(webhooks).toHaveLength(50)
  expect(webhooks[0]?.id).toBe('delivery_51')
  expect(webhooks.at(-1)?.id).toBe('delivery_02')
})

function sqliteDashboardDatabase(database: Database): DashboardWebhookDatabase {
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

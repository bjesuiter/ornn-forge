import { expect, test } from 'bun:test'
import { dashboardWebhooksFromRows } from './dashboard-webhooks'

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

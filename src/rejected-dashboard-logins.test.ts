import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { rejectedDashboardLoginCleanupStatements } from './dashboard-access'

const migration = readFileSync(
  new URL('../migrations/0004_record_rejected_dashboard_logins.sql', import.meta.url),
  'utf8',
)

test('removes expired Rejected dashboard logins and keeps the newest 1,000', () => {
  const database = new Database(':memory:')
  const now = new Date('2026-09-06T12:00:00.000Z')
  database.exec(migration)
  database.run(
    `INSERT INTO rejected_dashboard_logins
      (rejected_dashboard_login_id, github_id, github_login, reason, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    ['expired', '111', 'expired-account', 'github-id-not-allowed', '2026-08-06T12:00:00.000Z'],
  )

  for (let index = 1; index <= 1001; index += 1) {
    database.run(
      `INSERT INTO rejected_dashboard_logins
        (rejected_dashboard_login_id, github_id, github_login, reason, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      [
        `recent-${index}`,
        String(index),
        `github-account-${index}`,
        'github-id-not-allowed',
        new Date(now.getTime() - index * 1_000).toISOString(),
      ],
    )
  }

  for (const statement of rejectedDashboardLoginCleanupStatements(now)) {
    database.run(statement.sql, statement.params)
  }

  expect(database.query('SELECT count(*) AS count FROM rejected_dashboard_logins').get()).toEqual({ count: 1000 })
  expect(database.query("SELECT rejected_dashboard_login_id FROM rejected_dashboard_logins WHERE rejected_dashboard_login_id = 'expired'").get()).toBeNull()
  expect(database.query("SELECT rejected_dashboard_login_id FROM rejected_dashboard_logins WHERE rejected_dashboard_login_id = 'recent-1001'").get()).toBeNull()
  expect(database.query("SELECT rejected_dashboard_login_id FROM rejected_dashboard_logins WHERE rejected_dashboard_login_id = 'recent-1000'").get()).toEqual({ rejected_dashboard_login_id: 'recent-1000' })
})

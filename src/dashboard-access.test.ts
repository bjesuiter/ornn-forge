import { expect, test } from 'bun:test'
import { allowsDashboardSession } from './dashboard-access'

test('grants a Dashboard session only to a GitHub account on the Operator allowlist', () => {
  expect(allowsDashboardSession(2365676, '2365676, 4815162342')).toBe(true)
  expect(allowsDashboardSession(999999999, '2365676, 4815162342')).toBe(false)
})

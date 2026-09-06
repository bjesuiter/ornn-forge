import { expect, test } from 'bun:test'
import {
  decryptOpenAiSubscriptionCredential,
  encryptOpenAiSubscriptionCredential,
  openAiSubscriptionUsageFromResponse,
} from './openai-subscription-usage'

test('the dashboard keeps only bounded subscription values from the OpenAI response', () => {
  expect(openAiSubscriptionUsageFromResponse({
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 27.4, reset_at: 1_788_696_600 },
      secondary_window: { used_percent: 140, reset_at: 1_788_783_000 },
    },
  }, '2026-09-06T12:00:00.000Z')).toEqual({
    status: 'available',
    plan: 'pro',
    credits: undefined,
    checkedAt: '2026-09-06T12:00:00.000Z',
    windows: [
      { label: '5 Stunden', usedPercent: 27.4, resetsAt: '2026-09-06T12:10:00.000Z' },
      { label: 'Woche', usedPercent: 100, resetsAt: '2026-09-07T12:10:00.000Z' },
    ],
  })
})

test('the reusable OAuth record is unreadable without the Secrets Store key', async () => {
  const key = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY'
  const record = await encryptOpenAiSubscriptionCredential(key, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accountId: 'acct-private',
  })

  expect(record).not.toContain('access-token')
  expect(record).not.toContain('refresh-token')
  expect(record).not.toContain('acct-private')
  await expect(decryptOpenAiSubscriptionCredential(key, record)).resolves.toEqual({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accountId: 'acct-private',
  })
})

test('the dashboard rejects an OpenAI response without a usable rate-limit window', () => {
  expect(openAiSubscriptionUsageFromResponse({ plan_type: 'pro', rate_limit: {} }, '2026-09-06T12:00:00.000Z')).toEqual({
    status: 'unavailable',
    reason: 'upstream_error',
  })
})

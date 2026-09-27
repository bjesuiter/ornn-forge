import { expect, test } from 'bun:test'
import type { LeaseGrant } from '@ornn-forge/protocol'
import { offerNextLease } from './lease-offer'

const lease: LeaseGrant = {
  jobId: 'job_v1_test',
  leaseToken: 'lease_v1_test',
  generation: 1,
  expiresAt: '2026-09-27T22:00:00.000Z',
  repository: { fullName: 'bjesuiter/ornn-forge' },
  workOrder: { issueNumber: 24, title: 'Test', body: '', comment: '' },
}
const checkout = {
  repository: 'bjesuiter/ornn-forge',
  revision: 'a'.repeat(40),
  archiveUrl: `https://api.github.com/repos/bjesuiter/ornn-forge/tarball/${'a'.repeat(40)}`,
  token: 'short-lived-token',
  expiresAt: '2026-09-27T22:00:00.000Z',
}

test('records the exact checkout before sending the lease', async () => {
  const order: string[] = []
  await offerNextLease(
    { send: () => { order.push('sent') } },
    {
      pollRunner: async () => lease,
      recordLeaseCheckout: async (input) => {
        expect(input).toEqual({
          runnerId: 'runner_test', jobId: lease.jobId, leaseToken: lease.leaseToken,
          repository: checkout.repository, revision: checkout.revision,
        })
        order.push('recorded')
        return true
      },
    },
    'runner_test', {} as Cloudflare.Env, async () => checkout,
  )
  expect(order).toEqual(['recorded', 'sent'])
})

test('does not send a lease when its checkout cannot be recorded', async () => {
  const sent: string[] = []
  const released: string[] = []
  await offerNextLease(
    { send: (message) => { sent.push(String(message)) } },
    {
      pollRunner: async () => lease,
      recordLeaseCheckout: async () => false,
      releaseLease: async (input) => { released.push(input.jobId); return true },
    },
    'runner_test', {} as Cloudflare.Env, async () => checkout,
  )
  expect(sent).toEqual([])
  expect(released).toEqual([lease.jobId])
})

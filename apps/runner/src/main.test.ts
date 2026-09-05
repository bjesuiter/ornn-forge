import { expect, test } from 'bun:test'
import { createControlPlane, createInMemoryInvocationStore } from '../../../src/control-plane'
import { executeFixtureLease } from './main'

test('the deterministic Runner fixture uses the production polling protocol', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: 'secret', githubInstallationId: '42', githubRepositoryId: '99',
    operatorBearerSecret: 'o'.repeat(32), runnerCredentialId: 'runner_homeserv1', runnerCredentialSecret: 'r'.repeat(32),
  })
  const store = app as unknown as { fetch(request: Request): Promise<Response> }
  const source = new TextEncoder().encode(JSON.stringify({
    action: 'created', installation: { id: 42 }, repository: { id: 99, full_name: 'bjesuiter/ornn-forge' },
    issue: { number: 23, title: 'Fixture', body: '' }, comment: { id: 2, body: '@ornn', user: { login: 'bjesuiter' } }, sender: { login: 'bjesuiter' },
  }))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, source)).toString('hex')
  await store.fetch(new Request('https://control.test/api/v1/github/webhook', {
    method: 'POST', headers: { 'x-github-event': 'issue_comment', 'x-github-delivery': 'runner-fixture', 'x-hub-signature-256': `sha256=${signature}` }, body: source,
  }))
  const request = (input: URL, init?: RequestInit) => app.fetch(new Request(input, init))
  await expect(executeFixtureLease({ controlPlaneUrl: 'https://control.test', runnerId: 'runner_homeserv1', credential: 'r'.repeat(32) }, request))
    .resolves.toBe('completed')
})

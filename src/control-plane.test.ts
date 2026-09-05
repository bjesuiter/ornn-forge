import { expect, test } from 'bun:test'
import { createControlPlane, createInMemoryInvocationStore } from './control-plane'

const webhookSecret = 'webhook-secret'
const operatorSecret = 'o'.repeat(32)

async function signedWebhookRequest(
  deliveryId: string,
  payload: Record<string, unknown>,
  event = 'issue_comment',
) {
  const body = JSON.stringify(payload)
  return signedRawWebhookRequest(deliveryId, new TextEncoder().encode(body), event)
}

async function signedRawWebhookRequest(deliveryId: string, body: Uint8Array, event = 'issue_comment') {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    body as unknown as BufferSource,
  )

  return new Request('https://ornn.example/api/v1/github/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': deliveryId,
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${Buffer.from(signature).toString('hex')}`,
    },
    body: body as unknown as BodyInit,
  })
}

function issueComment(actor = 'bjesuiter') {
  return {
    action: 'created',
    installation: { id: 42 },
    repository: { id: 99, full_name: 'bjesuiter/ornn-forge' },
    issue: { number: 22, title: 'Admit one', body: 'Please analyze this.' },
    comment: { id: 123, body: '@ornn analyze', user: { login: actor } },
    sender: { login: actor },
  }
}

function issueOpened(body = 'Please ask @ornn-forge to analyze this.') {
  return {
    action: 'opened',
    installation: { id: 42 },
    repository: { id: 99, full_name: 'bjesuiter/ornn-forge' },
    issue: { id: 456, number: 23, title: 'Analyze this issue', body },
    sender: { login: 'bjesuiter' },
  }
}

test('admits one signed delivery and lets the operator inspect its pending Analyze Job', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })

  const admitted = await app.fetch(await signedWebhookRequest('delivery-1', issueComment()))

  expect(admitted.status).toBe(201)
  const accepted = await admitted.json() as { apiVersion: string; invocationId: string; jobId: string }
  expect(accepted.apiVersion).toBe('v1')
  expect(accepted.invocationId).toMatch(/^inv_v1_/)
  expect(accepted.jobId).toMatch(/^job_v1_/)

  const inspected = await app.fetch(
    new Request(`https://ornn.example/api/v1/jobs/${accepted.jobId}`, {
      headers: { authorization: `Bearer ${operatorSecret}` },
    }),
  )

  expect(inspected.status).toBe(200)
  expect(inspected.headers.get('cache-control')).toBe('no-store')
  const inspection = await inspected.json() as { events: Array<{ id: string; type: string; revision: string }> }
  expect(inspection).toMatchObject({
    apiVersion: 'v1',
    principal: 'operator:bjesuiter',
    job: {
      id: accepted.jobId,
      state: 'pending',
      flow: { id: 'analyze', versionId: expect.stringMatching(/^fv_v1_/) },
      policy: { versionId: expect.stringMatching(/^pv_v1_/) },
    },
  })
  expect(inspection.events).toMatchObject([
    { id: expect.stringMatching(/^evt_v1_/), type: 'job.created', revision: '1' },
    { id: expect.stringMatching(/^evt_v1_/), type: 'job.pending', revision: '2' },
  ])
  expect(inspection.events).toHaveLength(2)
})

test('admits an Issue opened with an @ornn-forge mention in its description', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    githubRepositoryFullName: 'bjesuiter/ornn-forge',
    operatorBearerSecret: operatorSecret,
  })

  const admitted = await app.fetch(await signedWebhookRequest('delivery-description-1', issueOpened(), 'issues'))

  expect(admitted.status).toBe(201)
  const accepted = await admitted.json() as { jobId: string }
  const inspected = await app.fetch(new Request(`https://ornn.example/api/v1/jobs/${accepted.jobId}`, {
    headers: { authorization: `Bearer ${operatorSecret}` },
  }))
  expect(await inspected.json()).toMatchObject({
    invocation: {
      github: {
        issue: { number: 23, body: 'Please ask @ornn-forge to analyze this.' },
        comment: { id: 'issue-description:456:delivery-description-1', body: 'Please ask @ornn-forge to analyze this.' },
      },
    },
  })
})

test('admits an Issue opened with a bare ornn-forge mention in its description', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })

  const admitted = await app.fetch(await signedWebhookRequest(
    'delivery-description-bare-1',
    issueOpened('Please have ornn-forge analyze this.'),
    'issues',
  ))

  expect(admitted.status).toBe(201)
})

test('admits an Issue after its description is edited to mention @ornn-forge', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })
  const payload = {
    ...issueOpened(),
    action: 'edited',
    changes: { body: { from: 'A normal issue description.' } },
  }

  const admitted = await app.fetch(await signedWebhookRequest('delivery-description-3', payload, 'issues'))

  expect(admitted.status).toBe(201)
})

test('admits an edited Issue when GitHub omits change metadata', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })
  const payload = { ...issueOpened(), action: 'edited' }

  const admitted = await app.fetch(await signedWebhookRequest('delivery-description-4', payload, 'issues'))

  expect(admitted.status).toBe(201)
})

test('ignores Issues that do not mention @ornn-forge in their description', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })

  const ignored = await app.fetch(await signedWebhookRequest(
    'delivery-description-2',
    issueOpened('A normal issue description.'),
    'issues',
  ))

  expect(ignored.status).toBe(202)
})

test('replays an identical delivery and rejects the same identity with a different body', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })
  const first = await app.fetch(await signedWebhookRequest('delivery-2', issueComment()))
  const firstBody = await first.json() as { invocationId: string; jobId: string }

  const replay = await app.fetch(await signedWebhookRequest('delivery-2', issueComment()))
  expect(replay.status).toBe(200)
  expect(await replay.json()).toMatchObject({ ...firstBody, replayed: true })

  const conflict = await app.fetch(await signedWebhookRequest('delivery-2', {
    ...issueComment(),
    comment: { id: 123, body: '@ornn analyze a different request', user: { login: 'bjesuiter' } },
  }))
  expect(conflict.status).toBe(409)

  const inspected = await app.fetch(new Request(`https://ornn.example/api/v1/jobs/${firstBody.jobId}`, {
    headers: { authorization: `Bearer ${operatorSecret}` },
  }))
  expect((await inspected.json() as { invocation: { github: { comment: { body: string } } } }).invocation.github.comment.body).toBe('@ornn analyze')
})

test('does not admit invalid signatures or unauthorized actors', async () => {
  let admissions = 0
  const store = {
    admit: async () => {
      admissions += 1
      throw new Error('admission must not be attempted')
    },
    inspectJob: async () => undefined,
  }
  const app = createControlPlane({
    store,
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })
  const invalidSignature = await signedWebhookRequest('delivery-3', issueComment())
  invalidSignature.headers.set('x-hub-signature-256', 'sha256:not-a-signature')
  expect((await app.fetch(invalidSignature)).status).toBe(401)
  expect((await app.fetch(await signedWebhookRequest('delivery-4', issueComment('not-bjesuiter')))).status).toBe(403)
  expect(admissions).toBe(0)
})

test('verifies the raw body before decoding it for payload validation', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })

  const response = await app.fetch(await signedRawWebhookRequest('delivery-raw', new Uint8Array([0xff])))
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } })
})

test('authenticates an operator before looking up a Job', async () => {
  let lookups = 0
  const app = createControlPlane({
    store: {
      admit: async () => { throw new Error('not used') },
      inspectJob: async () => {
        lookups += 1
        return undefined
      },
    },
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
  })

  const response = await app.fetch(new Request('https://ornn.example/api/v1/jobs/job_v1_unknown'))
  expect(response.status).toBe(401)
  expect(lookups).toBe(0)
})

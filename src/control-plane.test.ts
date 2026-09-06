import { expect, test } from 'bun:test'
import { createControlPlane, createInMemoryInvocationStore } from './control-plane'
import { envelope } from '@ornn-forge/protocol'

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

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
  const inspection = await inspected.json() as { events: Array<{ id: string; type: string; revision: string }>; message: { id: string } }
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

  const resolved = await app.fetch(new Request(`https://ornn.example/api/v1/messages/${inspection.message.id}`, {
    headers: { authorization: `Bearer ${operatorSecret}` },
  }))
  expect(await resolved.json()).toMatchObject({ job: { id: accepted.jobId }, message: { id: inspection.message.id } })
})

test('issues independent, short-lived, one-time Setup tokens for Remote Runner enrollment', async () => {
  let now = new Date('2026-09-06T12:00:00.000Z')
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
    now: () => now,
  })
  const operatorRequest = (path: string, body: unknown) => app.fetch(new Request(`https://ornn.example${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${operatorSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  const setupRequest = (path: string, body: unknown) => app.fetch(new Request(`https://ornn.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

  const firstCreated = await operatorRequest('/api/v1/runners', { capacity: 2 })
  const secondCreated = await operatorRequest('/api/v1/runners', { capacity: 3 })
  expect(firstCreated.status).toBe(201)
  expect(secondCreated.status).toBe(201)
  const first = await firstCreated.json() as { runner: { id: string; desiredCapacity: number; enrollment: string; ready: boolean }; setupToken: string }
  const second = await secondCreated.json() as { runner: { id: string; desiredCapacity: number }; setupToken: string }
  expect(first).toMatchObject({ runner: { desiredCapacity: 2, enrollment: 'awaiting_setup', ready: false } })
  expect(first.runner.id).toMatch(/^runner_v1_/)
  expect(first.setupToken).toMatch(/^setup_v1_/)
  expect(second.runner).toMatchObject({ desiredCapacity: 3 })
  expect(second.runner.id).toMatch(/^runner_v1_/)
  expect(second.runner.id).not.toBe(first.runner.id)

  expect((await setupRequest('/api/v1/runner/setup/preflight', { setupToken: first.setupToken })).status).toBe(200)
  const regenerated = await operatorRequest(`/api/v1/runners/${first.runner.id}/setup-token`, {})
  expect(regenerated.status).toBe(201)
  const replacement = await regenerated.json() as { setupToken: string }
  expect(replacement.setupToken).not.toBe(first.setupToken)
  expect((await setupRequest('/api/v1/runner/setup/preflight', { setupToken: first.setupToken })).status).toBe(401)

  const secondCredential = 'r'.repeat(32)
  expect((await setupRequest('/api/v1/runner/setup/enroll', {
    setupToken: second.setupToken,
    credentialDigest: await sha256Hex(secondCredential),
  })).status).toBe(201)
  const authenticatedPoll = await app.fetch(new Request('https://ornn.example/api/v1/runner/poll', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secondCredential}`,
      'content-type': 'application/json',
      'x-ornn-runner-id': second.runner.id,
    },
    body: JSON.stringify(envelope('runner.poll', { runnerId: second.runner.id, ready: true })),
  }))
  expect(authenticatedPoll.status).toBe(200)
  expect((await setupRequest('/api/v1/runner/setup/preflight', { setupToken: second.setupToken })).status).toBe(401)
  expect((await setupRequest('/api/v1/runner/setup/enroll', {
    setupToken: second.setupToken,
    credentialDigest: 'b'.repeat(64),
  })).status).toBe(401)

  now = new Date('2026-09-06T12:16:00.000Z')
  expect((await setupRequest('/api/v1/runner/setup/preflight', { setupToken: replacement.setupToken })).status).toBe(401)
})

test('leases one pending Job to its authenticated Runner and records its fixture Analysis artifact', async () => {
  const calls: string[] = []
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
    runnerCredentialId: 'runner_homeserv1',
    runnerCredentialSecret: 'r'.repeat(32),
    messagePublisher: {
      reconcile: async () => undefined,
      create: async ({ body }) => { calls.push(`create:${body}`); return { githubCommentId: '17' } },
      update: async ({ githubCommentId, body }) => { calls.push(`update:${githubCommentId}:${body}`) },
    },
  })
  const admitted = await app.fetch(await signedWebhookRequest('delivery-runner-1', issueComment()))
  const { jobId } = await admitted.json() as { jobId: string }
  const runnerRequest = (type: string, payload: Record<string, unknown>) => new Request(`https://ornn.example/api/v1/runner/${type}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${'r'.repeat(32)}`,
      'content-type': 'application/json',
      'x-ornn-runner-id': 'runner_homeserv1',
    },
    body: JSON.stringify(envelope(`runner.${type}`, payload)),
  })

  const polled = await app.fetch(runnerRequest('poll', { runnerId: 'runner_homeserv1' }))
  expect(polled.status).toBe(200)
  const leased = await polled.json() as { type: 'runner.lease'; payload: { jobId: string; leaseToken: string; generation: number } }
  expect(leased).toMatchObject({ type: 'runner.lease', payload: { jobId, generation: 1 } })
  expect(leased.payload.leaseToken).toMatch(/^lease_v1_/)

  const duplicatePoll = await app.fetch(runnerRequest('poll', { runnerId: 'runner_homeserv1' }))
  expect(await duplicatePoll.json()).toMatchObject({ type: 'runner.no_work' })

  const heartbeat = await app.fetch(runnerRequest('heartbeat', {
    runnerId: 'runner_homeserv1', jobId, leaseToken: leased.payload.leaseToken,
  }))
  expect(await heartbeat.json()).toMatchObject({ type: 'lease.accepted', payload: { jobId } })

  const result = await app.fetch(runnerRequest('result', {
    runnerId: 'runner_homeserv1', jobId, leaseToken: leased.payload.leaseToken,
    artifact: { schemaVersion: 1, kind: 'plan', summary: 'Fixture analysis complete', details: 'The fixture executor completed.' },
  }))
  expect(await result.json()).toMatchObject({ type: 'lease.accepted', payload: { jobId } })

  const inspected = await app.fetch(new Request(`https://ornn.example/api/v1/jobs/${jobId}`, {
    headers: { authorization: `Bearer ${operatorSecret}` },
  }))
  expect(await inspected.json()).toMatchObject({
    job: { id: jobId, state: 'succeeded' },
    artifact: { kind: 'plan', summary: 'Fixture analysis complete' },
    executionOutcome: { status: 'succeeded' },
    cleanupStatus: { status: 'verified' },
    message: { id: expect.stringMatching(/^om_v1_/), githubCommentId: '17', revision: 2, latestAttempt: 'succeeded' },
  })
  expect(calls).toHaveLength(2)
  expect(calls[0]).toContain('create:Ornn Analyze Job accepted')
  expect(calls[1]).toContain('update:17:Ornn Analyze Job completed: Fixture analysis complete')
})

test('a paused Runner receives no new lease until an Operator resumes it', async () => {
  const store = createInMemoryInvocationStore()
  const app = createControlPlane({
    store,
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
    runnerCredentialId: 'runner_homeserv1',
    runnerCredentialSecret: 'r'.repeat(32),
  })
  const poll = () => app.fetch(new Request('https://ornn.example/api/v1/runner/poll', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${'r'.repeat(32)}`,
      'content-type': 'application/json',
      'x-ornn-runner-id': 'runner_homeserv1',
    },
    body: JSON.stringify(envelope('runner.poll', { runnerId: 'runner_homeserv1' })),
  }))

  expect(await (await poll()).json()).toMatchObject({ type: 'runner.no_work' })
  expect(await store.setRunnerPaused?.('runner_homeserv1', true)).toBe(true)
  const admitted = await app.fetch(await signedWebhookRequest('delivery-paused-runner-1', issueComment()))
  const { jobId } = await admitted.json() as { jobId: string }

  expect(await (await poll()).json()).toMatchObject({ type: 'runner.no_work' })
  const pending = await app.fetch(new Request(`https://ornn.example/api/v1/jobs/${jobId}`, {
    headers: { authorization: `Bearer ${operatorSecret}` },
  }))
  expect(await pending.json()).toMatchObject({ job: { state: 'pending' } })

  expect(await store.setRunnerPaused?.('runner_homeserv1', false)).toBe(true)
  expect(await (await poll()).json()).toMatchObject({ type: 'runner.lease', payload: { jobId } })
})

test('records a Runner fault until that Runner completes a valid protocol operation', async () => {
  const store = createInMemoryInvocationStore()
  const faults: string[] = []
  let successfulOperations = 0
  store.recordRunnerFault = async (_runnerId, fault) => { faults.push(fault.code) }
  store.recordRunnerSuccess = async () => { successfulOperations += 1 }
  const app = createControlPlane({
    store,
    githubWebhookSecret: webhookSecret,
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret,
    runnerCredentialId: 'runner_homeserv1',
    runnerCredentialSecret: 'r'.repeat(32),
  })
  const request = (operation: string, payload: Record<string, unknown>) => app.fetch(new Request(`https://ornn.example/api/v1/runner/${operation}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${'r'.repeat(32)}`, 'content-type': 'application/json', 'x-ornn-runner-id': 'runner_homeserv1' },
    body: JSON.stringify(envelope(`runner.${operation}`, payload)),
  }))

  expect(await (await request('report', { runnerId: 'runner_homeserv1', fault: { code: 'runner.operation_failed' } })).json())
    .toMatchObject({ type: 'runner.accepted' })
  expect(faults).toEqual(['runner.operation_failed'])

  expect(await (await request('poll', { runnerId: 'runner_homeserv1' })).json()).toMatchObject({ type: 'runner.no_work' })
  expect(successfulOperations).toBe(1)
})

test('rejects unsupported protocol and wrong lease tokens without changing the pending Job', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(), githubWebhookSecret: webhookSecret, githubInstallationId: '42', githubRepositoryId: '99',
    operatorBearerSecret: operatorSecret, runnerCredentialId: 'runner_homeserv1', runnerCredentialSecret: 'r'.repeat(32),
  })
  const admitted = await app.fetch(await signedWebhookRequest('delivery-rejection-1', issueComment()))
  const { jobId } = await admitted.json() as { jobId: string }
  const request = (operation: string, body: unknown) => app.fetch(new Request(`https://ornn.example/api/v1/runner/${operation}`, {
    method: 'POST', headers: { authorization: `Bearer ${'r'.repeat(32)}`, 'content-type': 'application/json', 'x-ornn-runner-id': 'runner_homeserv1' }, body: JSON.stringify(body),
  }))
  const unsupported = await request('poll', { protocol: { major: 2 }, type: 'runner.poll', payload: { runnerId: 'runner_homeserv1' } })
  expect(unsupported.status).toBe(426)
  const poll = await request('poll', envelope('runner.poll', { runnerId: 'runner_homeserv1' }))
  const lease = await poll.json() as { payload: { leaseToken: string } }
  const wrong = await request('heartbeat', envelope('runner.heartbeat', { runnerId: 'runner_homeserv1', jobId, leaseToken: 'lease_v1_wrong' }))
  expect(wrong.status).toBe(403)
  const inspected = await app.fetch(new Request(`https://ornn.example/api/v1/jobs/${jobId}`, { headers: { authorization: `Bearer ${operatorSecret}` } }))
  const inspection = await inspected.json() as { job: { state: string }; artifact?: unknown }
  expect(inspection).toMatchObject({ job: { state: 'leased' } })
  expect(inspection.artifact).toBeUndefined()
  expect(lease.payload.leaseToken).toMatch(/^lease_v1_/)
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

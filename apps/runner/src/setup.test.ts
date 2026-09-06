import { expect, test } from 'bun:test'
import { createControlPlane, createInMemoryInvocationStore } from '../../../src/control-plane'
import { enrollRemoteRunner } from './setup'

test('the setup flow preflights before persisting a credential and finalizes with only its digest', async () => {
  const requests: Array<{ path: string; body: unknown }> = []
  const persisted: Array<{ runnerId: string; credential: string }> = []
  const credential = 'r'.repeat(43)

  const runner = await enrollRemoteRunner({
    controlPlaneUrl: 'https://control.test',
    setupToken: 'setup_v1_abcdefghijklmnopqrstuv',
    createCredential: () => credential,
    persistCredential: async (value) => { persisted.push(value) },
    request: async (input, init) => {
      const path = new URL(input).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ path, body })
      if (path === '/api/v1/runner/setup/preflight') {
        return Response.json({ runner: { id: 'runner_v1_abcdefghijklmnopqrstuv', desiredCapacity: 2 } })
      }
      expect(persisted).toEqual([{ runnerId: 'runner_v1_abcdefghijklmnopqrstuv', credential }])
      expect(body).toEqual({ setupToken: 'setup_v1_abcdefghijklmnopqrstuv', credentialDigest: await sha256Hex(credential) })
      return Response.json({ runner: { id: 'runner_v1_abcdefghijklmnopqrstuv' } }, { status: 201 })
    },
  })

  expect(runner).toEqual({ id: 'runner_v1_abcdefghijklmnopqrstuv', desiredCapacity: 2 })
  expect(requests.map(({ path }) => path)).toEqual(['/api/v1/runner/setup/preflight', '/api/v1/runner/setup/enroll'])
})

test('the setup flow does not create or persist a credential when preflight rejects the token', async () => {
  let created = false
  let persisted = false

  await expect(enrollRemoteRunner({
    controlPlaneUrl: 'https://control.test',
    setupToken: 'setup_v1_abcdefghijklmnopqrstuv',
    createCredential: () => { created = true; return 'r'.repeat(43) },
    persistCredential: async () => { persisted = true },
    request: async () => Response.json({ error: { code: 'setup_token_invalid' } }, { status: 401 }),
  })).rejects.toThrow('Setup token preflight failed')

  expect(created).toBe(false)
  expect(persisted).toBe(false)
})

test('the Runner setup client enrolls a separately created identity through the public Worker routes', async () => {
  const app = createControlPlane({
    store: createInMemoryInvocationStore(),
    githubWebhookSecret: 'webhook-secret',
    githubInstallationId: '42',
    githubRepositoryId: '99',
    operatorBearerSecret: 'o'.repeat(32),
  })
  const created = await app.fetch(new Request('https://control.test/api/v1/runners', {
    method: 'POST',
    headers: { authorization: `Bearer ${'o'.repeat(32)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ capacity: 2 }),
  }))
  expect(created.status).toBe(201)
  const { setupToken, runner: createdRunner } = await created.json() as { setupToken: string; runner: { id: string } }
  const credential = 'r'.repeat(43)
  let persisted = false
  const transportedBodies: Array<Record<string, unknown>> = []

  const runner = await enrollRemoteRunner({
    controlPlaneUrl: 'https://control.test',
    setupToken,
    createCredential: () => credential,
    persistCredential: async () => { persisted = true },
    request: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      transportedBodies.push(body)
      expect(JSON.stringify(body)).not.toContain(credential)
      return app.fetch(new Request(input, init))
    },
  })

  expect(runner.id).toBe(createdRunner.id)
  expect(runner.id).not.toBe('runner_homeserv1')
  expect(persisted).toBe(true)
  expect(transportedBodies).toHaveLength(2)
  expect((await app.fetch(new Request('https://control.test/api/v1/runner/setup/preflight', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupToken }),
  }))).status).toBe(401)
})

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

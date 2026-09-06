import { createRunnerCredential, enrollRemoteRunner } from '../apps/runner/src/setup'

type SmokeEnvironment = {
  ORNN_SMOKE_BASE_URL: string
  ORNN_SMOKE_OPERATOR_BEARER_SECRET: string
}

function requiredEnvironment(): SmokeEnvironment {
  const names = ['ORNN_SMOKE_BASE_URL', 'ORNN_SMOKE_OPERATOR_BEARER_SECRET'] as const
  const values = Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<(typeof names)[number], string | undefined>
  for (const name of names) {
    if (!values[name]) throw new Error(`${name} is required for the deployed Runner setup smoke check`)
  }
  return values as SmokeEnvironment
}

async function main() {
  const environment = requiredEnvironment()
  const controlPlaneUrl = environment.ORNN_SMOKE_BASE_URL.replace(/\/$/, '')
  const created = await fetch(`${controlPlaneUrl}/api/v1/runners`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${environment.ORNN_SMOKE_OPERATOR_BEARER_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ capacity: 1 }),
  })
  if (created.status !== 201) throw new Error(`Runner creation failed with HTTP ${created.status}`)
  const { setupToken, runner: createdRunner } = await created.json() as { setupToken?: string; runner?: { id?: string } }
  if (!setupToken || !createdRunner?.id) throw new Error('Runner creation response omitted its setup token or identity')

  let persisted = false
  const runner = await enrollRemoteRunner({
    controlPlaneUrl,
    setupToken,
    createCredential: createRunnerCredential,
    persistCredential: async () => { persisted = true },
  })
  if (!persisted || runner.id !== createdRunner.id) throw new Error('Runner setup did not persist and enroll the created identity')

  const preflight = await fetch(`${controlPlaneUrl}/api/v1/runner/setup/preflight`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupToken }),
  })
  if (preflight.status !== 401) throw new Error(`Consumed setup token preflight returned HTTP ${preflight.status}`)
  console.log(`deployed Runner setup smoke passed for ${runner.id}`)
}

await main()

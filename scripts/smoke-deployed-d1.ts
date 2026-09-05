type SmokeEnvironment = {
  ORNN_SMOKE_BASE_URL: string
  ORNN_SMOKE_WEBHOOK_SECRET: string
  ORNN_SMOKE_OPERATOR_BEARER_SECRET: string
  ORNN_SMOKE_INSTALLATION_ID: string
  ORNN_SMOKE_REPOSITORY_ID: string
  ORNN_SMOKE_REPOSITORY_FULL_NAME: string
}

export {}

function requiredEnvironment(): SmokeEnvironment {
  const names = [
    'ORNN_SMOKE_BASE_URL',
    'ORNN_SMOKE_WEBHOOK_SECRET',
    'ORNN_SMOKE_OPERATOR_BEARER_SECRET',
    'ORNN_SMOKE_INSTALLATION_ID',
    'ORNN_SMOKE_REPOSITORY_ID',
    'ORNN_SMOKE_REPOSITORY_FULL_NAME',
  ] as const
  const values = Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<(typeof names)[number], string | undefined>
  for (const name of names) {
    if (!values[name]) throw new Error(`${name} is required for the deployed-D1 smoke check`)
  }
  return values as SmokeEnvironment
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function main() {
  const environment = requiredEnvironment()
  const deliveryId = `smoke-${crypto.randomUUID()}`
  const body = JSON.stringify({
    action: 'created',
    installation: { id: environment.ORNN_SMOKE_INSTALLATION_ID },
    repository: {
      id: environment.ORNN_SMOKE_REPOSITORY_ID,
      full_name: environment.ORNN_SMOKE_REPOSITORY_FULL_NAME,
    },
    issue: { number: 22, title: 'Deployed D1 smoke', body: 'Fixture body only.' },
    comment: { id: String(Date.now()), body: '@ornn analyze', user: { login: 'bjesuiter' } },
    sender: { login: 'bjesuiter' },
  })
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(environment.ORNN_SMOKE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))
  const baseUrl = environment.ORNN_SMOKE_BASE_URL.replace(/\/$/, '')
  const admitted = await fetch(`${baseUrl}/api/v1/github/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': deliveryId,
      'x-github-event': 'issue_comment',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  })
  if (admitted.status !== 201) throw new Error(`admission failed with HTTP ${admitted.status}`)
  const accepted = await admitted.json() as { jobId?: string }
  if (!accepted.jobId) throw new Error('admission response omitted jobId')

  const inspected = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(accepted.jobId)}`, {
    headers: { authorization: `Bearer ${environment.ORNN_SMOKE_OPERATOR_BEARER_SECRET}` },
  })
  if (inspected.status !== 200 || inspected.headers.get('cache-control') !== 'no-store') {
    throw new Error(`inspection failed with HTTP ${inspected.status}`)
  }
  const result = await inspected.json() as { job?: { id?: string; state?: string }; events?: unknown[] }
  if (result.job?.id !== accepted.jobId || result.job.state !== 'pending' || result.events?.length !== 2) {
    throw new Error('inspection response did not contain the admitted pending Job and its event sequence')
  }
  console.log(`deployed D1 smoke passed for ${accepted.jobId}`)
}

await main()

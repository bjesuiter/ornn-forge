export type SetupRunner = { id: string; desiredCapacity: number }

type SetupRequest = (input: URL, init?: RequestInit) => Promise<Response>

export async function enrollRemoteRunner({
  controlPlaneUrl,
  setupToken,
  createCredential = createRunnerCredential,
  persistCredential,
  request = fetch,
}: {
  controlPlaneUrl: string
  setupToken: string
  createCredential?: () => string
  persistCredential: (input: { runnerId: string; credential: string }) => Promise<void>
  request?: SetupRequest
}): Promise<SetupRunner> {
  const preflight = await request(new URL('/api/v1/runner/setup/preflight', controlPlaneUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupToken }),
  })
  if (!preflight.ok) throw new Error('Setup token preflight failed')
  const runner = setupRunnerFromResponse(await preflight.json())
  if (!runner) throw new Error('Setup token preflight returned an invalid Runner')

  const credential = createCredential()
  await persistCredential({ runnerId: runner.id, credential })

  const enrolled = await request(new URL('/api/v1/runner/setup/enroll', controlPlaneUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupToken, credentialDigest: await sha256Hex(credential) }),
  })
  if (!enrolled.ok) throw new Error('Remote Runner enrollment failed')
  return runner
}

export function createRunnerCredential(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

function setupRunnerFromResponse(value: unknown): SetupRunner | undefined {
  if (!isRecord(value) || !isRecord(value.runner)) return undefined
  const { id, desiredCapacity } = value.runner
  if (typeof id !== 'string' || !/^runner_v1_[A-Za-z0-9_-]{22}$/.test(id)) return undefined
  if (typeof desiredCapacity !== 'number' || !Number.isInteger(desiredCapacity) || desiredCapacity < 1 || desiredCapacity > 32) return undefined
  return { id, desiredCapacity }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

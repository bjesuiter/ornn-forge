import { envelope, type LeaseGrant, type RunnerProfile, type RunnerResponse } from '@ornn-forge/protocol'

export type RemoteRunnerConfig = {
  controlPlaneUrl: string
  runnerId: string
  credential: string
  profile: RunnerProfile
}

type HttpRequest = (input: URL, init?: RequestInit) => Promise<Response>
type CredentialFileReader = (path: string) => Promise<string>

export async function remoteRunnerConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  readCredentialFile: CredentialFileReader = (path) => Bun.file(path).text(),
): Promise<RemoteRunnerConfig> {
  const controlPlaneUrl = environment.ORNN_CONTROL_PLANE_URL
  const runnerId = environment.ORNN_RUNNER_ID
  const credential = environment.ORNN_RUNNER_CREDENTIAL
    ?? (environment.ORNN_RUNNER_CREDENTIAL_FILE
      ? (await readCredentialFile(environment.ORNN_RUNNER_CREDENTIAL_FILE)).trim()
      : undefined)

  if (!controlPlaneUrl || !runnerId || !credential) {
    throw new Error('ORNN_CONTROL_PLANE_URL, ORNN_RUNNER_ID, and ORNN_RUNNER_CREDENTIAL or ORNN_RUNNER_CREDENTIAL_FILE are required')
  }

  return {
    controlPlaneUrl,
    runnerId,
    credential,
    profile: {
      release: environment.ORNN_RUNNER_RELEASE ?? 'development',
      platform: process.platform,
      architecture: process.arch,
      runtime: `Bun ${Bun.version}`,
      executor: environment.ORNN_RUNNER_EXECUTOR ?? 'fixture',
      capacity: runnerCapacity(environment.ORNN_RUNNER_CAPACITY),
      logicalCpuCount: Math.max(1, navigator.hardwareConcurrency ?? 1),
      memoryLimitBytes: 128 * 1024 * 1024,
    },
  }
}

export async function executeFixtureLease(
  config: RemoteRunnerConfig,
  request: HttpRequest = fetch,
): Promise<'idle' | 'completed'> {
  try {
    const poll = await call(config, 'poll', envelope('runner.poll', { runnerId: config.runnerId, profile: config.profile }), request)
    const response = await poll.json() as RunnerResponse
    if (response.type === 'runner.no_work') return 'idle'
    if (response.type !== 'runner.lease') throw new Error(`Runner poll rejected: ${response.type}`)
    const lease = response.payload
    await accepted(call(config, 'heartbeat', envelope('runner.heartbeat', leaseScope(config, lease)), request))
    await accepted(call(config, 'result', envelope('runner.result', {
      ...leaseScope(config, lease),
      artifact: {
        schemaVersion: 1,
        kind: 'plan',
        summary: 'Fixture analysis complete',
        details: 'The deterministic Remote Runner fixture completed through the production protocol.',
      },
    }), request))
    return 'completed'
  } catch (error) {
    await call(config, 'report', envelope('runner.report', {
      runnerId: config.runnerId,
      fault: { code: error instanceof Error ? 'runner.operation_failed' : 'runner.unknown_failure' },
    }), request)
    throw error
  }
}

function leaseScope(config: RemoteRunnerConfig, lease: LeaseGrant) {
  return { runnerId: config.runnerId, jobId: lease.jobId, leaseToken: lease.leaseToken }
}

function runnerCapacity(value: string | undefined): number {
  if (value === undefined) return 1
  const capacity = Number(value)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error('ORNN_RUNNER_CAPACITY must be an integer between 1 and 32')
  return capacity
}

function call(config: RemoteRunnerConfig, operation: 'poll' | 'heartbeat' | 'result' | 'report', body: unknown, request: HttpRequest) {
  return request(new URL(`/api/v1/runner/${operation}`, config.controlPlaneUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.credential}`,
      'content-type': 'application/json',
      'x-ornn-runner-id': config.runnerId,
    },
    body: JSON.stringify(body),
  })
}

async function accepted(response: Promise<Response>) {
  const value = await response
  const body = await value.json() as RunnerResponse
  if (!value.ok || body.type !== 'lease.accepted') throw new Error(`Lease rejected: ${body.type}`)
}

if (import.meta.main) {
  await executeFixtureLease(await remoteRunnerConfigFromEnvironment())
}

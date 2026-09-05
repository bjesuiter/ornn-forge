import { envelope, type LeaseGrant, type RunnerResponse } from '@ornn-forge/protocol'

export type RemoteRunnerConfig = {
  controlPlaneUrl: string
  runnerId: string
  credential: string
}

type HttpRequest = (input: URL, init?: RequestInit) => Promise<Response>

export async function executeFixtureLease(
  config: RemoteRunnerConfig,
  request: HttpRequest = fetch,
): Promise<'idle' | 'completed'> {
  const poll = await call(config, 'poll', envelope('runner.poll', { runnerId: config.runnerId }), request)
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
}

function leaseScope(config: RemoteRunnerConfig, lease: LeaseGrant) {
  return { runnerId: config.runnerId, jobId: lease.jobId, leaseToken: lease.leaseToken }
}

function call(config: RemoteRunnerConfig, operation: 'poll' | 'heartbeat' | 'result', body: unknown, request: HttpRequest) {
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
  const controlPlaneUrl = process.env.ORNN_CONTROL_PLANE_URL
  const runnerId = process.env.ORNN_RUNNER_ID
  const credential = process.env.ORNN_RUNNER_CREDENTIAL
  if (!controlPlaneUrl || !runnerId || !credential) throw new Error('ORNN_CONTROL_PLANE_URL, ORNN_RUNNER_ID, and ORNN_RUNNER_CREDENTIAL are required')
  await executeFixtureLease({ controlPlaneUrl, runnerId, credential })
}

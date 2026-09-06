export const RUNNER_PROTOCOL_MAJOR = 1

export type RunnerEnvelope<TType extends string, TPayload> = {
  protocol: { major: typeof RUNNER_PROTOCOL_MAJOR }
  type: TType
  payload: TPayload
}

export type RunnerProfile = {
  release: string
  platform: string
  architecture: string
  runtime: string
  executor: string
  capacity: number
}

export type RunnerFault = { code: string }

export type RunnerPoll = RunnerEnvelope<'runner.poll', { runnerId: string; profile?: RunnerProfile; ready?: boolean }>
export type RunnerHeartbeat = RunnerEnvelope<'lease.heartbeat', {
  runnerId: string
  jobId: string
  leaseToken: string
}>
export type RunnerResult = RunnerEnvelope<'lease.result', {
  runnerId: string
  jobId: string
  leaseToken: string
  artifact: AnalysisArtifact
}>
export type RunnerReport = RunnerEnvelope<'runner.report', { runnerId: string; fault: RunnerFault }>

export type AnalysisArtifact = {
  schemaVersion: 1
  kind: 'plan' | 'questions' | 'blocked'
  summary: string
  details: string
  attachmentMetadata?: { name: string; contentType: string; size: number }[]
}

export type LeaseGrant = {
  jobId: string
  leaseToken: string
  generation: number
  expiresAt: string
  workOrder: { issueNumber: number; title: string; body: string; comment: string }
}

export type RunnerResponse =
  | RunnerEnvelope<'runner.no_work', { retryAfterSeconds: number }>
  | RunnerEnvelope<'runner.lease', LeaseGrant>
  | RunnerEnvelope<'lease.accepted', { jobId: string }>
  | RunnerEnvelope<'runner.accepted', Record<string, never>>
  | RunnerEnvelope<'lease.rejected', { code: 'lease_invalid' | 'lease_expired' | 'runner_unauthorized' | 'invalid_artifact' }>
  | RunnerEnvelope<'protocol.unsupported', { supportedMajor: typeof RUNNER_PROTOCOL_MAJOR }>

export function envelope<TType extends string, TPayload>(type: TType, payload: TPayload): RunnerEnvelope<TType, TPayload> {
  return { protocol: { major: RUNNER_PROTOCOL_MAJOR }, type, payload }
}

export function parseRunnerEnvelope(value: unknown):
  | { ok: true; value: RunnerEnvelope<string, Record<string, unknown>> }
  | { ok: false; code: 'invalid_envelope' | 'unsupported_major' } {
  if (!isRecord(value) || !isRecord(value.protocol) || typeof value.protocol.major !== 'number') {
    return { ok: false, code: 'invalid_envelope' }
  }
  if (value.protocol.major !== RUNNER_PROTOCOL_MAJOR) return { ok: false, code: 'unsupported_major' }
  if (typeof value.type !== 'string' || !isRecord(value.payload)) return { ok: false, code: 'invalid_envelope' }
  return { ok: true, value: value as RunnerEnvelope<string, Record<string, unknown>> }
}

export function isAnalysisArtifact(value: unknown): value is AnalysisArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1 || !['plan', 'questions', 'blocked'].includes(String(value.kind))) return false
  if (typeof value.summary !== 'string' || typeof value.details !== 'string') return false
  return value.attachmentMetadata === undefined || (
    Array.isArray(value.attachmentMetadata) && value.attachmentMetadata.every((attachment) =>
      isRecord(attachment) && typeof attachment.name === 'string' && typeof attachment.contentType === 'string' &&
      typeof attachment.size === 'number' && Number.isSafeInteger(attachment.size) && attachment.size >= 0,
    )
  )
}

export function isRunnerProfile(value: unknown): value is RunnerProfile {
  if (!isRecord(value)) return false
  return isShortText(value.release) && isShortText(value.platform) && isShortText(value.architecture)
    && isShortText(value.runtime) && isShortText(value.executor)
    && typeof value.capacity === 'number' && Number.isInteger(value.capacity) && value.capacity >= 1 && value.capacity <= 32
}

export function isRunnerFault(value: unknown): value is RunnerFault {
  return isRecord(value) && isShortText(value.code)
}

function isShortText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

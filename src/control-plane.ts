import {
  envelope,
  isAnalysisArtifact,
  isRunnerFault,
  isRunnerProfile,
  parseRunnerEnvelope,
  type AnalysisArtifact,
  type LeaseGrant,
  type RunnerFault,
  type RunnerProfile,
} from '@ornn-forge/protocol'
import type { CleanupStatus, ExecutionOutcome, OrnnMessageState } from '@ornn-forge/domain'

const API_VERSION = 'v1'
const EVENT_SCHEMA_VERSION = 1
const INVOCATION_SCHEMA_VERSION = 1
const JOB_SCHEMA_VERSION = 1
const ANALYZE_FLOW_ID = 'analyze'
const ANALYZE_FLOW_VERSION_ID = 'fv_v1_nTrDKcC7adfgDeQBd41eiA'
const ADMISSION_POLICY_VERSION_ID = 'pv_v1_bCpHOE6Md2lHYS8NiKZq5w'
const MAX_SOURCE_FIELD_LENGTH = 16_384
const SETUP_TOKEN_LIFETIME_MS = 15 * 60_000

export type ControlPlaneOptions = {
  store: InvocationStore
  githubWebhookSecret: string
  githubInstallationId: string
  githubRepositoryId: string
  githubRepositoryFullName?: string
  operatorBearerSecret: string
  runnerCredentialId?: string
  runnerCredentialSecret?: string
  messagePublisher?: OrnnMessagePublisher
  now?: () => Date
}

export interface OrnnMessagePublisher {
  reconcile(input: { repository: string; issueNumber: number; effectKey: string; body: string; githubCommentId?: string }): Promise<{ githubCommentId: string } | undefined>
  create(input: { repository: string; issueNumber: number; effectKey: string; body: string }): Promise<{ githubCommentId: string }>
  update(input: { repository: string; githubCommentId: string; effectKey: string; body: string }): Promise<void>
}

type DeliveryInput = {
  deliveryId: string
  bodySha256: string
  installationId: string
  repositoryId: string
  repositoryFullName: string
  issueNumber: number
  issueTitle: string
  issueBody: string
  commentId: string
  commentBody: string
  actor: string
}

type EventRecord = {
  id: string
  type: string
  revision: string
  occurredAt: string
}

export type JobInspection = {
  invocation: {
    id: string
    github: {
      deliveryId: string
      installationId: string
      repository: { id: string; fullName: string }
      issue: { number: number; title: string; body: string }
      comment: { id: string; body: string }
      actor: string
    }
    policyVersionId: string
    createdAt: string
  }
  job: {
    id: string
    state: 'pending' | 'leased' | 'succeeded'
    flow: { id: 'analyze'; versionId: string }
    policy: { versionId: string }
    createdAt: string
  }
  events: EventRecord[]
  message?: OrnnMessageState
  artifact?: AnalysisArtifact
  executionOutcome?: ExecutionOutcome
  cleanupStatus?: CleanupStatus
}

type Admission = {
  invocationId: string
  jobId: string
  bodySha256: string
  created: boolean
}

export interface InvocationStore {
  admit(delivery: DeliveryInput): Promise<Admission | { conflict: true }>
  inspectJob(jobId: string): Promise<JobInspection | undefined>
  inspectMessage?(ornnMessageId: string): Promise<JobInspection | undefined>
  createRemoteRunner?(input: RemoteRunnerCreation): Promise<RemoteRunner>
  regenerateSetupToken?(input: NewSetupToken): Promise<RemoteRunner | undefined>
  preflightSetupToken?(input: SetupTokenLookup): Promise<RemoteRunner | undefined>
  enrollRemoteRunner?(input: SetupTokenEnrollment): Promise<RemoteRunner | undefined>
  authenticateRunner?(runnerId: string, credentialDigest: string): Promise<boolean>
  updateRunnerProfile?(runnerId: string, profile: RunnerProfile): Promise<void>
  pollRunner?(runnerId: string): Promise<LeaseGrant | undefined>
  setRunnerPaused?(runnerId: string, paused: boolean): Promise<boolean>
  heartbeatLease?(input: LeaseInput): Promise<boolean>
  completeLease?(input: LeaseInput & { artifact: AnalysisArtifact }): Promise<'accepted' | 'invalid_artifact'>
  recordRunnerSuccess?(runnerId: string): Promise<void>
  recordRunnerFault?(runnerId: string, fault: RunnerFault): Promise<void>
  recordMessagePublication?(jobId: string, update: { githubCommentId?: string; attempt: OrnnMessageState['latestAttempt'] }): Promise<void>
}

export type RemoteRunner = {
  id: string
  desiredCapacity: number
  enrollment: 'awaiting_setup' | 'enrolled'
  ready: boolean
}

type RemoteRunnerCreation = { id: string; desiredCapacity: number } & SetupTokenRecord
type NewSetupToken = SetupTokenRecord & { runnerId: string }
type SetupTokenRecord = { tokenId: string; tokenDigest: string; expiresAt: string; createdAt: string }
type SetupTokenLookup = { tokenDigest: string; now: string }
type SetupTokenEnrollment = SetupTokenLookup & { credentialDigest: string }

type LeaseInput = { runnerId: string; jobId: string; leaseToken: string }

export function createControlPlane(options: ControlPlaneOptions) {
  const operatorCredential = operatorCredentialBytes(options.operatorBearerSecret)
  if (!operatorCredential) {
    throw new Error('OPERATOR_BEARER_SECRET must contain exactly 256 bits')
  }
  const runnerCredential = options.runnerCredentialSecret === undefined ? undefined : runnerCredentialBytes(options.runnerCredentialSecret)
  if ((options.runnerCredentialId === undefined) !== (runnerCredential === undefined)) {
    throw new Error('RUNNER_CREDENTIAL_ID and RUNNER_CREDENTIAL_SECRET must be configured together')
  }
  if (options.runnerCredentialSecret !== undefined && !runnerCredential) {
    throw new Error('RUNNER_CREDENTIAL_SECRET must contain exactly 256 bits')
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/api/v1/github/webhook') {
        return admitGitHubDelivery(request, options)
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/runners') {
        if (!(await isAuthenticatedOperator(request, operatorCredential))) {
          return json({ apiVersion: API_VERSION, error: { code: 'operator_unauthorized' } }, 401)
        }
        const input = await requestJson(request)
        if (!isRemoteRunnerCreation(input) || !options.store.createRemoteRunner) {
          return json({ apiVersion: API_VERSION, error: { code: 'invalid_runner' } }, 422)
        }
        const issuedToken = await issueSetupToken(options)
        const runner = await options.store.createRemoteRunner({
          id: opaqueId('runner'),
          desiredCapacity: input.capacity,
          ...issuedToken.record,
        })
        return json({ apiVersion: API_VERSION, runner, setupToken: issuedToken.value }, 201, { 'Cache-Control': 'no-store' })
      }

      const setupTokenMatch = /^\/api\/v1\/runners\/([^/]+)\/setup-token$/.exec(url.pathname)
      if (request.method === 'POST' && setupTokenMatch) {
        if (!(await isAuthenticatedOperator(request, operatorCredential))) {
          return json({ apiVersion: API_VERSION, error: { code: 'operator_unauthorized' } }, 401)
        }
        if (!options.store.regenerateSetupToken) return json({ apiVersion: API_VERSION, error: { code: 'runner_not_found' } }, 404)
        const issuedToken = await issueSetupToken(options)
        const runner = await options.store.regenerateSetupToken({
          runnerId: decodeURIComponent(setupTokenMatch[1]),
          ...issuedToken.record,
        })
        if (!runner) return json({ apiVersion: API_VERSION, error: { code: 'runner_not_found' } }, 404)
        return json({ apiVersion: API_VERSION, runner, setupToken: issuedToken.value }, 201, { 'Cache-Control': 'no-store' })
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/runner/setup/preflight') {
        const input = await requestJson(request)
        if (!isSetupTokenRequest(input) || !options.store.preflightSetupToken) {
          return json({ apiVersion: API_VERSION, error: { code: 'setup_token_invalid' } }, 401)
        }
        const runner = await options.store.preflightSetupToken({ tokenDigest: await sha256(input.setupToken), now: currentTime(options) })
        return runner
          ? json({ apiVersion: API_VERSION, runner }, 200, { 'Cache-Control': 'no-store' })
          : json({ apiVersion: API_VERSION, error: { code: 'setup_token_invalid' } }, 401)
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/runner/setup/enroll') {
        const input = await requestJson(request)
        if (!isEnrollmentRequest(input) || !options.store.enrollRemoteRunner) {
          return json({ apiVersion: API_VERSION, error: { code: 'setup_token_invalid' } }, 401)
        }
        const runner = await options.store.enrollRemoteRunner({
          tokenDigest: await sha256(input.setupToken), credentialDigest: input.credentialDigest, now: currentTime(options),
        })
        return runner
          ? json({ apiVersion: API_VERSION, runner }, 201, { 'Cache-Control': 'no-store' })
          : json({ apiVersion: API_VERSION, error: { code: 'setup_token_invalid' } }, 401)
      }

      const runnerMatch = /^\/api\/v1\/runner\/(poll|heartbeat|result|report)$/.exec(url.pathname)
      if (request.method === 'POST' && runnerMatch) {
        return handleRunnerRequest(request, runnerMatch[1] as 'poll' | 'heartbeat' | 'result' | 'report', options, runnerCredential)
      }

      const jobMatch = /^\/api\/v1\/jobs\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && jobMatch) {
        if (!(await isAuthenticatedOperator(request, operatorCredential))) {
          return json({ apiVersion: API_VERSION, error: { code: 'operator_unauthorized' } }, 401)
        }

        const inspection = await options.store.inspectJob(decodeURIComponent(jobMatch[1]))
        if (!inspection) {
          return json({ apiVersion: API_VERSION, error: { code: 'job_not_found' } }, 404)
        }

        return json({
          apiVersion: API_VERSION,
          principal: 'operator:bjesuiter',
          ...inspection,
        }, 200, { 'Cache-Control': 'no-store' })
      }

      const messageMatch = /^\/api\/v1\/messages\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && messageMatch) {
        if (!(await isAuthenticatedOperator(request, operatorCredential))) {
          return json({ apiVersion: API_VERSION, error: { code: 'operator_unauthorized' } }, 401)
        }
        const inspection = options.store.inspectMessage && await options.store.inspectMessage(decodeURIComponent(messageMatch[1]))
        if (!inspection) return json({ apiVersion: API_VERSION, error: { code: 'message_not_found' } }, 404)
        return json({ apiVersion: API_VERSION, principal: 'operator:bjesuiter', ...inspection }, 200, { 'Cache-Control': 'no-store' })
      }

      return json({ apiVersion: API_VERSION, error: { code: 'route_not_found' } }, 404)
    },
  }
}

async function handleRunnerRequest(
  request: Request,
  operation: 'poll' | 'heartbeat' | 'result' | 'report',
  options: ControlPlaneOptions,
  expectedCredential: Uint8Array | undefined,
): Promise<Response> {
  const runnerId = request.headers.get('x-ornn-runner-id')
  const authorization = request.headers.get('authorization')
  const providedCredential = authorization?.startsWith('Bearer ')
    ? runnerCredentialBytes(authorization.slice('Bearer '.length))
    : undefined
  if (!runnerId || runnerId !== options.runnerCredentialId || !expectedCredential || !providedCredential ||
    !constantTimeEqual(await digest(providedCredential), await digest(expectedCredential)) ||
    !options.store.authenticateRunner ||
    !(await options.store.authenticateRunner(runnerId, await sha256Bytes(providedCredential)))) {
    return runnerJson(envelope('lease.rejected', { code: 'runner_unauthorized' }), 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    await recordRunnerFault(options, runnerId, 'runner.invalid_request')
    return runnerJson(envelope('lease.rejected', { code: 'invalid_artifact' }), 400)
  }
  const parsed = parseRunnerEnvelope(body)
  if (!parsed.ok) {
    if (parsed.code === 'unsupported_major') {
      await recordRunnerFault(options, runnerId, 'runner.unsupported_protocol')
      return runnerJson(envelope('protocol.unsupported', { supportedMajor: 1 }), 426)
    }
    await recordRunnerFault(options, runnerId, 'runner.invalid_request')
    return runnerJson(envelope('lease.rejected', { code: 'invalid_artifact' }), 400)
  }
  if (parsed.value.type !== `runner.${operation}` || parsed.value.payload.runnerId !== runnerId) {
    await recordRunnerFault(options, runnerId, 'runner.invalid_request')
    return runnerJson(envelope('lease.rejected', { code: 'lease_invalid' }), 403)
  }

  if (operation === 'poll') {
    if (parsed.value.payload.profile !== undefined && !isRunnerProfile(parsed.value.payload.profile)) {
      await recordRunnerFault(options, runnerId, 'runner.invalid_profile')
      return runnerJson(envelope('lease.rejected', { code: 'invalid_artifact' }), 422)
    }
    if (parsed.value.payload.profile) await options.store.updateRunnerProfile?.(runnerId, parsed.value.payload.profile)
    const lease = options.store.pollRunner ? await options.store.pollRunner(runnerId) : undefined
    await options.store.recordRunnerSuccess?.(runnerId)
    return runnerJson(lease ? envelope('runner.lease', lease) : envelope('runner.no_work', { retryAfterSeconds: 5 }))
  }
  if (operation === 'report') {
    if (!isRunnerFault(parsed.value.payload.fault)) {
      await recordRunnerFault(options, runnerId, 'runner.invalid_fault')
      return runnerJson(envelope('lease.rejected', { code: 'invalid_artifact' }), 422)
    }
    await options.store.recordRunnerFault?.(runnerId, parsed.value.payload.fault)
    return runnerJson(envelope('runner.accepted', {}))
  }
  const leaseInput = parsed.value.payload
  if (typeof leaseInput.jobId !== 'string' || typeof leaseInput.leaseToken !== 'string') {
    await recordRunnerFault(options, runnerId, 'runner.invalid_lease')
    return runnerJson(envelope('lease.rejected', { code: 'lease_invalid' }), 403)
  }
  if (operation === 'heartbeat') {
    const accepted = options.store.heartbeatLease && await options.store.heartbeatLease({ runnerId, jobId: leaseInput.jobId, leaseToken: leaseInput.leaseToken })
    if (accepted) await options.store.recordRunnerSuccess?.(runnerId)
    else await recordRunnerFault(options, runnerId, 'runner.invalid_lease')
    return accepted
      ? runnerJson(envelope('lease.accepted', { jobId: leaseInput.jobId }))
      : runnerJson(envelope('lease.rejected', { code: 'lease_invalid' }), 403)
  }
  if (!isAnalysisArtifact(leaseInput.artifact)) {
    await recordRunnerFault(options, runnerId, 'runner.invalid_artifact')
    return runnerJson(envelope('lease.rejected', { code: 'invalid_artifact' }), 422)
  }
  const completed = await options.store.completeLease?.({
    runnerId,
    jobId: leaseInput.jobId,
    leaseToken: leaseInput.leaseToken,
    artifact: leaseInput.artifact,
  })
  if (completed === 'accepted') {
    await options.store.recordRunnerSuccess?.(runnerId)
    await publishMessage(options, leaseInput.jobId)
  } else {
    await recordRunnerFault(options, runnerId, 'runner.invalid_lease')
  }
  return completed === 'accepted'
    ? runnerJson(envelope('lease.accepted', { jobId: leaseInput.jobId }))
    : runnerJson(envelope('lease.rejected', { code: 'lease_invalid' }), 403)
}

async function recordRunnerFault(options: ControlPlaneOptions, runnerId: string, code: string) {
  await options.store.recordRunnerFault?.(runnerId, { code })
}

async function admitGitHubDelivery(
  request: Request,
  options: ControlPlaneOptions,
): Promise<Response> {
  const rawBody = new Uint8Array(await request.arrayBuffer())
  const signature = request.headers.get('x-hub-signature-256')
  if (!(await verifiesGitHubSignature(rawBody, signature, options.githubWebhookSecret))) {
    return json({ apiVersion: API_VERSION, error: { code: 'invalid_signature' } }, 401)
  }
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    return json({ apiVersion: API_VERSION, error: { code: 'invalid_payload' } }, 400)
  }

  const event = request.headers.get('x-github-event')
  const parsed = event === 'issue_comment'
    ? parseIssueComment(body)
    : event === 'issues'
      ? parseIssueDescription(body)
      : undefined
  if (parsed === 'ignored') {
    return json({ apiVersion: API_VERSION, ignored: true }, 202)
  }
  if (!parsed && event !== 'issue_comment' && event !== 'issues') {
    return json({ apiVersion: API_VERSION, error: { code: 'unsupported_event' } }, 422)
  }

  const deliveryId = request.headers.get('x-github-delivery')
  if (!deliveryId || deliveryId.length > 200) {
    return json({ apiVersion: API_VERSION, error: { code: 'invalid_delivery' } }, 400)
  }

  if (!parsed) {
    return json({ apiVersion: API_VERSION, error: { code: 'invalid_payload' } }, 400)
  }
  if (
    parsed.installationId !== options.githubInstallationId ||
    parsed.repositoryId !== options.githubRepositoryId ||
    (options.githubRepositoryFullName !== undefined && parsed.repositoryFullName !== options.githubRepositoryFullName) ||
    parsed.actor !== 'bjesuiter'
  ) {
    return json({ apiVersion: API_VERSION, error: { code: 'invocation_unauthorized' } }, 403)
  }

  const admitted = await options.store.admit({
    ...parsed,
    ...(event === 'issues' ? { commentId: `${parsed.commentId}:${deliveryId}` } : {}),
    deliveryId,
    bodySha256: await sha256Bytes(rawBody),
  })
  if ('conflict' in admitted) {
    return json({ apiVersion: API_VERSION, error: { code: 'delivery_identity_conflict' } }, 409)
  }

  const response = json({
    apiVersion: API_VERSION,
    invocationId: admitted.invocationId,
    jobId: admitted.jobId,
    replayed: !admitted.created,
  }, admitted.created ? 201 : 200)
  if (admitted.created) await publishMessage(options, admitted.jobId)
  return response
}

async function publishMessage(options: ControlPlaneOptions, jobId: string): Promise<void> {
  if (!options.messagePublisher || !options.store.recordMessagePublication) return
  const inspection = await options.store.inspectJob(jobId)
  if (!inspection?.message) return
  const { message } = inspection
  try {
    const body = renderMessage(inspection)
    const reconciled = await options.messagePublisher.reconcile({
      repository: inspection.invocation.github.repository.fullName,
      issueNumber: inspection.invocation.github.issue.number,
      effectKey: message.effectKey,
      githubCommentId: message.githubCommentId,
      body,
    })
    if (reconciled) {
      await options.store.recordMessagePublication(jobId, { githubCommentId: reconciled.githubCommentId, attempt: 'succeeded' })
      return
    }
    if (message.githubCommentId) {
      await options.messagePublisher.update({ repository: inspection.invocation.github.repository.fullName, githubCommentId: message.githubCommentId, effectKey: message.effectKey, body })
      await options.store.recordMessagePublication(jobId, { githubCommentId: message.githubCommentId, attempt: 'succeeded' })
      return
    }
    const created = await options.messagePublisher.create({
      repository: inspection.invocation.github.repository.fullName,
      issueNumber: inspection.invocation.github.issue.number,
      effectKey: message.effectKey,
      body,
    })
    await options.store.recordMessagePublication(jobId, { githubCommentId: created.githubCommentId, attempt: 'succeeded' })
  } catch {
    await options.store.recordMessagePublication(jobId, { githubCommentId: message.githubCommentId, attempt: 'uncertain' })
  }
}

function renderMessage(inspection: JobInspection): string {
  const status = inspection.job.state === 'succeeded'
    ? `completed: ${inspection.artifact?.summary ?? 'Analysis completed'}`
    : 'accepted and waiting for a Runner.'
  return `Ornn Analyze Job ${status}\n\nOrnn message ID: \`${inspection.message?.id}\`\n<!-- ornn-effect:${inspection.message?.effectKey} -->`
}

function parseIssueComment(body: string): Omit<DeliveryInput, 'deliveryId' | 'bodySha256'> | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isObject(payload) || payload.action !== 'created' || !isObject(payload.installation) || !isObject(payload.repository) || !isObject(payload.issue) || !isObject(payload.comment) || !isObject(payload.sender)) {
    return undefined
  }
  if ('pull_request' in payload.issue) return undefined

  const installationId = asIdentifier(payload.installation.id)
  const repositoryId = asIdentifier(payload.repository.id)
  const repositoryFullName = asBoundedString(payload.repository.full_name)
  const issueNumber = payload.issue.number
  const issueTitle = asBoundedString(payload.issue.title)
  const issueBody = asBoundedString(payload.issue.body)
  const commentId = asIdentifier(payload.comment.id)
  const commentBody = asBoundedString(payload.comment.body)
  const senderLogin = asBoundedString(payload.sender.login)
  const commentUser = isObject(payload.comment.user) ? asBoundedString(payload.comment.user.login) : undefined

  if (!installationId || !repositoryId || !repositoryFullName || !isPositiveSafeInteger(issueNumber) || issueTitle === undefined || issueBody === undefined || !commentId || commentBody === undefined || !senderLogin || senderLogin !== commentUser) {
    return undefined
  }

  return {
    installationId,
    repositoryId,
    repositoryFullName,
    issueNumber,
    issueTitle,
    issueBody,
    commentId,
    commentBody,
    actor: senderLogin,
  }
}

function parseIssueDescription(body: string): Omit<DeliveryInput, 'deliveryId' | 'bodySha256'> | 'ignored' | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isObject(payload) || !isObject(payload.installation) || !isObject(payload.repository) || !isObject(payload.issue) || !isObject(payload.sender)) {
    return undefined
  }
  if (payload.action !== 'opened' && payload.action !== 'edited') {
    return 'ignored'
  }

  const issueBody = asBoundedString(payload.issue.body)
  if (!issueBody || !containsOrnnMention(issueBody)) return 'ignored'

  const installationId = asIdentifier(payload.installation.id)
  const repositoryId = asIdentifier(payload.repository.id)
  const repositoryFullName = asBoundedString(payload.repository.full_name)
  const issueId = asIdentifier(payload.issue.id)
  const issueNumber = payload.issue.number
  const issueTitle = asBoundedString(payload.issue.title)
  const senderLogin = asBoundedString(payload.sender.login)

  if (!installationId || !repositoryId || !repositoryFullName || !issueId || !isPositiveSafeInteger(issueNumber) || issueTitle === undefined || !senderLogin) {
    return undefined
  }

  return {
    installationId,
    repositoryId,
    repositoryFullName,
    issueNumber,
    issueTitle,
    issueBody,
    commentId: `issue-description:${issueId}`,
    commentBody: issueBody,
    actor: senderLogin,
  }
}

function containsOrnnMention(value: string): boolean {
  return /(?:^|[^\w-])@?ornn-forge\b/i.test(value)
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

function isRemoteRunnerCreation(value: unknown): value is { capacity: number } {
  return isObject(value) && typeof value.capacity === 'number' && Number.isInteger(value.capacity)
    && value.capacity >= 1 && value.capacity <= 32
}

function isSetupTokenRequest(value: unknown): value is { setupToken: string } {
  return isObject(value) && typeof value.setupToken === 'string' && /^setup_v1_[A-Za-z0-9_-]{22}$/.test(value.setupToken)
}

function isEnrollmentRequest(value: unknown): value is { setupToken: string; credentialDigest: string } {
  return isObject(value) && typeof value.setupToken === 'string' && /^setup_v1_[A-Za-z0-9_-]{22}$/.test(value.setupToken)
    && typeof value.credentialDigest === 'string'
    && /^[0-9a-f]{64}$/i.test(value.credentialDigest)
}

function currentTime(options: ControlPlaneOptions): string {
  return (options.now ?? (() => new Date()))().toISOString()
}

async function issueSetupToken(options: ControlPlaneOptions): Promise<{ value: string; record: SetupTokenRecord }> {
  const createdAt = currentTime(options)
  const value = opaqueId('setup')
  return {
    value,
    record: {
      tokenId: opaqueId('st'),
      tokenDigest: await sha256(value),
      createdAt,
      expiresAt: new Date(new Date(createdAt).getTime() + SETUP_TOKEN_LIFETIME_MS).toISOString(),
    },
  }
}

function asIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return text.length > 0 && text.length <= 200 ? text : undefined
}

function asBoundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_SOURCE_FIELD_LENGTH ? value : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

async function verifiesGitHubSignature(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false
  const expected = hexToBytes(signature.slice('sha256='.length))
  if (!expected || expected.byteLength !== 32) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, expected as unknown as BufferSource, body as unknown as BufferSource)
}

async function isAuthenticatedOperator(request: Request, expectedCredential: Uint8Array): Promise<boolean> {
  const value = request.headers.get('authorization')
  if (!value?.startsWith('Bearer ')) return false
  const provided = operatorCredentialBytes(value.slice('Bearer '.length))
  if (!provided || provided.byteLength !== expectedCredential.byteLength) return false
  return constantTimeEqual(await digest(provided), await digest(expectedCredential))
}

function operatorCredentialBytes(value: string): Uint8Array | undefined {
  const raw = new TextEncoder().encode(value)
  if (raw.byteLength === 32) return raw
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=')
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return decoded.byteLength === 32 ? decoded : undefined
  } catch {
    return undefined
  }
}

function runnerCredentialBytes(value: string): Uint8Array | undefined {
  return operatorCredentialBytes(value)
}

async function digest(value: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', value as unknown as BufferSource)
}

function constantTimeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean }
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(left, right)
  const leftBytes = new Uint8Array(left)
  const rightBytes = new Uint8Array(right)
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index]
  return difference === 0
}

function json(value: unknown, status: number, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}

function runnerJson(value: unknown, status = 200): Response {
  return json(value, status, { 'Cache-Control': 'no-store' })
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return undefined
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

async function sha256(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value))
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', value as unknown as BufferSource))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  throw new Error('Canonical JSON accepts JSON-compatible values only')
}

function opaqueId(prefix: string): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `${prefix}_v1_${bytesToBase64Url(bytes)}`
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

type StoredRecord = { delivery: DeliveryInput; inspection: JobInspection; events: EventRecord[]; bodySha256: string }
type StoredSetupToken = SetupTokenRecord & { runnerId: string; invalidatedAt?: string; consumedAt?: string }

export function createInMemoryInvocationStore(): InvocationStore {
  const recordsByDelivery = new Map<string, StoredRecord>()
  const inspectionsByJob = new Map<string, JobInspection>()
  const remoteRunners = new Map<string, RemoteRunner>()
  const setupTokensByDigest = new Map<string, StoredSetupToken>()
  const runnerCredentials = new Map<string, string>()
  const runnerProfiles = new Map<string, RunnerProfile>()
  const pausedRunners = new Set<string>()
  const leasesByJob = new Map<string, {
    runnerId: string
    tokenDigest: string
    generation: number
    expiresAt: string
  }>()
  return {
    async admit(delivery) {
      const existing = recordsByDelivery.get(delivery.deliveryId)
      if (existing) {
        if (existing.bodySha256 !== delivery.bodySha256) return { conflict: true }
        return {
          invocationId: existing.inspection.invocation.id,
          jobId: existing.inspection.job.id,
          bodySha256: existing.bodySha256,
          created: false,
        }
      }
      const record = await buildRecord(delivery)
      recordsByDelivery.set(delivery.deliveryId, record)
      inspectionsByJob.set(record.inspection.job.id, record.inspection)
      return {
        invocationId: record.inspection.invocation.id,
        jobId: record.inspection.job.id,
        bodySha256: record.bodySha256,
        created: true,
      }
    },
    async inspectJob(jobId) {
      return inspectionsByJob.get(jobId)
    },
    async inspectMessage(ornnMessageId) {
      return [...inspectionsByJob.values()].find((inspection) => inspection.message?.id === ornnMessageId)
    },
    async createRemoteRunner(input) {
      const runner: RemoteRunner = {
        id: input.id, desiredCapacity: input.desiredCapacity, enrollment: 'awaiting_setup', ready: false,
      }
      remoteRunners.set(runner.id, runner)
      setupTokensByDigest.set(input.tokenDigest, {
        tokenId: input.tokenId, runnerId: runner.id, tokenDigest: input.tokenDigest,
        createdAt: input.createdAt, expiresAt: input.expiresAt,
      })
      return runner
    },
    async regenerateSetupToken(input) {
      const runner = remoteRunners.get(input.runnerId)
      if (!runner || runner.enrollment !== 'awaiting_setup') return undefined
      for (const token of setupTokensByDigest.values()) {
        if (token.runnerId === runner.id && !token.invalidatedAt && !token.consumedAt) token.invalidatedAt = input.createdAt
      }
      setupTokensByDigest.set(input.tokenDigest, {
        tokenId: input.tokenId, runnerId: runner.id, tokenDigest: input.tokenDigest,
        createdAt: input.createdAt, expiresAt: input.expiresAt,
      })
      return runner
    },
    async preflightSetupToken(input) {
      const token = setupTokensByDigest.get(input.tokenDigest)
      if (!usableSetupToken(token, input.now)) return undefined
      return remoteRunners.get(token.runnerId)
    },
    async enrollRemoteRunner(input) {
      const token = setupTokensByDigest.get(input.tokenDigest)
      if (!usableSetupToken(token, input.now)) return undefined
      const runner = remoteRunners.get(token.runnerId)
      if (!runner || runner.enrollment !== 'awaiting_setup' || runnerCredentials.has(runner.id)) return undefined
      runnerCredentials.set(runner.id, input.credentialDigest)
      token.consumedAt = input.now
      runner.enrollment = 'enrolled'
      return runner
    },
    async authenticateRunner(runnerId, credentialDigest) {
      const existing = runnerCredentials.get(runnerId)
      if (existing === undefined) {
        runnerCredentials.set(runnerId, credentialDigest)
        return true
      }
      return existing === credentialDigest
    },
    async updateRunnerProfile(runnerId, profile) {
      runnerProfiles.set(runnerId, profile)
    },
    async pollRunner(runnerId) {
      if (pausedRunners.has(runnerId)) return undefined
      const capacity = remoteRunners.get(runnerId)?.desiredCapacity ?? runnerProfiles.get(runnerId)?.capacity ?? 1
      if ([...leasesByJob.values()].filter((lease) => lease.runnerId === runnerId).length >= capacity) return undefined
      const inspection = [...inspectionsByJob.values()].find((candidate) => candidate.job.state === 'pending')
      if (!inspection) return undefined
      const token = opaqueId('lease')
      const expiresAt = new Date(Date.now() + 60_000).toISOString()
      const generation = 1
      leasesByJob.set(inspection.job.id, { runnerId, tokenDigest: await sha256(token), generation, expiresAt })
      inspection.job.state = 'leased'
      inspection.events.push({ id: opaqueId('evt'), type: 'job.leased', revision: String(inspection.events.length + 1), occurredAt: new Date().toISOString() })
      return {
        jobId: inspection.job.id,
        leaseToken: token,
        generation,
        expiresAt,
        workOrder: {
          issueNumber: inspection.invocation.github.issue.number,
          title: inspection.invocation.github.issue.title,
          body: inspection.invocation.github.issue.body,
          comment: inspection.invocation.github.comment.body,
        },
      }
    },
    async setRunnerPaused(runnerId, paused) {
      if (!runnerCredentials.has(runnerId)) return false
      if (paused) pausedRunners.add(runnerId)
      else pausedRunners.delete(runnerId)
      return true
    },
    async heartbeatLease(input) {
      const lease = await matchingLease(leasesByJob, input)
      if (!lease) return false
      lease.expiresAt = new Date(Date.now() + 60_000).toISOString()
      return true
    },
    async completeLease(input) {
      const lease = await matchingLease(leasesByJob, input)
      if (!lease) return 'invalid_artifact'
      const inspection = inspectionsByJob.get(input.jobId)
      if (!inspection) return 'invalid_artifact'
      inspection.job.state = 'succeeded'
      inspection.artifact = input.artifact
      inspection.executionOutcome = { status: 'succeeded', completedAt: new Date().toISOString() }
      inspection.cleanupStatus = { status: 'verified', updatedAt: inspection.executionOutcome.completedAt }
      if (inspection.message) {
        inspection.message.revision += 1
        inspection.message.latestAttempt = 'pending'
      }
      inspection.events.push({ id: opaqueId('evt'), type: 'job.succeeded', revision: String(inspection.events.length + 1), occurredAt: inspection.executionOutcome.completedAt })
      leasesByJob.delete(input.jobId)
      return 'accepted'
    },
    async recordRunnerSuccess() {},
    async recordRunnerFault() {},
    async recordMessagePublication(jobId, update) {
      const message = inspectionsByJob.get(jobId)?.message
      if (!message) return
      message.githubCommentId = update.githubCommentId
      message.latestAttempt = update.attempt
    },
  }
}

async function matchingLease(
  leases: Map<string, { runnerId: string; tokenDigest: string; generation: number; expiresAt: string }>,
  input: LeaseInput,
) {
  const lease = leases.get(input.jobId)
  if (!lease || lease.runnerId !== input.runnerId || lease.expiresAt <= new Date().toISOString()) return undefined
  return lease.tokenDigest === await sha256(input.leaseToken) ? lease : undefined
}

function usableSetupToken(token: StoredSetupToken | undefined, now: string): token is StoredSetupToken {
  return token !== undefined && token.invalidatedAt === undefined && token.consumedAt === undefined && token.expiresAt > now
}

async function buildRecord(delivery: DeliveryInput): Promise<StoredRecord> {
  const createdAt = new Date().toISOString()
  const invocationId = opaqueId('inv')
  const jobId = opaqueId('job')
  const sourceSnapshot = {
    issue: { number: delivery.issueNumber, title: delivery.issueTitle, body: delivery.issueBody },
    comment: { id: delivery.commentId, body: delivery.commentBody },
  }
  const eventTypes = ['delivery.accepted', 'invocation.authorized', 'job.created', 'job.pending']
  const events = eventTypes.map((type, index) => ({
    id: opaqueId('evt'),
    type,
    revision: String(index < 2 ? index + 1 : index - 1),
    occurredAt: createdAt,
  }))
  return {
    delivery,
    bodySha256: delivery.bodySha256,
    events,
    inspection: {
      invocation: {
        id: invocationId,
        github: {
          deliveryId: delivery.deliveryId,
          installationId: delivery.installationId,
          repository: { id: delivery.repositoryId, fullName: delivery.repositoryFullName },
          issue: { number: delivery.issueNumber, title: delivery.issueTitle, body: delivery.issueBody },
          comment: { id: delivery.commentId, body: delivery.commentBody },
          actor: delivery.actor,
        },
        policyVersionId: ADMISSION_POLICY_VERSION_ID,
        createdAt,
      },
      job: {
        id: jobId,
        state: 'pending',
        flow: { id: ANALYZE_FLOW_ID, versionId: ANALYZE_FLOW_VERSION_ID },
        policy: { versionId: ADMISSION_POLICY_VERSION_ID },
        createdAt,
      },
      events: events.slice(2),
      message: {
        id: opaqueId('om'),
        revision: 1,
        effectKey: `github-message:${jobId}`,
        latestAttempt: 'pending',
      },
    },
  }
}

export function createD1InvocationStore(database: D1Database) {
  return new D1InvocationStore(database)
}

type RemoteRunnerRow = {
  runner_id: string
  desired_capacity: number
  enrollment_state: RemoteRunner['enrollment']
  readiness_state: 'not_ready' | 'ready'
}

function remoteRunnerFromRow(row: RemoteRunnerRow): RemoteRunner {
  return {
    id: row.runner_id,
    desiredCapacity: row.desired_capacity,
    enrollment: row.enrollment_state,
    ready: row.readiness_state === 'ready',
  }
}

class D1InvocationStore implements InvocationStore {
  constructor(private readonly database: D1Database) {}

  async admit(delivery: DeliveryInput): Promise<Admission | { conflict: true }> {
    const record = await buildRecord(delivery)
    const { invocation, job } = record.inspection
    const { events } = record
    const sourceSnapshot = canonicalJson({
      issue: invocation.github.issue,
      comment: invocation.github.comment,
    })
    const eventPayload = canonicalJson({
      invocationId: invocation.id,
      jobId: job.id,
      githubDeliveryId: delivery.deliveryId,
    })
    const eventPayloadSha256 = await sha256(eventPayload)
    const eventStatements = events.map((event, index) => {
      const streamKind = index < 2 ? 'invocation' : 'job'
      const streamId = streamKind === 'invocation' ? invocation.id : job.id
      const streamRevision = Number(event.revision)
      return this.database.prepare(`INSERT INTO domain_events (
        event_id, schema_version, stream_kind, stream_id, revision, event_type,
        payload_json, payload_sha256, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT invocation_id FROM deliveries WHERE github_delivery_id = ?) = ?`).bind(
        event.id, EVENT_SCHEMA_VERSION, streamKind, streamId, streamRevision, event.type,
        eventPayload, eventPayloadSha256, event.occurredAt, delivery.deliveryId, invocation.id,
      )
    })
    await this.database.batch([
      this.database.prepare(`INSERT INTO deliveries (
        github_delivery_id, body_sha256, invocation_id, job_id, accepted_at
      ) VALUES (?, ?, ?, ?, ?) ON CONFLICT(github_delivery_id) DO NOTHING`).bind(
        delivery.deliveryId, delivery.bodySha256, invocation.id, job.id, invocation.createdAt,
      ),
      this.database.prepare(`INSERT INTO invocations (
        invocation_id, schema_version, github_delivery_id, github_installation_id,
        github_repository_id, github_repository_full_name, github_issue_number,
        github_issue_title, github_issue_body, github_comment_id, github_comment_body,
        github_actor, source_snapshot_json, policy_version_id, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT invocation_id FROM deliveries WHERE github_delivery_id = ?) = ?`).bind(
        invocation.id, INVOCATION_SCHEMA_VERSION, delivery.deliveryId, delivery.installationId,
        delivery.repositoryId, delivery.repositoryFullName, delivery.issueNumber,
        delivery.issueTitle, delivery.issueBody, delivery.commentId, delivery.commentBody,
        delivery.actor, sourceSnapshot, invocation.policyVersionId, invocation.createdAt,
        delivery.deliveryId, invocation.id,
      ),
      this.database.prepare(`INSERT INTO jobs (
        job_id, schema_version, invocation_id, state, flow_id, flow_version_id,
        policy_version_id, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT invocation_id FROM deliveries WHERE github_delivery_id = ?) = ?`).bind(
        job.id, JOB_SCHEMA_VERSION, invocation.id, job.state, job.flow.id, job.flow.versionId,
        job.policy.versionId, job.createdAt, delivery.deliveryId, invocation.id,
      ),
      this.database.prepare(`INSERT INTO ornn_messages (
        message_id, job_id, revision, effect_key, latest_attempt, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT job_id FROM deliveries WHERE github_delivery_id = ?) = ?`).bind(
        record.inspection.message?.id, job.id, record.inspection.message?.revision,
        record.inspection.message?.effectKey, record.inspection.message?.latestAttempt,
        job.createdAt, job.createdAt, delivery.deliveryId, job.id,
      ),
      ...eventStatements,
    ])

    const persisted = await this.database.prepare(
      'SELECT invocation_id, job_id, body_sha256 FROM deliveries WHERE github_delivery_id = ?',
    ).bind(delivery.deliveryId).first<{ invocation_id: string; job_id: string; body_sha256: string }>()
    if (!persisted) throw new Error('D1 admission transaction did not persist delivery')
    if (persisted.body_sha256 !== delivery.bodySha256) return { conflict: true }
    return {
      invocationId: persisted.invocation_id,
      jobId: persisted.job_id,
      bodySha256: persisted.body_sha256,
      created: persisted.invocation_id === invocation.id,
    }
  }

  async inspectJob(jobId: string): Promise<JobInspection | undefined> {
    const row = await this.database.prepare(`SELECT
      j.job_id, j.state, j.flow_id, j.flow_version_id, j.policy_version_id AS job_policy_version_id,
      j.created_at AS job_created_at, j.execution_status, j.execution_completed_at, j.cleanup_status, j.cleanup_updated_at,
      m.message_id, m.revision AS message_revision, m.effect_key, m.github_comment_id AS github_message_comment_id, m.latest_attempt,
      a.artifact_json, i.invocation_id, i.github_delivery_id,
      i.github_installation_id, i.github_repository_id, i.github_repository_full_name,
      i.github_issue_number, i.github_issue_title, i.github_issue_body, i.github_comment_id,
      i.github_comment_body, i.github_actor, i.policy_version_id AS invocation_policy_version_id,
      i.created_at AS invocation_created_at
      FROM jobs j JOIN invocations i ON i.invocation_id = j.invocation_id
      LEFT JOIN ornn_messages m ON m.job_id = j.job_id
      LEFT JOIN analysis_artifacts a ON a.job_id = j.job_id
      WHERE j.job_id = ?`).bind(jobId).first<{
        job_id: string; state: 'pending' | 'leased' | 'succeeded'; flow_id: 'analyze'; flow_version_id: string; job_policy_version_id: string; job_created_at: string
        execution_status: 'succeeded' | null; execution_completed_at: string | null
        cleanup_status: CleanupStatus['status'] | null; cleanup_updated_at: string | null
        message_id: string | null; message_revision: number | null; effect_key: string | null; github_message_comment_id: string | null; latest_attempt: OrnnMessageState['latestAttempt'] | null
        artifact_json: string | null
        invocation_id: string; github_delivery_id: string; github_installation_id: string; github_repository_id: string; github_repository_full_name: string
        github_issue_number: number; github_issue_title: string; github_issue_body: string; github_comment_id: string; github_comment_body: string; github_actor: string
        invocation_policy_version_id: string; invocation_created_at: string
      }>()
    if (!row) return undefined
    const events = await this.database.prepare(`SELECT event_id, event_type, revision, created_at
      FROM domain_events WHERE stream_kind = 'job' AND stream_id = ?
      ORDER BY revision ASC`).bind(row.job_id).all<{
        event_id: string; event_type: string; revision: number; created_at: string
      }>()
    const artifact = row.artifact_json === null ? undefined : JSON.parse(row.artifact_json) as AnalysisArtifact
    return {
      invocation: {
        id: row.invocation_id,
        github: {
          deliveryId: row.github_delivery_id,
          installationId: row.github_installation_id,
          repository: { id: row.github_repository_id, fullName: row.github_repository_full_name },
          issue: { number: row.github_issue_number, title: row.github_issue_title, body: row.github_issue_body },
          comment: { id: row.github_comment_id, body: row.github_comment_body },
          actor: row.github_actor,
        },
        policyVersionId: row.invocation_policy_version_id,
        createdAt: row.invocation_created_at,
      },
      job: {
        id: row.job_id,
        state: row.state,
        flow: { id: row.flow_id, versionId: row.flow_version_id },
        policy: { versionId: row.job_policy_version_id },
        createdAt: row.job_created_at,
      },
      events: events.results.map((event) => ({
        id: event.event_id,
        type: event.event_type,
        revision: String(event.revision),
        occurredAt: event.created_at,
      })),
      message: row.message_id === null || row.message_revision === null || row.effect_key === null || row.latest_attempt === null
        ? undefined
        : { id: row.message_id, revision: row.message_revision, effectKey: row.effect_key, githubCommentId: row.github_message_comment_id ?? undefined, latestAttempt: row.latest_attempt },
      artifact,
      executionOutcome: row.execution_status === null || row.execution_completed_at === null
        ? undefined
        : { status: row.execution_status, completedAt: row.execution_completed_at },
      cleanupStatus: row.cleanup_status === null || row.cleanup_updated_at === null
        ? undefined
        : { status: row.cleanup_status, updatedAt: row.cleanup_updated_at },
    }
  }

  async inspectMessage(ornnMessageId: string): Promise<JobInspection | undefined> {
    const row = await this.database.prepare('SELECT job_id FROM ornn_messages WHERE message_id = ?').bind(ornnMessageId).first<{ job_id: string }>()
    return row ? this.inspectJob(row.job_id) : undefined
  }

  async createRemoteRunner(input: RemoteRunnerCreation): Promise<RemoteRunner> {
    await this.database.batch([
      this.database.prepare(`INSERT INTO remote_runners (
        runner_id, kind, desired_capacity, enrollment_state, readiness_state, created_at
      ) VALUES (?, 'remote', ?, 'awaiting_setup', 'not_ready', ?)`)
        .bind(input.id, input.desiredCapacity, input.createdAt),
      this.database.prepare(`INSERT INTO runner_setup_tokens (
        token_id, runner_id, token_digest, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)`)
        .bind(input.tokenId, input.id, input.tokenDigest, input.expiresAt, input.createdAt),
    ])
    return { id: input.id, desiredCapacity: input.desiredCapacity, enrollment: 'awaiting_setup', ready: false }
  }

  async regenerateSetupToken(input: NewSetupToken): Promise<RemoteRunner | undefined> {
    const runner = await this.remoteRunner(input.runnerId)
    if (!runner || runner.enrollment !== 'awaiting_setup') return undefined
    const active = await this.database.prepare(`SELECT token_id FROM runner_setup_tokens
      WHERE runner_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1`)
      .bind(input.runnerId).first<{ token_id: string }>()
    await this.database.batch([
      this.database.prepare(`UPDATE runner_setup_tokens SET invalidated_at = ?
        WHERE runner_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL`).bind(input.createdAt, input.runnerId),
      this.database.prepare(`INSERT INTO runner_setup_tokens (
        token_id, runner_id, token_digest, expires_at, created_at, replaced_token_id
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(input.tokenId, input.runnerId, input.tokenDigest, input.expiresAt, input.createdAt, active?.token_id ?? null),
    ])
    return runner
  }

  async preflightSetupToken(input: SetupTokenLookup): Promise<RemoteRunner | undefined> {
    return this.remoteRunnerForSetupToken(input)
  }

  async enrollRemoteRunner(input: SetupTokenEnrollment): Promise<RemoteRunner | undefined> {
    const results = await this.database.batch([
      this.database.prepare(`INSERT INTO runner_credentials (runner_id, credential_digest, created_at)
        SELECT token.runner_id, ?, ? FROM runner_setup_tokens token
        JOIN remote_runners runner ON runner.runner_id = token.runner_id
        WHERE token.token_digest = ? AND token.expires_at > ? AND token.invalidated_at IS NULL
          AND token.consumed_at IS NULL AND runner.enrollment_state = 'awaiting_setup'
        ON CONFLICT(runner_id) DO NOTHING`).bind(input.credentialDigest, input.now, input.tokenDigest, input.now),
      this.database.prepare(`UPDATE runner_setup_tokens SET consumed_at = ?
        WHERE token_digest = ? AND expires_at > ? AND invalidated_at IS NULL AND consumed_at IS NULL
          AND EXISTS (SELECT 1 FROM runner_credentials credential
            WHERE credential.runner_id = runner_setup_tokens.runner_id AND credential.credential_digest = ?)`)
        .bind(input.now, input.tokenDigest, input.now, input.credentialDigest),
      this.database.prepare(`UPDATE remote_runners SET enrollment_state = 'enrolled'
        WHERE runner_id = (SELECT runner_id FROM runner_setup_tokens WHERE token_digest = ? AND consumed_at = ?)
          AND EXISTS (SELECT 1 FROM runner_credentials credential
            WHERE credential.runner_id = remote_runners.runner_id AND credential.credential_digest = ?)`)
        .bind(input.tokenDigest, input.now, input.credentialDigest),
    ])
    if (results[1]?.meta.changes !== 1) return undefined
    const row = await this.database.prepare(`SELECT runner.runner_id, runner.desired_capacity,
      runner.enrollment_state, runner.readiness_state FROM remote_runners runner
      JOIN runner_setup_tokens token ON token.runner_id = runner.runner_id
      JOIN runner_credentials credential ON credential.runner_id = runner.runner_id
      WHERE token.token_digest = ? AND token.consumed_at = ? AND credential.credential_digest = ?`)
      .bind(input.tokenDigest, input.now, input.credentialDigest).first<RemoteRunnerRow>()
    return row ? remoteRunnerFromRow(row) : undefined
  }

  private async remoteRunnerForSetupToken(input: SetupTokenLookup): Promise<RemoteRunner | undefined> {
    const row = await this.database.prepare(`SELECT runner.runner_id, runner.desired_capacity,
      runner.enrollment_state, runner.readiness_state FROM runner_setup_tokens token
      JOIN remote_runners runner ON runner.runner_id = token.runner_id
      WHERE token.token_digest = ? AND token.expires_at > ? AND token.invalidated_at IS NULL AND token.consumed_at IS NULL`)
      .bind(input.tokenDigest, input.now).first<RemoteRunnerRow>()
    return row ? remoteRunnerFromRow(row) : undefined
  }

  private async remoteRunner(runnerId: string): Promise<RemoteRunner | undefined> {
    const row = await this.database.prepare(`SELECT runner_id, desired_capacity, enrollment_state, readiness_state
      FROM remote_runners WHERE runner_id = ?`).bind(runnerId).first<RemoteRunnerRow>()
    return row ? remoteRunnerFromRow(row) : undefined
  }

  async authenticateRunner(runnerId: string, credentialDigest: string): Promise<boolean> {
    const createdAt = new Date().toISOString()
    await this.database.prepare(`INSERT INTO runner_credentials (runner_id, credential_digest, created_at)
      VALUES (?, ?, ?) ON CONFLICT(runner_id) DO NOTHING`).bind(runnerId, credentialDigest, createdAt).run()
    const stored = await this.database.prepare('SELECT credential_digest FROM runner_credentials WHERE runner_id = ?')
      .bind(runnerId).first<{ credential_digest: string }>()
    if (stored?.credential_digest !== credentialDigest) return false
    await this.database.prepare(`INSERT INTO runner_presence (runner_id, last_seen_at)
      VALUES (?, ?) ON CONFLICT(runner_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`)
      .bind(runnerId, createdAt).run()
    return true
  }

  async updateRunnerProfile(runnerId: string, profile: RunnerProfile): Promise<void> {
    await this.database.prepare(`INSERT INTO runner_profiles (
      runner_id, release, platform, architecture, runtime, executor, capacity, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(runner_id) DO UPDATE SET release = excluded.release, platform = excluded.platform,
      architecture = excluded.architecture, runtime = excluded.runtime, executor = excluded.executor,
      capacity = excluded.capacity, updated_at = excluded.updated_at`).bind(
      runnerId, profile.release, profile.platform, profile.architecture, profile.runtime, profile.executor,
      profile.capacity, new Date().toISOString(),
    ).run()
  }

  async pollRunner(runnerId: string): Promise<LeaseGrant | undefined> {
    const capacity = await this.database.prepare(`SELECT COALESCE(
      (SELECT desired_capacity FROM remote_runners WHERE runner_id = ?),
      (SELECT capacity FROM runner_profiles WHERE runner_id = ?), 1
    ) AS capacity`).bind(runnerId, runnerId).first<{ capacity: number }>()
    const reservations = await this.database.prepare(`SELECT COUNT(*) AS count FROM runner_leases l
      JOIN jobs j ON j.job_id = l.job_id WHERE l.runner_id = ? AND j.cleanup_status IS NOT 'verified'`).bind(runnerId)
      .first<{ count: number }>()
    if ((reservations?.count ?? 0) >= (capacity?.capacity ?? 1)) return undefined
    const candidate = await this.database.prepare(`SELECT j.job_id, i.github_issue_number, i.github_issue_title,
      i.github_issue_body, i.github_comment_body FROM jobs j JOIN invocations i ON i.invocation_id = j.invocation_id
      WHERE j.state = 'pending' ORDER BY j.created_at ASC LIMIT 1`).first<{
        job_id: string; github_issue_number: number; github_issue_title: string; github_issue_body: string; github_comment_body: string
      }>()
    if (!candidate) return undefined
    const now = new Date().toISOString()
    const leaseToken = opaqueId('lease')
    const tokenDigest = await sha256(leaseToken)
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const eventId = opaqueId('evt')
    const eventPayload = canonicalJson({ jobId: candidate.job_id, runnerId, expiresAt })
    const eventPayloadSha256 = await sha256(eventPayload)
    await this.database.batch([
      this.database.prepare(`INSERT INTO runner_leases (job_id, runner_id, generation, token_digest, expires_at, last_heartbeat_at, created_at)
        SELECT ?, ?, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM jobs WHERE job_id = ? AND state = 'pending')
        AND NOT EXISTS (SELECT 1 FROM runner_pauses WHERE runner_id = ? AND paused = 1)
        AND (SELECT COUNT(*) FROM runner_leases l JOIN jobs j ON j.job_id = l.job_id
          WHERE l.runner_id = ? AND j.cleanup_status IS NOT 'verified') <
          COALESCE((SELECT desired_capacity FROM remote_runners WHERE runner_id = ?),
            (SELECT capacity FROM runner_profiles WHERE runner_id = ?), 1)`).bind(
        candidate.job_id, runnerId, tokenDigest, expiresAt, now, now, candidate.job_id, runnerId, runnerId, runnerId, runnerId,
      ),
      this.database.prepare(`UPDATE jobs SET state = 'leased' WHERE job_id = ? AND state = 'pending'
        AND EXISTS (SELECT 1 FROM runner_leases WHERE job_id = ? AND token_digest = ?)`).bind(candidate.job_id, candidate.job_id, tokenDigest),
      this.database.prepare(`INSERT INTO domain_events (event_id, schema_version, stream_kind, stream_id, revision, event_type, payload_json, payload_sha256, created_at)
        SELECT ?, ?, 'job', ?, 3, 'job.leased', ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM runner_leases WHERE job_id = ? AND token_digest = ?)`).bind(
        eventId, EVENT_SCHEMA_VERSION, candidate.job_id, eventPayload, eventPayloadSha256, now, candidate.job_id, tokenDigest,
      ),
    ])
    const persisted = await this.database.prepare(`SELECT generation FROM runner_leases WHERE job_id = ? AND runner_id = ? AND token_digest = ?`)
      .bind(candidate.job_id, runnerId, tokenDigest).first<{ generation: number }>()
    if (!persisted) return undefined
    return {
      jobId: candidate.job_id,
      leaseToken,
      generation: persisted.generation,
      expiresAt,
      workOrder: {
        issueNumber: candidate.github_issue_number,
        title: candidate.github_issue_title,
        body: candidate.github_issue_body,
        comment: candidate.github_comment_body,
      },
    }
  }

  async setRunnerPaused(runnerId: string, paused: boolean): Promise<boolean> {
    const result = await this.database.prepare(`INSERT INTO runner_pauses (runner_id, paused, updated_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM runner_credentials WHERE runner_id = ?)
      ON CONFLICT(runner_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`).bind(
      runnerId, paused ? 1 : 0, new Date().toISOString(), runnerId,
    ).run()
    return result.meta.changes === 1
  }

  async recordRunnerSuccess(runnerId: string): Promise<void> {
    await this.database.prepare('DELETE FROM runner_error_states WHERE runner_id = ?').bind(runnerId).run()
  }

  async recordRunnerFault(runnerId: string, fault: RunnerFault): Promise<void> {
    await this.database.prepare(`INSERT INTO runner_error_states (runner_id, code, occurred_at) VALUES (?, ?, ?)
      ON CONFLICT(runner_id) DO UPDATE SET code = excluded.code, occurred_at = excluded.occurred_at`)
      .bind(runnerId, fault.code, new Date().toISOString()).run()
  }

  async heartbeatLease(input: LeaseInput): Promise<boolean> {
    const now = new Date().toISOString()
    const expiry = new Date(Date.now() + 60_000).toISOString()
    const tokenDigest = await sha256(input.leaseToken)
    const result = await this.database.prepare(`UPDATE runner_leases SET expires_at = ?, last_heartbeat_at = ?
      WHERE job_id = ? AND runner_id = ? AND token_digest = ? AND expires_at > ?
      AND EXISTS (SELECT 1 FROM jobs WHERE job_id = ? AND state = 'leased')`).bind(
      expiry, now, input.jobId, input.runnerId, tokenDigest, now, input.jobId,
    ).run()
    return result.meta.changes === 1
  }

  async completeLease(input: LeaseInput & { artifact: AnalysisArtifact }): Promise<'accepted' | 'invalid_artifact'> {
    const artifactJson = canonicalJson(input.artifact)
    if (new TextEncoder().encode(artifactJson).byteLength > 512 * 1024) return 'invalid_artifact'
    const now = new Date().toISOString()
    const tokenDigest = await sha256(input.leaseToken)
    const validLease = await this.database.prepare(`SELECT 1 FROM jobs j JOIN runner_leases l ON l.job_id = j.job_id
      WHERE j.job_id = ? AND j.state = 'leased' AND l.runner_id = ? AND l.token_digest = ? AND l.expires_at > ?`).bind(
      input.jobId, input.runnerId, tokenDigest, now,
    ).first()
    if (!validLease) return 'invalid_artifact'
    const eventPayload = canonicalJson({ jobId: input.jobId, result: input.artifact.kind })
    const eventPayloadSha256 = await sha256(eventPayload)
    await this.database.batch([
      this.database.prepare(`UPDATE jobs SET state = 'succeeded', execution_status = 'succeeded', execution_completed_at = ?, cleanup_status = 'verified', cleanup_updated_at = ?
        WHERE job_id = ? AND state = 'leased' AND EXISTS (SELECT 1 FROM runner_leases
        WHERE job_id = ? AND runner_id = ? AND token_digest = ? AND expires_at > ?)`).bind(
        now, now, input.jobId, input.jobId, input.runnerId, tokenDigest, now,
      ),
      this.database.prepare(`INSERT INTO analysis_artifacts (job_id, schema_version, artifact_json, created_at)
        SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM jobs WHERE job_id = ? AND state = 'succeeded')
        ON CONFLICT(job_id) DO NOTHING`).bind(input.jobId, artifactJson, now, input.jobId),
      this.database.prepare(`INSERT INTO domain_events (event_id, schema_version, stream_kind, stream_id, revision, event_type, payload_json, payload_sha256, created_at)
        SELECT ?, ?, 'job', ?, 4, 'job.succeeded', ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM jobs WHERE job_id = ? AND state = 'succeeded')
        ON CONFLICT(stream_kind, stream_id, revision) DO NOTHING`).bind(
        opaqueId('evt'), EVENT_SCHEMA_VERSION, input.jobId, eventPayload, eventPayloadSha256, now, input.jobId,
      ),
      this.database.prepare(`UPDATE ornn_messages SET revision = revision + 1, latest_attempt = 'pending', updated_at = ?
        WHERE job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE job_id = ? AND state = 'succeeded')`).bind(now, input.jobId, input.jobId),
    ])
    const completed = await this.database.prepare(`SELECT state FROM jobs WHERE job_id = ?`).bind(input.jobId)
      .first<{ state: string }>()
    return completed?.state === 'succeeded' ? 'accepted' : 'invalid_artifact'
  }

  async recordMessagePublication(jobId: string, update: { githubCommentId?: string; attempt: OrnnMessageState['latestAttempt'] }): Promise<void> {
    await this.database.prepare(`UPDATE ornn_messages SET github_comment_id = COALESCE(?, github_comment_id), latest_attempt = ?, updated_at = ?
      WHERE job_id = ?`).bind(update.githubCommentId ?? null, update.attempt, new Date().toISOString(), jobId).run()
  }
}

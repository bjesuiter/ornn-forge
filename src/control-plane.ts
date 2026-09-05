const API_VERSION = 'v1'
const EVENT_SCHEMA_VERSION = 1
const INVOCATION_SCHEMA_VERSION = 1
const JOB_SCHEMA_VERSION = 1
const ANALYZE_FLOW_ID = 'analyze'
const ANALYZE_FLOW_VERSION_ID = 'fv_v1_nTrDKcC7adfgDeQBd41eiA'
const ADMISSION_POLICY_VERSION_ID = 'pv_v1_bCpHOE6Md2lHYS8NiKZq5w'
const MAX_SOURCE_FIELD_LENGTH = 16_384

export type ControlPlaneOptions = {
  store: InvocationStore
  githubWebhookSecret: string
  githubInstallationId: string
  githubRepositoryId: string
  githubRepositoryFullName?: string
  operatorBearerSecret: string
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
    state: 'pending'
    flow: { id: 'analyze'; versionId: string }
    policy: { versionId: string }
    createdAt: string
  }
  events: EventRecord[]
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
}

export function createControlPlane(options: ControlPlaneOptions) {
  const operatorCredential = operatorCredentialBytes(options.operatorBearerSecret)
  if (!operatorCredential) {
    throw new Error('OPERATOR_BEARER_SECRET must contain exactly 256 bits')
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/api/v1/github/webhook') {
        return admitGitHubDelivery(request, options)
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

      return json({ apiVersion: API_VERSION, error: { code: 'route_not_found' } }, 404)
    },
  }
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

  if (request.headers.get('x-github-event') !== 'issue_comment') {
    return json({ apiVersion: API_VERSION, error: { code: 'unsupported_event' } }, 422)
  }

  const deliveryId = request.headers.get('x-github-delivery')
  if (!deliveryId || deliveryId.length > 200) {
    return json({ apiVersion: API_VERSION, error: { code: 'invalid_delivery' } }, 400)
  }

  const parsed = parseIssueComment(body)
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
    deliveryId,
    bodySha256: await sha256Bytes(rawBody),
  })
  if ('conflict' in admitted) {
    return json({ apiVersion: API_VERSION, error: { code: 'delivery_identity_conflict' } }, 409)
  }

  return json({
    apiVersion: API_VERSION,
    invocationId: admitted.invocationId,
    jobId: admitted.jobId,
    replayed: !admitted.created,
  }, admitted.created ? 201 : 200)
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

export function createInMemoryInvocationStore(): InvocationStore {
  const recordsByDelivery = new Map<string, StoredRecord>()
  const inspectionsByJob = new Map<string, JobInspection>()
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
  }
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
    },
  }
}

export function createD1InvocationStore(database: D1Database): InvocationStore {
  return new D1InvocationStore(database)
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
      j.created_at AS job_created_at, i.invocation_id, i.github_delivery_id,
      i.github_installation_id, i.github_repository_id, i.github_repository_full_name,
      i.github_issue_number, i.github_issue_title, i.github_issue_body, i.github_comment_id,
      i.github_comment_body, i.github_actor, i.policy_version_id AS invocation_policy_version_id,
      i.created_at AS invocation_created_at
      FROM jobs j JOIN invocations i ON i.invocation_id = j.invocation_id
      WHERE j.job_id = ?`).bind(jobId).first<{
        job_id: string; state: 'pending'; flow_id: 'analyze'; flow_version_id: string; job_policy_version_id: string; job_created_at: string
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
    }
  }
}

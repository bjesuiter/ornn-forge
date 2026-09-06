const CACHE_TTL_MS = 60_000
const DEVICE_AUTH_TTL_MS = 15 * 60_000
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device'
const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback'

export type OpenAiSubscriptionUsage =
  | { status: 'available'; plan: string | undefined; credits: number | undefined; checkedAt: string; windows: OpenAiUsageWindow[] }
  | { status: 'connecting'; userCode: string; verificationUri: string; expiresAt: string }
  | { status: 'unavailable'; reason: 'not_connected' | 'upstream_error' }

export type OpenAiUsageWindow = { label: string; usedPercent: number; resetsAt: string | undefined }

type UsageResponse = {
  plan_type?: unknown
  credits?: unknown
  rate_limit?: { primary_window?: UsageWindowResponse; secondary_window?: UsageWindowResponse }
}
type UsageWindowResponse = { used_percent?: unknown; reset_at?: unknown }
type OpenAiCredential = { accessToken: string; refreshToken: string; accountId: string | undefined }
type DeviceAuthorization = { deviceAuthId: string; userCode: string; intervalSeconds: number; expiresAt: string }
type CredentialRow = { encrypted_record: string }
type SnapshotRow = {
  plan: string | null
  credits: number | null
  primary_used_percent: number | null
  primary_resets_at: string | null
  secondary_used_percent: number | null
  secondary_resets_at: string | null
  checked_at: string
}
type DeviceAuthorizationRow = { device_auth_id: string; user_code: string; interval_seconds: number; expires_at: string }
type SecretStoreSecret = { get(): Promise<string | undefined> }

export async function getCachedOpenAiSubscriptionUsage(database: D1Database, now = new Date()): Promise<OpenAiSubscriptionUsage> {
  const authorization = await readDeviceAuthorization(database)
  if (authorization && new Date(authorization.expiresAt) > now) return connectingUsage(authorization)
  if (authorization) await clearDeviceAuthorization(database)

  const snapshot = await database.prepare(`
    SELECT plan, credits, primary_used_percent, primary_resets_at,
      secondary_used_percent, secondary_resets_at, checked_at
    FROM openai_subscription_usage_snapshot WHERE singleton = 1
  `).first<SnapshotRow>()
  if (snapshot) return usageFromSnapshot(snapshot)
  const credential = await database.prepare('SELECT singleton FROM openai_subscription_credentials WHERE singleton = 1').first()
  return credential ? { status: 'unavailable', reason: 'upstream_error' } : { status: 'unavailable', reason: 'not_connected' }
}

export async function startOpenAiSubscriptionAuthorization({
  database, encryptionKey, fetcher = fetch, now = new Date(),
}: {
  database: D1Database
  encryptionKey: SecretStoreSecret | undefined
  fetcher?: typeof fetch
  now?: Date
}): Promise<OpenAiSubscriptionUsage> {
  await encryptionKeyFromStore(encryptionKey)
  const current = await readDeviceAuthorization(database)
  if (current && new Date(current.expiresAt) > now) return connectingUsage(current)
  if (current) await clearDeviceAuthorization(database)

  const response = await fetcher(DEVICE_CODE_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  })
  if (!response.ok) throw new Error('OpenAI device authorization could not be started')
  const authorization = deviceAuthorizationFromResponse(await response.json(), now)
  if (!authorization) throw new Error('OpenAI device authorization returned an invalid response')

  await database.prepare(`
    INSERT INTO openai_subscription_device_authorizations
      (singleton, device_auth_id, user_code, interval_seconds, expires_at, created_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      device_auth_id = excluded.device_auth_id, user_code = excluded.user_code,
      interval_seconds = excluded.interval_seconds, expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `).bind(authorization.deviceAuthId, authorization.userCode, authorization.intervalSeconds, authorization.expiresAt, now.toISOString()).run()
  return connectingUsage(authorization)
}

export async function completeOpenAiSubscriptionAuthorization({
  database, encryptionKey, fetcher = fetch, now = new Date(),
}: {
  database: D1Database
  encryptionKey: SecretStoreSecret | undefined
  fetcher?: typeof fetch
  now?: Date
}): Promise<'pending' | 'connected' | 'expired'> {
  const authorization = await readDeviceAuthorization(database)
  if (!authorization || new Date(authorization.expiresAt) <= now) {
    if (authorization) await clearDeviceAuthorization(database)
    return 'expired'
  }

  const deviceResponse = await fetcher(DEVICE_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_auth_id: authorization.deviceAuthId, user_code: authorization.userCode }),
  })
  if (!deviceResponse.ok) return 'pending'
  const deviceToken = deviceTokenFromResponse(await deviceResponse.json())
  if (!deviceToken) return 'pending'

  const tokenResponse = await fetcher(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: CODEX_CLIENT_ID, code: deviceToken.authorizationCode,
      code_verifier: deviceToken.codeVerifier, redirect_uri: DEVICE_REDIRECT_URI,
    }),
  })
  if (!tokenResponse.ok) throw new Error('OpenAI authorization could not be completed')
  const credential = credentialFromTokenResponse(await tokenResponse.json())
  if (!credential) throw new Error('OpenAI authorization returned invalid credentials')

  const key = await encryptionKeyFromStore(encryptionKey)
  const encryptedRecord = await encryptCredential(key, credential)
  await database.batch([
    database.prepare(`
      INSERT INTO openai_subscription_credentials (singleton, encrypted_record, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET encrypted_record = excluded.encrypted_record, updated_at = excluded.updated_at
    `).bind(encryptedRecord, now.toISOString()),
    database.prepare('DELETE FROM openai_subscription_device_authorizations WHERE singleton = 1'),
    database.prepare('DELETE FROM openai_subscription_usage_snapshot WHERE singleton = 1'),
  ])
  await refreshOpenAiSubscriptionUsage({ database, encryptionKey, fetcher, now })
  return 'connected'
}

export async function refreshOpenAiSubscriptionUsage({
  database, encryptionKey, fetcher = fetch, now = new Date(),
}: {
  database: D1Database
  encryptionKey: SecretStoreSecret | undefined
  fetcher?: typeof fetch
  now?: Date
}): Promise<void> {
  const snapshot = await database.prepare('SELECT checked_at FROM openai_subscription_usage_snapshot WHERE singleton = 1').first<{ checked_at: string }>()
  if (snapshot && now.getTime() - new Date(snapshot.checked_at).getTime() < CACHE_TTL_MS) return
  const record = await database.prepare('SELECT encrypted_record FROM openai_subscription_credentials WHERE singleton = 1').first<CredentialRow>()
  if (!record) return

  try {
    const key = await encryptionKeyFromStore(encryptionKey)
    let credential = await decryptCredential(key, record.encrypted_record)
    let response = await usageResponse(fetcher, credential)
    if (response.status === 401) {
      const refreshed = await refreshCredential(fetcher, credential.refreshToken)
      if (!refreshed) return
      credential = refreshed
      const encryptedRecord = await encryptCredential(key, credential)
      await database.prepare('UPDATE openai_subscription_credentials SET encrypted_record = ?, updated_at = ? WHERE singleton = 1')
        .bind(encryptedRecord, now.toISOString()).run()
      response = await usageResponse(fetcher, credential)
    }
    if (!response.ok) return
    const usage = openAiSubscriptionUsageFromResponse(await response.json(), now.toISOString())
    if (usage.status !== 'available') return
    await writeSnapshot(database, usage)
  } catch {
    // Preserve the last safe snapshot without exposing credentials or response bodies.
  }
}

export async function disconnectOpenAiSubscription(database: D1Database): Promise<void> {
  await database.batch([
    database.prepare('DELETE FROM openai_subscription_credentials WHERE singleton = 1'),
    database.prepare('DELETE FROM openai_subscription_usage_snapshot WHERE singleton = 1'),
    database.prepare('DELETE FROM openai_subscription_device_authorizations WHERE singleton = 1'),
  ])
}

export function openAiSubscriptionUsageFromResponse(value: unknown, checkedAt: string): OpenAiSubscriptionUsage {
  if (!isUsageResponse(value)) return { status: 'unavailable', reason: 'upstream_error' }
  const windows = [
    usageWindowFromResponse('5 Stunden', value.rate_limit?.primary_window),
    usageWindowFromResponse('Woche', value.rate_limit?.secondary_window),
  ].filter((window): window is OpenAiUsageWindow => window !== undefined)
  if (windows.length === 0) return { status: 'unavailable', reason: 'upstream_error' }
  return { status: 'available', plan: nonEmptyString(value.plan_type), credits: creditsFromResponse(value.credits), checkedAt, windows }
}

export async function encryptOpenAiSubscriptionCredential(keyText: string, credential: OpenAiCredential): Promise<string> {
  return encryptCredential(await encryptionKeyFromText(keyText), credential)
}

export async function decryptOpenAiSubscriptionCredential(keyText: string, encryptedRecord: string): Promise<OpenAiCredential> {
  return decryptCredential(await encryptionKeyFromText(keyText), encryptedRecord)
}

function usageWindowFromResponse(label: string, value: UsageWindowResponse | undefined): OpenAiUsageWindow | undefined {
  if (!value || typeof value.used_percent !== 'number' || !Number.isFinite(value.used_percent)) return undefined
  const resetsAt = typeof value.reset_at === 'number' && Number.isFinite(value.reset_at) ? new Date(value.reset_at * 1_000).toISOString() : undefined
  return { label, usedPercent: Math.min(100, Math.max(0, value.used_percent)), resetsAt }
}

function creditsFromResponse(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || value === null || !('balance' in value)) return undefined
  return typeof value.balance === 'number' && Number.isFinite(value.balance) ? value.balance : undefined
}

function isUsageResponse(value: unknown): value is UsageResponse {
  return typeof value === 'object' && value !== null
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function connectingUsage(authorization: DeviceAuthorization): OpenAiSubscriptionUsage {
  return { status: 'connecting', userCode: authorization.userCode, verificationUri: DEVICE_VERIFICATION_URL, expiresAt: authorization.expiresAt }
}

function deviceAuthorizationFromResponse(value: unknown, now: Date): DeviceAuthorization | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const deviceAuthId = 'device_auth_id' in value ? nonEmptyString(value.device_auth_id) : undefined
  const userCode = 'user_code' in value ? nonEmptyString(value.user_code) : undefined
  const interval = 'interval' in value ? Number(value.interval) : NaN
  if (!deviceAuthId || !userCode || !Number.isFinite(interval) || interval < 0) return undefined
  return { deviceAuthId, userCode, intervalSeconds: interval, expiresAt: new Date(now.getTime() + DEVICE_AUTH_TTL_MS).toISOString() }
}

function deviceTokenFromResponse(value: unknown): { authorizationCode: string; codeVerifier: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const authorizationCode = 'authorization_code' in value ? nonEmptyString(value.authorization_code) : undefined
  const codeVerifier = 'code_verifier' in value ? nonEmptyString(value.code_verifier) : undefined
  return authorizationCode && codeVerifier ? { authorizationCode, codeVerifier } : undefined
}

function credentialFromTokenResponse(value: unknown): OpenAiCredential | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const accessToken = 'access_token' in value ? nonEmptyString(value.access_token) : undefined
  const refreshToken = 'refresh_token' in value ? nonEmptyString(value.refresh_token) : undefined
  return accessToken && refreshToken ? { accessToken, refreshToken, accountId: accountIdFromJwt(accessToken) } : undefined
}

async function usageResponse(fetcher: typeof fetch, credential: OpenAiCredential): Promise<Response> {
  return fetcher(USAGE_URL, {
    headers: { authorization: `Bearer ${credential.accessToken}`, ...(credential.accountId ? { 'chatgpt-account-id': credential.accountId } : {}) },
  })
}

async function refreshCredential(fetcher: typeof fetch, refreshToken: string): Promise<OpenAiCredential | undefined> {
  const response = await fetcher(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CODEX_CLIENT_ID }),
  })
  return response.ok ? credentialFromTokenResponse(await response.json()) : undefined
}

async function writeSnapshot(database: D1Database, usage: Extract<OpenAiSubscriptionUsage, { status: 'available' }>): Promise<void> {
  const primary = usage.windows.find((window) => window.label === '5 Stunden')
  const secondary = usage.windows.find((window) => window.label === 'Woche')
  await database.prepare(`
    INSERT INTO openai_subscription_usage_snapshot (
      singleton, plan, credits, primary_used_percent, primary_resets_at, secondary_used_percent, secondary_resets_at, checked_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      plan = excluded.plan, credits = excluded.credits, primary_used_percent = excluded.primary_used_percent,
      primary_resets_at = excluded.primary_resets_at, secondary_used_percent = excluded.secondary_used_percent,
      secondary_resets_at = excluded.secondary_resets_at, checked_at = excluded.checked_at
  `).bind(usage.plan ?? null, usage.credits ?? null, primary?.usedPercent ?? null, primary?.resetsAt ?? null,
    secondary?.usedPercent ?? null, secondary?.resetsAt ?? null, usage.checkedAt).run()
}

function usageFromSnapshot(snapshot: SnapshotRow): OpenAiSubscriptionUsage {
  const windows = [
    snapshot.primary_used_percent === null ? undefined : { label: '5 Stunden', usedPercent: snapshot.primary_used_percent, resetsAt: snapshot.primary_resets_at ?? undefined },
    snapshot.secondary_used_percent === null ? undefined : { label: 'Woche', usedPercent: snapshot.secondary_used_percent, resetsAt: snapshot.secondary_resets_at ?? undefined },
  ].filter((window): window is OpenAiUsageWindow => window !== undefined)
  return { status: 'available', plan: snapshot.plan ?? undefined, credits: snapshot.credits ?? undefined, checkedAt: snapshot.checked_at, windows }
}

async function readDeviceAuthorization(database: D1Database): Promise<DeviceAuthorization | undefined> {
  const row = await database.prepare(`
    SELECT device_auth_id, user_code, interval_seconds, expires_at
    FROM openai_subscription_device_authorizations WHERE singleton = 1
  `).first<DeviceAuthorizationRow>()
  return row ? { deviceAuthId: row.device_auth_id, userCode: row.user_code, intervalSeconds: row.interval_seconds, expiresAt: row.expires_at } : undefined
}

async function clearDeviceAuthorization(database: D1Database): Promise<void> {
  await database.prepare('DELETE FROM openai_subscription_device_authorizations WHERE singleton = 1').run()
}

async function encryptionKeyFromStore(secret: SecretStoreSecret | undefined): Promise<CryptoKey> {
  const value = await secret?.get()
  if (!value) throw new Error('Ornn D1 secrets encryption key is not configured')
  return encryptionKeyFromText(value)
}

async function encryptionKeyFromText(value: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(value)
  if (bytes.length !== 32) throw new Error('Ornn D1 secrets encryption key must be 256 bits')
  return crypto.subtle.importKey('raw', arrayBuffer(bytes), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptCredential(key: CryptoKey, credential: OpenAiCredential): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(credential))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(nonce) }, key, arrayBuffer(plaintext))
  return JSON.stringify({ v: 1, n: bytesToBase64Url(nonce), c: bytesToBase64Url(new Uint8Array(encrypted)) })
}

async function decryptCredential(key: CryptoKey, encryptedRecord: string): Promise<OpenAiCredential> {
  const record = encryptedRecordFromJson(encryptedRecord)
  if (!record) throw new Error('OpenAI subscription credential ciphertext is invalid')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: arrayBuffer(base64UrlToBytes(record.n)) },
    key,
    arrayBuffer(base64UrlToBytes(record.c)),
  )
  const credential = credentialFromDecryptedJson(new TextDecoder().decode(plaintext))
  if (!credential) throw new Error('OpenAI subscription credential plaintext is invalid')
  return credential
}

function encryptedRecordFromJson(value: string): { n: string; c: string } | undefined {
  try {
    const record = JSON.parse(value) as unknown
    if (typeof record !== 'object' || record === null || !('v' in record) || record.v !== 1) return undefined
    const nonce = 'n' in record ? nonEmptyString(record.n) : undefined
    const ciphertext = 'c' in record ? nonEmptyString(record.c) : undefined
    return nonce && ciphertext ? { n: nonce, c: ciphertext } : undefined
  } catch { return undefined }
}

function credentialFromDecryptedJson(value: string): OpenAiCredential | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const accessToken = 'accessToken' in parsed ? nonEmptyString(parsed.accessToken) : undefined
    const refreshToken = 'refreshToken' in parsed ? nonEmptyString(parsed.refreshToken) : undefined
    const accountId = 'accountId' in parsed ? nonEmptyString(parsed.accountId) : undefined
    return accessToken && refreshToken ? { accessToken, refreshToken, accountId } : undefined
  } catch { return undefined }
}

function accountIdFromJwt(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as unknown
    if (typeof value !== 'object' || value === null || !('https://api.openai.com/auth' in value)) return undefined
    const auth = value['https://api.openai.com/auth']
    return typeof auth === 'object' && auth !== null && 'chatgpt_account_id' in auth ? nonEmptyString(auth.chatgpt_account_id) : undefined
  } catch { return undefined }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url data')
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

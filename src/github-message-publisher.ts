import type { OrnnMessagePublisher } from './control-plane'

export type GitHubAppCredentials = {
  appId: string
  privateKey: string
  installationId: string
  repositoryId: string
}

export function createGitHubMessagePublisher(
  credentials: GitHubAppCredentials,
  request: typeof fetch = fetch,
): OrnnMessagePublisher {
  let installationToken: Promise<{ token: string; expiresAt: string }> | undefined
  const headers = async () => {
    installationToken ??= createGitHubInstallationToken(credentials, { issues: 'write' }, request)
    return githubHeaders((await installationToken).token)
  }

  return {
    async reconcile({ repository, issueNumber, effectKey, githubCommentId, body }) {
      const authenticatedHeaders = await headers()
      if (!githubCommentId) return findEffectComment(repository, issueNumber, effectKey, body, request, authenticatedHeaders)
      const response = await request(`https://api.github.com/repos/${repository}/issues/comments/${githubCommentId}`, { headers: authenticatedHeaders })
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`GitHub comment reconciliation failed: ${response.status}`)
      const comment = await response.json() as { id?: number; body?: string }
      return comment.body === body && comment.id !== undefined
        ? { githubCommentId: String(comment.id) }
        : undefined
    },
    async create({ repository, issueNumber, body }) {
      const authenticatedHeaders = await headers()
      const response = await request(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`, {
        method: 'POST', headers: authenticatedHeaders, body: JSON.stringify({ body }),
      })
      if (!response.ok) throw new Error(`GitHub comment creation failed: ${response.status}`)
      const comment = await response.json() as { id?: number }
      if (comment.id === undefined) throw new Error('GitHub comment creation returned no comment ID')
      return { githubCommentId: String(comment.id) }
    },
    async update({ repository, githubCommentId, body }) {
      const authenticatedHeaders = await headers()
      const response = await request(`https://api.github.com/repos/${repository}/issues/comments/${githubCommentId}`, {
        method: 'PATCH', headers: authenticatedHeaders, body: JSON.stringify({ body }),
      })
      if (!response.ok) throw new Error(`GitHub comment update failed: ${response.status}`)
    },
  }
}

export async function createGitHubInstallationToken(
  credentials: GitHubAppCredentials,
  permissions: Record<string, 'read' | 'write'>,
  request: typeof fetch = fetch,
): Promise<{ token: string; expiresAt: string }> {
  const repositoryId = Number(credentials.repositoryId)
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error('GITHUB_REPOSITORY_ID must be a positive integer')
  }

  const appJwt = await signAppJwt(credentials.appId, credentials.privateKey)
  const response = await request(
    `https://api.github.com/app/installations/${credentials.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${appJwt}`,
        'content-type': 'application/json',
        'user-agent': 'ornn-forge',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        repository_ids: [repositoryId],
        permissions,
      }),
    },
  )
  if (!response.ok) throw new Error(`GitHub installation token creation failed: ${response.status}`)

  const body = await response.json() as { token?: unknown; expires_at?: unknown }
  if (typeof body.token !== 'string' || body.token.length === 0 || typeof body.expires_at !== 'string' || Number.isNaN(Date.parse(body.expires_at))) {
    throw new Error('GitHub installation token creation returned no token')
  }
  return { token: body.token, expiresAt: body.expires_at }
}

async function signAppJwt(appId: string, privateKey: string): Promise<string> {
  if (!/^\d+$/.test(appId)) throw new Error('GITHUB_APP_ID must be numeric')

  const now = Math.floor(Date.now() / 1_000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  }))
  const signingInput = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    arrayBuffer(privateKeyDer(privateKey)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

function githubHeaders(token: string): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'ornn-forge',
    'x-github-api-version': '2022-11-28',
  }
}

function privateKeyDer(privateKey: string): Uint8Array {
  const match = /^-----BEGIN (RSA )?PRIVATE KEY-----\s*([\s\S]*?)\s*-----END \1PRIVATE KEY-----\s*$/.exec(privateKey)
  if (!match) throw new Error('GITHUB_APP_PRIVATE_KEY must be a PEM-encoded private key')

  const der = base64Decode(match[2].replace(/\s/g, ''))
  return match[1] === 'RSA ' ? pkcs1ToPkcs8(der) : der
}

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // GitHub downloads PKCS#1 keys; Web Crypto imports PKCS#8.
  const version = Uint8Array.of(0x02, 0x01, 0x00)
  const rsaEncryption = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  )
  return derSequence(version, rsaEncryption, derOctetString(pkcs1))
}

function derSequence(...parts: Uint8Array[]): Uint8Array {
  return derValue(0x30, joinBytes(parts))
}

function derOctetString(value: Uint8Array): Uint8Array {
  return derValue(0x04, value)
}

function derValue(tag: number, value: Uint8Array): Uint8Array {
  const length = derLength(value.length)
  const result = new Uint8Array(1 + length.length + value.length)
  result[0] = tag
  result.set(length, 1)
  result.set(value, 1 + length.length)
  return result
}

function derLength(length: number): Uint8Array {
  if (length < 128) return Uint8Array.of(length)

  const bytes: number[] = []
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff)
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64Decode(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  } catch {
    throw new Error('GITHUB_APP_PRIVATE_KEY must contain base64-encoded key data')
  }
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(value.length)
  const copy = new Uint8Array(result)
  copy.set(value)
  return result
}

async function findEffectComment(
  repository: string,
  issueNumber: number,
  effectKey: string,
  body: string,
  request: typeof fetch,
  headers: HeadersInit,
): Promise<{ githubCommentId: string } | undefined> {
  let url: string | undefined = `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments?per_page=100`
  while (url) {
    const response = await request(url, { headers })
    if (!response.ok) throw new Error(`GitHub comment listing failed: ${response.status}`)
    const comments = await response.json() as Array<{ id?: number; body?: string }>
    const match = comments.find((comment) => comment.id !== undefined && comment.body === body)
    if (match?.id !== undefined) return { githubCommentId: String(match.id) }
    url = nextPage(response.headers.get('link'))
  }
  return undefined
}

function nextPage(link: string | null): string | undefined {
  return link?.split(',').map((part) => part.trim()).find((part) => part.endsWith('rel="next"'))?.match(/^<([^>]+)>/)?.[1]
}

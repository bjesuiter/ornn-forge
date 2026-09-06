import { expect, test } from 'bun:test'
import { createPrivateKey } from 'node:crypto'
import { createGitHubMessagePublisher } from './github-message-publisher'

test('GitHub message publisher creates, updates, and finds only the rendered effect', async () => {
  const calls: Array<{ url: string; method: string }> = []
  const body = 'Ornn message\n<!-- ornn-effect:github-message:job_v1_a -->'
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: 2_048,
      publicExponent: Uint8Array.of(1, 0, 1),
    },
    true,
    ['sign', 'verify'],
  )
  const pkcs8PrivateKey = pem('PRIVATE KEY', new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey)))
  const privateKey = createPrivateKey(pkcs8PrivateKey).export({ format: 'pem', type: 'pkcs1' }).toString()
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' })
    if (String(input).includes('/app/installations/159365588/access_tokens')) {
      const token = new Headers(init?.headers).get('authorization')?.slice('Bearer '.length)
      expect(token).toBeDefined()
      const [header, payload, signature] = token!.split('.')
      expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(header)))).toEqual({ alg: 'RS256', typ: 'JWT' })
      const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)))
      expect(claims).toMatchObject({ iss: '12345' })
      expect(claims.exp - claims.iat).toBe(600)
      expect(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        keys.publicKey,
        arrayBuffer(base64UrlDecode(signature)),
        new TextEncoder().encode(`${header}.${payload}`),
      )).toBeTrue()
      expect(JSON.parse(String(init?.body))).toEqual({ repository_ids: [1_296_836_371], permissions: { issues: 'write' } })
      return Response.json({ token: 'installation-token', expires_at: '2026-09-07T13:00:00.000Z' }, { status: 201 })
    }
    if (String(input).includes('/comments?')) return Response.json([{ id: 17, body }], { headers: { link: '' } })
    if (init?.method === 'POST') return Response.json({ id: 18 }, { status: 201 })
    if (init?.method === 'PATCH') return Response.json({ id: 17 })
    return Response.json({ id: 17, body })
  }) as typeof fetch
  const publisher = createGitHubMessagePublisher({
    appId: '12345',
    privateKey,
    installationId: '159365588',
    repositoryId: '1296836371',
  }, request)

  await expect(publisher.reconcile({ repository: 'bjesuiter/ornn-forge', issueNumber: 23, effectKey: 'github-message:job_v1_a', body }))
    .resolves.toEqual({ githubCommentId: '17' })
  await expect(publisher.create({ repository: 'bjesuiter/ornn-forge', issueNumber: 23, effectKey: 'github-message:job_v1_a', body })).resolves.toEqual({ githubCommentId: '18' })
  await expect(publisher.update({ repository: 'bjesuiter/ornn-forge', githubCommentId: '17', effectKey: 'github-message:job_v1_a', body })).resolves.toBeUndefined()
  expect(calls.map((call) => call.method)).toEqual(['POST', 'GET', 'POST', 'PATCH'])
})

function pem(label: string, der: Uint8Array): string {
  return `-----BEGIN ${label}-----\n${base64(der).match(/.{1,64}/g)?.join('\n')}\n-----END ${label}-----\n`
}

function base64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(value.length)
  const copy = new Uint8Array(result)
  copy.set(value)
  return result
}

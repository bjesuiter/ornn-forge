import { expect, test } from 'bun:test'
import { createPrivateKey } from 'node:crypto'
import { createGitHubRepositoryCheckout } from './github-repository-checkout'

test('resolves one exact repository revision with a short-lived read-only installation token', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2_048, publicExponent: Uint8Array.of(1, 0, 1) }, true, ['sign', 'verify'])
  const privateKey = createPrivateKey(pem('PRIVATE KEY', new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey)))).export({ format: 'pem', type: 'pkcs1' }).toString()
  const calls: Array<{ url: string; method: string; body?: string }> = []
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined })
    if (url.includes('/access_tokens')) return Response.json({ token: 'read-token', expires_at: '2026-09-07T13:00:00.000Z' }, { status: 201 })
    if (url.endsWith('/repos/bjesuiter/ornn-forge')) return Response.json({ default_branch: 'main' })
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { type: 'commit', sha: 'a'.repeat(40) } })
    throw new Error(`unexpected GitHub URL ${url}`)
  }) as typeof fetch

  const checkout = await createGitHubRepositoryCheckout({ appId: '12345', privateKey, installationId: '159365588', repositoryId: '1296836371' }, request)
    .resolve('bjesuiter/ornn-forge')

  expect(checkout).toEqual({
    repository: 'bjesuiter/ornn-forge', revision: 'a'.repeat(40), token: 'read-token', expiresAt: '2026-09-07T13:00:00.000Z',
    archiveUrl: `https://api.github.com/repos/bjesuiter/ornn-forge/tarball/${'a'.repeat(40)}`,
  })
  expect(JSON.parse(calls[0].body!)).toEqual({ repository_ids: [1_296_836_371], permissions: { contents: 'read' } })
  expect(new Headers({ authorization: 'Bearer token' }).get('authorization')).toBe('Bearer token')
})

function pem(label: string, der: Uint8Array): string {
  return `-----BEGIN ${label}-----\n${base64(der).match(/.{1,64}/g)?.join('\n')}\n-----END ${label}-----\n`
}

function base64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

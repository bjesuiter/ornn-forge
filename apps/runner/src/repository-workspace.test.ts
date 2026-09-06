import { expect, test } from 'bun:test'
import type { LeaseGrant } from '@ornn-forge/protocol'
import { createRepositoryWorkspaceImporter } from './repository-workspace'
import type { SandboxDriver, SandboxLease } from './sandbox'

const checkout: NonNullable<LeaseGrant['checkout']> = {
  revision: 'a'.repeat(40),
  archiveUrl: `https://api.github.com/repos/acme/widget/tarball/${'a'.repeat(40)}`,
  token: 'installation-token',
  expiresAt: '2026-09-07T12:15:00.000Z',
}

const lease: SandboxLease = {
  sandboxId: 'sandbox_v1_checkout', generation: 1, runnerId: 'runner_v1_checkout', providerRef: 'container-1',
  specFingerprint: 'fixture', createdAt: '2026-09-07T12:00:00.000Z', expiresAt: '2026-09-07T12:15:00.000Z',
  volumeIds: [],
}

test('the trusted Runner fetches a pinned GitHub archive and transfers only regular workspace files through SandboxDriver', async () => {
  const writes: Array<[string, string]> = []
  const commands: string[][] = []
  const importer = createRepositoryWorkspaceImporter({
    fetch: async (input, init) => {
      expect(input).toBe(checkout.archiveUrl)
      expect(init?.headers).toEqual({ authorization: 'Bearer installation-token', accept: 'application/vnd.github+json' })
      return new Response(copyBytes(await gzip(tar([
        { name: 'widget-a/', type: '5' },
        { name: 'widget-a/README.md', body: 'hello' },
        { name: 'widget-a/src/index.ts', body: 'export {}\n' },
      ]))))
    },
  })
  const driver: SandboxDriver = {
    async create() { return lease },
    async discover() { return [] },
    async inspect() { return { state: 'absent', observedAt: '' } },
    async exec(_lease, request) { commands.push(request.command); return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() } },
    async readFile() { return new Uint8Array() },
    async writeFile(_lease, path, data) { writes.push([path, new TextDecoder().decode(data)]) },
    async collectArtifacts() { return new Map() },
    async terminate() {},
    async destroy() {},
  }

  await importer(checkout, lease, driver, new AbortController().signal)

  expect(commands).toEqual([
    ['mkdir', '-p', '/workspace'],
    ['mkdir', '-p', '/workspace/src'],
  ])
  expect(writes).toEqual([
    ['/workspace/README.md', 'hello'],
    ['/workspace/src/index.ts', 'export {}\n'],
  ])
})

test('the trusted Runner rejects a GitHub archive containing a link before it reaches the sandbox', async () => {
  let sandboxTouched = false
  const importer = createRepositoryWorkspaceImporter({
    fetch: async () => new Response(copyBytes(await gzip(tar([{ name: 'widget-a/escape', type: '2', linkName: '/etc/passwd' }]))), { status: 200 }),
  })
  const driver = new Proxy({} as SandboxDriver, { get() { sandboxTouched = true; throw new Error('sandbox must not be touched') } })

  await expect(importer(checkout, lease, driver, new AbortController().signal)).rejects.toThrow('unsafe tar entry')
  expect(sandboxTouched).toBe(false)
})

function tar(entries: Array<{ name: string; body?: string; type?: string; linkName?: string }>): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    const body = new TextEncoder().encode(entry.body ?? '')
    const header = new Uint8Array(512)
    write(header, 0, 100, entry.name)
    write(header, 100, 8, '0000644\0')
    write(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`)
    write(header, 136, 12, '00000000000\0')
    header[156] = (entry.type ?? '0').charCodeAt(0)
    write(header, 157, 100, entry.linkName ?? '')
    write(header, 257, 6, 'ustar\0')
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  return join(chunks)
}

function write(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(new TextEncoder().encode(value).slice(0, length), offset)
}

function join(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

async function gzip(value: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([copyBytes(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

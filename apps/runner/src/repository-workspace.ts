import type { LeaseGrant } from '@ornn-forge/protocol'
import type { SandboxDriver, SandboxLease } from './sandbox'

const MAX_COMPRESSED_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_WORKSPACE_FILES = 10_000

type Checkout = NonNullable<LeaseGrant['checkout']>
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type WorkspaceFile = { path: string; data: Uint8Array }

export type RepositoryWorkspaceImporter = (
  checkout: Checkout,
  lease: SandboxLease,
  driver: SandboxDriver,
  signal: AbortSignal,
) => Promise<void>

export function createRepositoryWorkspaceImporter(options: { fetch?: Fetch } = {}): RepositoryWorkspaceImporter {
  const request = options.fetch ?? fetch
  return async (checkout, lease, driver, signal) => {
    const archive = await downloadArchive(checkout, request, signal)
    const files = await archiveWorkspaceFiles(archive)
    await transferWorkspace(files, lease, driver, signal)
  }
}

async function downloadArchive(checkout: Checkout, request: Fetch, signal: AbortSignal): Promise<Uint8Array> {
  assertPinnedArchiveUrl(checkout)
  const response = await request(checkout.archiveUrl, {
    headers: { authorization: `Bearer ${checkout.token}`, accept: 'application/vnd.github+json' },
    signal,
  })
  if (!response.ok) throw new Error(`repository archive download failed with HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_COMPRESSED_ARCHIVE_BYTES) throw new Error('repository archive exceeds compressed size limit')
  return readResponse(response, MAX_COMPRESSED_ARCHIVE_BYTES, signal)
}

function assertPinnedArchiveUrl(checkout: Checkout): void {
  if (!/^[0-9a-f]{40}$/i.test(checkout.revision)) throw new Error('repository checkout revision must be a full commit SHA')
  const url = new URL(checkout.archiveUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.search || !url.pathname.endsWith(`/tarball/${checkout.revision}`)) {
    throw new Error('repository checkout archive URL is not a pinned GitHub tarball')
  }
}

async function readResponse(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new Error('repository archive response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      if (signal.aborted) throw new Error('repository archive download was aborted')
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('repository archive exceeds size limit')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

async function archiveWorkspaceFiles(compressedArchive: Uint8Array): Promise<WorkspaceFile[]> {
  const decompressed = await readResponse(new Response(new Blob([copyBytes(compressedArchive)]).stream().pipeThrough(new DecompressionStream('gzip'))), MAX_UNCOMPRESSED_ARCHIVE_BYTES, new AbortController().signal)
  const entries = parseTar(decompressed)
  let root: string | undefined
  const files: WorkspaceFile[] = []
  for (const entry of entries) {
    const parts = safeArchivePath(entry.name)
    root ??= parts[0]
    if (parts[0] !== root) throw new Error('repository archive has multiple roots')
    if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '5') throw new Error(`unsafe tar entry: ${entry.type || 'unknown'}`)
    if (entry.type === '5') continue
    if (parts.length < 2) throw new Error('repository archive file is outside its root directory')
    files.push({ path: `/workspace/${parts.slice(1).join('/')}`, data: entry.data })
    if (files.length > MAX_WORKSPACE_FILES) throw new Error('repository archive has too many files')
  }
  if (!root) throw new Error('repository archive is empty')
  return files
}

async function transferWorkspace(files: WorkspaceFile[], lease: SandboxLease, driver: SandboxDriver, signal: AbortSignal): Promise<void> {
  const root = await driver.exec(lease, { command: ['mkdir', '-p', '/workspace'] }, signal)
  if (root.exitCode !== 0) throw new Error('sandbox workspace root creation failed')
  const directories = new Set(files.map((file) => file.path.slice(0, file.path.lastIndexOf('/'))).filter((directory) => directory !== '/workspace'))
  for (const directory of [...directories].sort()) {
    const result = await driver.exec(lease, { command: ['mkdir', '-p', directory] }, signal)
    if (result.exitCode !== 0) throw new Error(`sandbox workspace directory creation failed: ${directory}`)
  }
  for (const file of files) await driver.writeFile(lease, file.path, file.data)
}

type TarEntry = { name: string; type: string; data: Uint8Array }

function parseTar(value: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= value.length) {
    const header = value.slice(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) {
      if (offset + 512 <= value.length && value.slice(offset, offset + 512).every((byte) => byte === 0)) return entries
      throw new Error('repository archive has an invalid tar terminator')
    }
    const name = text(header.slice(0, 100))
    const prefix = text(header.slice(345, 500))
    const size = octal(header.slice(124, 136))
    const type = String.fromCharCode(header[156] ?? 0)
    const fullName = prefix ? `${prefix}/${name}` : name
    const paddedSize = Math.ceil(size / 512) * 512
    if (size < 0 || offset + paddedSize > value.length) throw new Error('repository archive has a truncated tar entry')
    entries.push({ name: fullName, type, data: value.slice(offset, offset + size) })
    offset += paddedSize
  }
  throw new Error('repository archive is missing its tar terminator')
}

function safeArchivePath(path: string): string[] {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const parts = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('unsafe tar entry path')
  }
  return parts
}

function octal(value: Uint8Array): number {
  const source = text(value)
  if (!/^[0-7]*$/.test(source)) throw new Error('repository archive has an invalid tar size')
  const parsed = Number.parseInt(source || '0', 8)
  if (!Number.isSafeInteger(parsed)) throw new Error('repository archive has an invalid tar size')
  return parsed
}

function text(value: Uint8Array): string {
  const length = value.findIndex((byte) => byte === 0)
  return new TextDecoder().decode(length === -1 ? value : value.slice(0, length)).trim()
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

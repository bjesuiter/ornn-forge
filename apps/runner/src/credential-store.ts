import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

type Envelope = {
  schemaVersion: 1
  algorithm: 'AES-256-GCM'
  nonce: string
  tag: string
  ciphertext: string
}

export type CredentialStore = {
  read(): Promise<unknown | undefined>
  modify(mutate: (current: unknown | undefined) => unknown | Promise<unknown>): Promise<unknown>
  remove(): Promise<void>
}

export function createCredentialStore(input: {
  runnerId: string
  providerId: string
  path: string
  key: Uint8Array
}): CredentialStore {
  if (input.key.byteLength !== 32) throw new Error('credential store key must be 32 bytes')
  const key = Buffer.from(input.key)
  const aad = Buffer.from(`1:${input.runnerId}:${input.providerId}`)
  let tail = Promise.resolve()

  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.then(action, action)
    tail = next.then(() => undefined, () => undefined)
    return next
  }

  return {
    read: () => exclusive(async () => readRecord(input.path, key, aad)),
    modify: (mutate) => exclusive(async () => {
      const next = await mutate(await readRecord(input.path, key, aad))
      await writeRecord(input.path, encrypt(next, key, aad))
      return next
    }),
    remove: () => exclusive(async () => { await unlink(input.path).catch((error: unknown) => {
      if ((error as { code?: unknown }).code !== 'ENOENT') throw error
    }) }),
  }
}

async function readRecord(path: string, key: Buffer, aad: Buffer): Promise<unknown | undefined> {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw new Error('credential record could not be read')
  }
  let envelope: Envelope
  try {
    envelope = JSON.parse(source) as Envelope
  } catch {
    throw new Error('credential record could not be authenticated')
  }
  return decrypt(envelope, key, aad)
}

function encrypt(value: unknown, key: Buffer, aad: Buffer): Envelope {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const plaintext = Buffer.from(JSON.stringify(value))
  return {
    schemaVersion: 1,
    algorithm: 'AES-256-GCM',
    nonce: nonce.toString('base64url'),
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  }
}

function decrypt(envelope: Envelope, key: Buffer, aad: Buffer): unknown {
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== 'AES-256-GCM' || typeof envelope.nonce !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('credential record could not be authenticated')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'))
    decipher.setAAD(aad)
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8'))
  } catch {
    throw new Error('credential record could not be authenticated')
  }
}

async function writeRecord(path: string, envelope: Envelope): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
    const directoryHandle = await open(directory, 'r')
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

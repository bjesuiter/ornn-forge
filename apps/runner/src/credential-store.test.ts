import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCredentialStore } from './credential-store'

test('the Runner credential store encrypts one provider record and binds it to its Runner identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ornn-credential-store-'))
  const path = join(directory, 'openai-codex.credential')
  const key = crypto.getRandomValues(new Uint8Array(32))
  try {
    const store = createCredentialStore({ runnerId: 'runner_v1_abcdefghijklmnopqrstuv', providerId: 'openai-codex', path, key })
    await store.modify(() => ({ access: 'canary-access-token', refresh: 'canary-refresh-token' }))

    expect(await store.read()).toEqual({ access: 'canary-access-token', refresh: 'canary-refresh-token' })
    expect(await readFile(path, 'utf8')).not.toContain('canary-access-token')
    const wrongRunner = createCredentialStore({ runnerId: 'runner_v1_zyxwvutsrqponmlkjihgfe', providerId: 'openai-codex', path, key })
    await expect(wrongRunner.read()).rejects.toThrow('credential record could not be authenticated')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the Runner credential store serializes refresh replacements', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ornn-credential-store-'))
  const path = join(directory, 'openai-codex.credential')
  try {
    const store = createCredentialStore({ runnerId: 'runner_v1_abcdefghijklmnopqrstuv', providerId: 'openai-codex', path, key: crypto.getRandomValues(new Uint8Array(32)) })
    await store.modify(() => ({ sequence: 0 }))
    await Promise.all([
      store.modify(async (current) => ({ sequence: Number((current as { sequence: number }).sequence) + 1 })),
      store.modify(async (current) => ({ sequence: Number((current as { sequence: number }).sequence) + 1 })),
    ])
    expect(await store.read()).toEqual({ sequence: 2 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

import { expect, test } from 'bun:test'
import { userInfo } from 'node:os'
import { createIncusCliGateway } from './incus-gateway'
import { createRepositoryWorkspaceCloner } from './repository-workspace'
import { createIncusSandboxDriver } from './sandbox.incus'
import type { SandboxLease } from './sandbox'

const image = process.env.ORNN_INCUS_TEST_IMAGE
const revision = process.env.ORNN_INCUS_TEST_REVISION
const project = process.env.ORNN_INCUS_PROJECT

test.skipIf(!image || !revision || !project)('the restricted Incus user clones a pinned repository, installs with Bun, returns a file, and removes the sandbox', async () => {
  if (userInfo().username !== 'ornn-forge-incus') throw new Error('run the Incus integration test as ornn-forge-incus')
  if (!/^[0-9a-f]{40}$/.test(revision!)) throw new Error('ORNN_INCUS_TEST_REVISION must be a full commit SHA')
  const expectedRevision = revision!

  const driver = createIncusSandboxDriver({ gateway: createIncusCliGateway({ project }) })
  const runnerId = `runner_incus_test_${crypto.randomUUID()}`
  let sandbox: SandboxLease | undefined
  const signal = new AbortController().signal
  try {
    sandbox = await driver.create({
      runnerId,
      sandboxId: `sandbox_incus_test_${crypto.randomUUID()}`,
      generation: 1,
      specFingerprint: `incus-test:${image}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      image: image!,
      command: [],
      resources: { memoryBytes: 1024 * 1024 * 1024, pidsLimit: 256 },
    }, signal)

    const run = async (command: string[], cwd?: string) => {
      const result = await driver.exec(sandbox!, { command, cwd }, signal)
      if (result.exitCode !== 0) throw new Error(`sandbox command failed: ${command[0]} (${result.exitCode}): ${new TextDecoder().decode(result.stderr).slice(0, 500)}`)
      return new TextDecoder().decode(result.stdout).trim()
    }

    await createRepositoryWorkspaceCloner('bjesuiter/ornn-forge')({
      revision: expectedRevision,
      archiveUrl: `https://api.github.com/repos/bjesuiter/ornn-forge/tarball/${expectedRevision}`,
      token: 'public-integration-test-token',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }, sandbox, driver, signal)
    expect(await run(['git', '-C', '/workspace/repo', 'rev-parse', 'HEAD'])).toBe(expectedRevision)
    expect((await driver.exec(sandbox, { command: ['test', '!', '-e', '/workspace/.ornn-credential'] }, signal)).exitCode).toBe(0)
    expect(await run(['git', '-C', '/workspace/repo', 'config', '--get', 'remote.origin.url'])).toBe('https://github.com/bjesuiter/ornn-forge.git')

    const marker = new TextEncoder().encode(`checked-out:${expectedRevision}\n`)
    await driver.writeFile(sandbox, '/workspace/result.txt', marker)
    expect(await driver.readFile(sandbox, '/workspace/result.txt')).toEqual(marker)
    expect((await driver.collectArtifacts(sandbox, ['/workspace/result.txt'])).get('/workspace/result.txt')).toEqual(marker)
  } finally {
    if (sandbox) {
      await driver.terminate(sandbox, 'completed').catch(() => undefined)
      await driver.destroy(sandbox)
      expect(await driver.discover({ runnerId })).toEqual([])
    }
  }
}, 120_000)

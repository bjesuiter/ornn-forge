import { expect, test } from 'bun:test'
import { createDockerCliGateway } from './docker-gateway'
import { createDockerSandboxDriver } from './sandbox'

const image = process.env.ORNN_DOCKER_CONTRACT_IMAGE

test('the Docker adapter isolates a Job, transfers an artifact, terminates its process tree, and verifies removal', async () => {
  if (!image) return
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 22)
  const driver = createDockerSandboxDriver({ gateway: createDockerCliGateway() })
  const lease = await driver.create({
    sandboxId: `sandbox_v1_${suffix}`,
    generation: 1,
    runnerId: 'runner_v1_contract',
    specFingerprint: `contract-v1:${image}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    image,
    command: ['sh', '-ceu', 'mkdir -p /workspace && sleep infinity'],
    resources: { memoryBytes: 128 * 1024 * 1024, pidsLimit: 64 },
  }, new AbortController().signal)
  try {
    const executed = await driver.exec(lease, { command: ['sh', '-ceu', 'test ! -S /var/run/docker.sock && test "$(ls /sys/class/net | wc -l)" -eq 1 && test -e /sys/class/net/lo && mkdir -p /workspace && printf contract-ok > /workspace/artifact.txt; sleep 300 >/dev/null 2>&1 &'] }, new AbortController().signal)
    expect(executed.exitCode).toBe(0)
    const artifacts = await driver.collectArtifacts(lease, ['/workspace/artifact.txt'])
    expect(new TextDecoder().decode(artifacts.get('/workspace/artifact.txt'))).toBe('contract-ok')
    await driver.terminate(lease, 'completed')
    expect(await driver.inspect(lease)).toMatchObject({ state: 'present', phase: 'stopped', processes: 'stopped' })
    await driver.destroy(lease)
    expect(await driver.inspect(lease)).toMatchObject({ state: 'absent' })
  } finally {
    await driver.destroy(lease).catch(() => undefined)
  }
})

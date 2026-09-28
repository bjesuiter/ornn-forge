import { createRunnerCredential, enrollRemoteRunner } from '../apps/runner/src/setup'

const controlPlaneUrl = process.env.ORNN_SMOKE_BASE_URL
const operatorSecret = process.env.ORNN_SMOKE_OPERATOR_BEARER_SECRET
if (!controlPlaneUrl || !operatorSecret) throw new Error('The smoke control-plane URL and operator secret are required')

const credentialPath = '/etc/credstore.encrypted/ornn-incus-runner.transport-credential'
await ssh(['test', '!', '-e', credentialPath])

const created = await fetch(new URL('/api/v1/runners', controlPlaneUrl), {
  method: 'POST',
  headers: { authorization: `Bearer ${operatorSecret}`, 'content-type': 'application/json' },
  body: JSON.stringify({ capacity: 1 }),
})
if (created.status !== 201) throw new Error(`Runner creation failed with HTTP ${created.status}`)

const response = await created.json() as { setupToken?: string; runner?: { id?: string } }
if (!response.setupToken || !response.runner?.id) throw new Error('Runner creation omitted its setup token or identity')
const runnerId = response.runner.id

try {
  const enrolled = await enrollRemoteRunner({
    controlPlaneUrl,
    setupToken: response.setupToken,
    createCredential: createRunnerCredential,
    hostname: () => 'homeserv1-incus',
    persistCredential: async ({ runnerId: persistedId, credential }) => {
      if (persistedId !== runnerId) throw new Error('Runner identity changed during enrollment')
      await ssh(['systemd-creds', 'encrypt', '--name=ornn-incus-runner.transport-credential', '-', credentialPath], `${credential}\n`)
    },
  })
  if (enrolled.id !== runnerId) throw new Error('Enrolled Runner identity did not match')
} catch (error) {
  throw new Error(`Runner ${runnerId} was created but not fully enrolled; its service must remain stopped`, { cause: error })
}

console.log(`Runner ${runnerId} enrolled. Pause it before starting its service.`)

async function ssh(args: string[], input?: string): Promise<void> {
  const process = Bun.spawn(['ssh', 'root.homeserv1', ...args], {
    stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe',
  })
  const stdout = new Response(process.stdout).text()
  const stderr = new Response(process.stderr).text()
  if (input !== undefined) {
    await process.stdin?.write(input)
    process.stdin?.end()
  }
  const exitCode = await process.exited
  await stdout
  await stderr
  if (exitCode !== 0) throw new Error(`Host credential operation failed with exit ${exitCode}`)
}

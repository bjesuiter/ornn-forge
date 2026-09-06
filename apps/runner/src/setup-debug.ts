import { enrollRemoteRunner } from './setup'

const controlPlaneUrl = process.env.ORNN_CONTROL_PLANE_URL
if (!controlPlaneUrl) throw new Error('ORNN_CONTROL_PLANE_URL is required')

const setupToken = await readSecret('Setup token: ')
const runner = await enrollRemoteRunner({
  controlPlaneUrl,
  setupToken,
  persistCredential: async ({ runnerId, credential }) => {
    await storeCredentialInKeychain(credential)
    await writeRunnerId(runnerId)
  },
})
process.stdout.write(`Remote Runner ${runner.id} enrolled. Its authenticated startup and control-connection sync are delivered in #49.\n`)

async function storeCredentialInKeychain(credential: string): Promise<void> {
  const process = Bun.spawn([
    'bunx', 'varlock', 'keychain', 'set', 'ORNN_RUNNER_CREDENTIAL',
    '--project', 'ornn-forge', '--profile', 'runner-debug', '--write-to', '.env.runner-debug', '--force',
  ], { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' })
  process.stdin.write(`${credential}\n`)
  process.stdin.end()
  if (await process.exited !== 0) throw new Error('Could not store the Runner credential in Varlock Keychain')
}

async function writeRunnerId(runnerId: string): Promise<void> {
  const path = '.env.runner-debug'
  const current = await Bun.file(path).text().catch(() => '')
  const line = `ORNN_RUNNER_ID=${runnerId}`
  const next = /^ORNN_RUNNER_ID=.*$/m.test(current)
    ? current.replace(/^ORNN_RUNNER_ID=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`
  await Bun.write(path, next)
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Setup requires an interactive terminal')
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const receive = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') finish(new Error('Setup cancelled'))
        else if (character === '\r' || character === '\n') finish()
        else if (character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    const finish = (error?: Error) => {
      process.stdin.off('data', receive)
      process.stdin.setRawMode(false)
      process.stdout.write('\n')
      if (error) reject(error)
      else if (!value) reject(new Error('Setup token is required'))
      else resolve(value)
    }
    process.stdin.on('data', receive)
  })
}

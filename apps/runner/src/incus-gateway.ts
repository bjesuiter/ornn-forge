import type { ExecRequest, ExecResult } from './sandbox'
import type { IncusGateway, IncusInstance } from './sandbox.incus'

type CommandResult = ExecResult
type RunCommand = (args: string[], input?: Uint8Array, signal?: AbortSignal) => Promise<CommandResult>

const maxStdoutBytes = 32 * 1024 * 1024
const maxStderrBytes = 2 * 1024 * 1024
const commandTimeoutMs = 2 * 60_000
const launchTimeoutMs = 10 * 60_000
const execTimeoutMs = 15 * 60_000

export function createIncusCliGateway(options: {
  project?: string
  run?: RunCommand
  timeouts?: { commandMs?: number; launchMs?: number; execMs?: number }
} = {}): IncusGateway {
  const project = options.project
  const run = options.run ?? runIncus
  const inProject = (args: string[]) => project ? ['--project', project, ...args] : args
  const timedRun = (args: string[], input?: Uint8Array, signal?: AbortSignal, timeoutMs = options.timeouts?.commandMs ?? commandTimeoutMs) =>
    withTimeout((timeoutSignal) => run(inProject(args), input, timeoutSignal), signal, timeoutMs)

  return {
    async list() {
      const output = await required(timedRun(['list', '--format=json']))
      const instances = JSON.parse(text(output.stdout)) as Array<{ name: string; status: string; config?: Record<string, string>; expanded_devices?: Record<string, Record<string, string>> }>
      return instances.map((instance): IncusInstance => ({
        name: instance.name, status: instance.status, config: instance.config ?? {},
        storagePool: Object.values(instance.expanded_devices ?? {}).find((device) => device.type === 'disk' && device.path === '/')?.pool,
      }))
    },

    async volumeExists(pool, name) {
      const output = await required(timedRun(['storage', 'volume', 'list', pool, '--format=json']))
      const volumes = JSON.parse(text(output.stdout)) as Array<{ name: string; type: string }>
      return volumes.some((volume) => volume.type === 'container' && volume.name === name)
    },

    async launch(input, signal) {
      const args = ['launch', input.image, input.name]
      for (const [key, value] of Object.entries(input.config)) args.push('--config', `${key}=${value}`)
      await required(timedRun(args, undefined, signal, options.timeouts?.launchMs ?? launchTimeoutMs))
    },

    async exec(name, request, signal) {
      const args = ['exec', name, '--mode=non-interactive', '--disable-stdin']
      if (request.cwd) args.push('--cwd', request.cwd)
      args.push('--', ...request.command)
      return timedRun(args, undefined, signal, request.timeoutMs ?? options.timeouts?.execMs ?? execTimeoutMs)
    },

    async readFile(name, path) {
      return (await required(timedRun(['file', 'pull', `${name}${path}`, '-']))).stdout
    },

    async writeFile(name, path, data) {
      await required(timedRun(['file', 'push', '-', `${name}${path}`, '--mode=0600'], data))
    },

    async stop(name) {
      await required(timedRun(['stop', name, '--timeout', '5', '--force']))
    },

    async delete(name) {
      await required(timedRun(['delete', name, '--force']))
    },
  }
}

async function runIncus(args: string[], input?: Uint8Array, signal?: AbortSignal): Promise<CommandResult> {
  if (signal?.aborted) throw abortedError()
  const process = Bun.spawn(['incus', ...args], { stdin: input ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const output = Promise.allSettled([
    readIncusOutput(process.stdout, maxStdoutBytes, () => process.kill()),
    readIncusOutput(process.stderr, maxStderrBytes, () => process.kill()),
  ])
  let aborted = false
  const abort = () => { aborted = true; process.kill() }
  signal?.addEventListener('abort', abort, { once: true })
  if (input) {
    process.stdin?.write(input)
    process.stdin?.end()
  }
  try {
    const exitCode = await process.exited
    const [stdout, stderr] = await output
    if (stdout.status === 'rejected') throw stdout.reason
    if (stderr.status === 'rejected') throw stderr.reason
    if (aborted) throw abortedError()
    return { exitCode, stdout: stdout.value, stderr: stderr.value }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function readIncusOutput(stream: ReadableStream<Uint8Array>, maxBytes: number, stop: () => void): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        stop()
        throw new Error(`Incus output exceeded ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function withTimeout(call: (signal: AbortSignal) => Promise<CommandResult>, signal: AbortSignal | undefined, timeoutMs: number): Promise<CommandResult> {
  if (signal?.aborted) throw abortedError()
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Incus timeout must be a positive number of milliseconds')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = abortedError()
      error.message = `Incus command timed out after ${timeoutMs} ms`
      reject(error)
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([call(controller.signal), deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function required(result: Promise<CommandResult>): Promise<CommandResult> {
  const output = await result
  if (output.exitCode !== 0) throw new Error(`Incus exited ${output.exitCode}: ${text(output.stderr).slice(0, 500)}`)
  return output
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function abortedError(): Error {
  const error = new Error('Incus command aborted')
  error.name = 'AbortError'
  return error
}

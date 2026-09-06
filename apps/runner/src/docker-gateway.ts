import type { DockerGateway, ExecResult } from './sandbox'

type CommandResult = { exitCode: number; stdout: Uint8Array; stderr: Uint8Array }
type RunCommand = (arguments_: string[], input?: Uint8Array) => Promise<CommandResult>

export function createDockerCliGateway(run: RunCommand = runDocker): DockerGateway {
  const gateway: DockerGateway = {
    async list(labels) {
      const arguments_ = ['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}']
      for (const label of labels) arguments_.push('--filter', `label=${label}`)
      const result = await required(run(arguments_))
      return text(result.stdout).trim().split('\n').filter(Boolean).map((line) => {
        const value = JSON.parse(line) as { ID: string; Labels: string; State: string }
        return { id: value.ID, labels: parseLabels(value.Labels), state: listState(value.State), volumes: [] }
      })
    },
    async create(input) {
      const arguments_ = ['container', 'create', '--name', input.name, '--network', input.network, '--restart', input.restart, '--init', '--memory', String(input.resources.memoryBytes), '--pids-limit', String(input.resources.pidsLimit)]
      for (const [key, value] of Object.entries(input.labels)) arguments_.push('--label', `${key}=${value}`)
      arguments_.push(input.image, ...input.command)
      const created = await required(run(arguments_))
      const id = text(created.stdout).trim()
      await required(run(['container', 'start', id]))
      const inspected = await gateway.inspect(id)
      if (!inspected) throw new Error('Docker did not retain the created container')
      return { id, volumes: inspected.volumes }
    },
    async inspect(id) {
      const result = await run(['container', 'inspect', '--format', '{{json .}}', id])
      if (result.exitCode !== 0) {
        if (/No such (object|container)/i.test(text(result.stderr))) return undefined
        throw commandFailure(result)
      }
      const value = JSON.parse(text(result.stdout)) as {
        Id: string
        Config?: { Labels?: Record<string, string> }
        State?: { Status?: string; Running?: boolean }
        Mounts?: Array<{ Type?: string; Name?: string }>
      }
      return {
        id: value.Id,
        labels: value.Config?.Labels ?? {},
        state: inspectState(value.State?.Status),
        processes: value.State?.Running ? 'running' : 'stopped',
        volumes: (value.Mounts ?? []).filter((mount) => mount.Type === 'volume' && mount.Name).map((mount) => mount.Name as string),
      }
    },
    async exec(id, command, options = {}) {
      const arguments_ = ['container', 'exec']
      if (options.cwd) arguments_.push('--workdir', options.cwd)
      arguments_.push(id, ...command)
      return runWithAbort(run, arguments_, options.signal)
    },
    async copyTo(id, path, data) {
      await required(run(['container', 'exec', '--interactive', id, 'sh', '-ceu', 'cat > "$1"', 'sh', path], data))
    },
    async copyFrom(id, path) {
      const result = await required(run(['container', 'exec', id, 'cat', path]))
      return result.stdout
    },
    async stop(id, timeoutSeconds) {
      const result = await run(['container', 'stop', '--time', String(timeoutSeconds), id])
      if (result.exitCode !== 0 && !text(result.stderr).includes('No such container')) throw commandFailure(result)
    },
    async remove(id, volumes) {
      const arguments_ = ['container', 'rm', '--force']
      if (volumes) arguments_.push('--volumes')
      arguments_.push(id)
      const result = await run(arguments_)
      if (result.exitCode !== 0 && !text(result.stderr).includes('No such container')) throw commandFailure(result)
    },
    async inspectVolume(id) {
      const result = await run(['volume', 'inspect', id])
      if (result.exitCode !== 0) {
        if (text(result.stderr).includes('No such volume')) return undefined
        throw commandFailure(result)
      }
      return true
    },
  }
  return gateway
}

async function runDocker(arguments_: string[], input?: Uint8Array): Promise<CommandResult> {
  const process = Bun.spawn(['docker', ...arguments_], { stdin: input ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' })
  if (input) {
    process.stdin?.write(input)
    process.stdin?.end()
  }
  return { exitCode: await process.exited, stdout: new Uint8Array(await new Response(process.stdout).arrayBuffer()), stderr: new Uint8Array(await new Response(process.stderr).arrayBuffer()) }
}

async function runWithAbort(run: RunCommand, arguments_: string[], signal: AbortSignal | undefined): Promise<ExecResult> {
  if (signal?.aborted) throw new Error('Docker exec aborted before start')
  return run(arguments_)
}

async function required(result: Promise<CommandResult>): Promise<CommandResult> {
  const resolved = await result
  if (resolved.exitCode !== 0) throw commandFailure(resolved)
  return resolved
}

function commandFailure(result: CommandResult): Error {
  return new Error(`Docker exited ${result.exitCode}: ${text(result.stderr).slice(0, 500)}`)
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function listState(value: string): 'running' | 'created' | 'exited' | 'removing' | 'dead' {
  return value === 'running' ? 'running' : value === 'created' ? 'created' : value === 'removing' ? 'removing' : value === 'dead' ? 'dead' : 'exited'
}

function inspectState(value: string | undefined): 'running' | 'created' | 'exited' | 'removing' | 'dead' {
  return listState(value ?? 'exited')
}

function parseLabels(value: string): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(value.split(',').map((part) => {
    const separator = part.indexOf('=')
    return separator === -1 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)]
  }))
}

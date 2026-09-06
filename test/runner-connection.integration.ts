import { expect, test } from 'vitest'
import { env, exports } from 'cloudflare:workers'
import { evictDurableObject } from 'cloudflare:test'
import { envelope } from '@ornn-forge/protocol'

const runnerId = 'runner_v1_abcdefghijklmnopqrstuv'
const profile = {
  release: 'test', platform: 'linux', architecture: 'arm64', runtime: 'workerd', executor: 'fixture', capacity: 1,
  logicalCpuCount: 1, memoryLimitBytes: 134_217_728,
}

test('a real RunnerConnection Durable Object takes over and resumes synchronization after hibernation', async () => {
  await createControlStateSchema()
  await env.ORNN_D1.prepare(`INSERT INTO remote_runners (
    runner_id, kind, desired_capacity, enrollment_state, readiness_state, created_at
  ) VALUES (?, 'remote', 1, 'enrolled', 'not_ready', ?)`).bind(runnerId, new Date().toISOString()).run()
  await env.ORNN_D1.prepare('INSERT INTO runner_credentials (runner_id, credential_digest, created_at) VALUES (?, ?, ?)')
    .bind(runnerId, 'test-digest', new Date().toISOString()).run()

  const stub = env.RUNNER_CONNECTION.getByName(runnerId)
  const first = await connect(exports.default)
  const synchronized = nextMessage(first)
  first.send(JSON.stringify(envelope('runner.synchronize', {
    runnerId, instanceId: 'instance_v1_abcdefghijklmnopqrstuv', profile, activeLeases: [], commandJournal: [],
  })))
  expect((await synchronized).type).toBe('runner.synchronized')

  await evictDurableObject(stub)
  const heartbeated = nextMessage(first)
  first.send(JSON.stringify(envelope('runner.heartbeat', { runnerId, instanceId: 'instance_v1_abcdefghijklmnopqrstuv' })))
  expect((await heartbeated).type).toBe('runner.heartbeat.accepted')

  const closed = new Promise<CloseEvent>((resolve) => first.addEventListener('close', (event) => resolve(event)))
  const second = await connect(exports.default)
  expect((await closed).code).toBe(4001)
  second.close(1000, 'test complete')
})

async function connect(worker: { fetch(request: Request): Promise<Response> }): Promise<WebSocket> {
  const response = await worker.fetch(new Request('https://runner.test/connect', {
    headers: { upgrade: 'websocket', 'x-ornn-runner-id': runnerId },
  }))
  const socket = response.webSocket
  if (!socket) throw new Error('RunnerConnection did not upgrade the WebSocket')
  socket.accept()
  return socket
}

async function nextMessage(socket: WebSocket): Promise<{ type: string }> {
  return new Promise((resolve) => socket.addEventListener('message', (event) => resolve(JSON.parse(String(event.data)))))
}

async function createControlStateSchema(): Promise<void> {
  await env.ORNN_D1.batch([
    env.ORNN_D1.prepare('CREATE TABLE remote_runners (runner_id TEXT PRIMARY KEY, kind TEXT, desired_capacity INTEGER, enrollment_state TEXT, readiness_state TEXT, created_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_credentials (runner_id TEXT PRIMARY KEY, credential_digest TEXT, created_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_profiles (runner_id TEXT PRIMARY KEY, release TEXT, platform TEXT, architecture TEXT, runtime TEXT, executor TEXT, capacity INTEGER, logical_cpu_count INTEGER, memory_limit_bytes INTEGER, updated_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_presence (runner_id TEXT PRIMARY KEY, last_seen_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_error_states (runner_id TEXT PRIMARY KEY, code TEXT, occurred_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_pauses (runner_id TEXT PRIMARY KEY, paused INTEGER, updated_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_commands (command_id TEXT PRIMARY KEY, runner_id TEXT, command_type TEXT, payload_json TEXT, created_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_command_journal (runner_id TEXT, command_id TEXT, state TEXT, reported_at TEXT, PRIMARY KEY (runner_id, command_id))'),
    env.ORNN_D1.prepare('CREATE TABLE jobs (job_id TEXT PRIMARY KEY, state TEXT, cleanup_status TEXT, created_at TEXT, invocation_id TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE runner_leases (job_id TEXT PRIMARY KEY, runner_id TEXT, generation INTEGER, token_digest TEXT, expires_at TEXT, last_heartbeat_at TEXT, created_at TEXT)'),
    env.ORNN_D1.prepare('CREATE TABLE invocations (invocation_id TEXT PRIMARY KEY, github_issue_number INTEGER, github_issue_title TEXT, github_issue_body TEXT, github_comment_body TEXT)'),
  ])
}

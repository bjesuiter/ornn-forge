import { DurableObject } from 'cloudflare:workers'
import { envelope, isAnalysisArtifact, isRunnerCommandJournalEntry, isRunnerFault, isRunnerSynchronization, parseRunnerEnvelope } from '@ornn-forge/protocol'
import { createD1InvocationStore, publishJobMessage, type InvocationStore } from './control-plane'
import { createGitHubMessagePublisher } from './github-message-publisher'
import { createGitHubRepositoryCheckout } from './github-repository-checkout'

type Attachment = { runnerId: string; instanceId?: string; synchronized: boolean }

export class RunnerConnection extends DurableObject<Cloudflare.Env> {
  async fetch(request: Request): Promise<Response> {
    const runnerId = request.headers.get('x-ornn-runner-id')
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    if (!runnerId) return new Response('Runner identity required', { status: 401 })
    const pair = new WebSocketPair()
    for (const existing of this.ctx.getWebSockets()) existing.close(4001, 'Replaced by newer Runner connection')
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ runnerId, synchronized: false } satisfies Attachment)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = attachment(socket)
    if (!state || typeof message !== 'string') return close(socket, 1008, 'Invalid control message')
    let payload: unknown
    try { payload = JSON.parse(message) } catch { return close(socket, 1008, 'Invalid control message') }
    const parsed = parseRunnerEnvelope(payload)
    if (!parsed.ok) {
      if (parsed.code === 'unsupported_major') socket.send(JSON.stringify(envelope('protocol.unsupported', { supportedMajor: 1 })))
      return close(socket, 1002, 'Unsupported Runner protocol')
    }
    const store = createD1InvocationStore(this.env.ORNN_D1)
    if (parsed.value.type === 'runner.synchronize' && isRunnerSynchronization(parsed.value.payload) && parsed.value.payload.runnerId === state.runnerId) {
      const synchronized = await store.synchronizeRunner?.(parsed.value.payload)
      if (!synchronized) return close(socket, 1008, 'Runner authorization failed')
      await store.recordRunnerSuccess?.(state.runnerId)
      socket.serializeAttachment({ runnerId: state.runnerId, instanceId: parsed.value.payload.instanceId, synchronized: true } satisfies Attachment)
      socket.send(JSON.stringify(envelope('runner.synchronized', synchronized)))
      await offerAvailableLeases(socket, store, state.runnerId, this.env)
      return
    }
    if (!state.synchronized || parsed.value.payload.runnerId !== state.runnerId) return close(socket, 1008, 'Synchronization required')
    if (parsed.value.type === 'runner.heartbeat' && parsed.value.payload.instanceId === state.instanceId) {
      await store.recordRunnerHeartbeat?.(state.runnerId)
      await store.recordRunnerSuccess?.(state.runnerId)
      socket.send(JSON.stringify(envelope('runner.heartbeat.accepted', {})))
      await offerAvailableLeases(socket, store, state.runnerId, this.env)
      return
    }
    if (parsed.value.type === 'lease.heartbeat') {
      const lease = leaseInput(parsed.value.payload, state.runnerId)
      const accepted = lease && await store.heartbeatLease?.(lease)
      if (accepted) await store.recordRunnerSuccess?.(state.runnerId)
      socket.send(JSON.stringify(envelope(accepted ? 'lease.accepted' : 'lease.rejected', accepted ? { jobId: String(parsed.value.payload.jobId) } : { code: 'lease_invalid' })))
      return
    }
    if (parsed.value.type === 'lease.accept') {
      const lease = leaseInput(parsed.value.payload, state.runnerId)
      const accepted = lease && await store.heartbeatLease?.(lease)
      if (accepted) await store.recordRunnerSuccess?.(state.runnerId)
      socket.send(JSON.stringify(envelope(accepted ? 'lease.accepted' : 'lease.rejected', accepted ? { jobId: lease.jobId } : { code: 'lease_invalid' })))
      return
    }
    if (parsed.value.type === 'lease.result') {
      const lease = leaseInput(parsed.value.payload, state.runnerId)
      const completed = lease && isAnalysisArtifact(parsed.value.payload.artifact)
        ? await store.completeLease?.({ ...lease, artifact: parsed.value.payload.artifact, cleanupStatus: parsed.value.payload.cleanupStatus === 'failed' ? 'failed' : 'verified' })
        : undefined
      if (completed === 'accepted') await store.recordRunnerSuccess?.(state.runnerId)
      if (completed === 'accepted' && lease) await publishJobMessage(store, createGitHubMessagePublisher({
        appId: this.env.GITHUB_APP_ID,
        privateKey: this.env.GITHUB_APP_PRIVATE_KEY,
        installationId: this.env.GITHUB_APP_INSTALLATION_ID,
        repositoryId: this.env.GITHUB_REPOSITORY_ID,
      }), lease.jobId)
      socket.send(JSON.stringify(envelope(completed === 'accepted' && lease ? 'lease.accepted' : 'lease.rejected', completed === 'accepted' && lease ? { jobId: lease.jobId } : {
        code: isAnalysisArtifact(parsed.value.payload.artifact) ? 'lease_invalid' : 'invalid_artifact',
      })))
      if (completed === 'accepted') await offerAvailableLeases(socket, store, state.runnerId, this.env)
      return
    }
    if (parsed.value.type === 'runner.report' && isRunnerFault(parsed.value.payload.fault)) {
      await store.recordRunnerFault?.(state.runnerId, parsed.value.payload.fault)
      socket.send(JSON.stringify(envelope('runner.accepted', {})))
      return
    }
    if (parsed.value.type === 'runner.command.acknowledged' && isRunnerCommandJournalEntry(parsed.value.payload)) {
      const accepted = await store.acknowledgeRunnerCommand?.(state.runnerId, parsed.value.payload)
      socket.send(JSON.stringify(envelope(accepted ? 'runner.accepted' : 'lease.rejected', accepted ? {} : { code: 'runner_unauthorized' })))
      return
    }
    close(socket, 1008, 'Unsupported control message')
  }
}

function attachment(socket: WebSocket): Attachment | undefined {
  const value = socket.deserializeAttachment()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return typeof record.runnerId === 'string' && typeof record.synchronized === 'boolean' ? record as Attachment : undefined
}

function leaseInput(value: Record<string, unknown>, runnerId: string) {
  if (value.runnerId !== runnerId || typeof value.jobId !== 'string' || typeof value.leaseToken !== 'string') return undefined
  return { runnerId, jobId: value.jobId, leaseToken: value.leaseToken }
}

async function offerAvailableLeases(socket: WebSocket, store: InvocationStore, runnerId: string, env: Cloudflare.Env): Promise<void> {
  for (let remaining = 32; remaining > 0; remaining -= 1) {
    const lease = await store.pollRunner?.(runnerId)
    if (!lease) return
    try {
      const checkout = await createGitHubRepositoryCheckout({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
        installationId: env.GITHUB_APP_INSTALLATION_ID,
        repositoryId: env.GITHUB_REPOSITORY_ID,
      }).resolve(lease.repository.fullName)
      socket.send(JSON.stringify(envelope('runner.lease', { ...lease, checkout })))
    } catch {
      await store.recordRunnerFault?.(runnerId, { code: 'runner.repository_checkout_unavailable' })
      socket.send(JSON.stringify(envelope('runner.lease', lease)))
    }
  }
}

function close(socket: WebSocket, code: number, reason: string): void { socket.close(code, reason) }

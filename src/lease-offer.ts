import { envelope } from '@ornn-forge/protocol'
import type { InvocationStore } from './control-plane'
import { createGitHubRepositoryCheckout, type RepositoryCheckout } from './github-repository-checkout'

export async function offerNextLease(
  socket: Pick<WebSocket, 'send'>,
  store: Pick<InvocationStore, 'pollRunner' | 'recordLeaseCheckout' | 'releaseLease' | 'recordRunnerFault'>,
  runnerId: string,
  env: Cloudflare.Env,
  resolveCheckout: (repository: string) => Promise<RepositoryCheckout> = createGitHubRepositoryCheckout({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    repositoryId: env.GITHUB_REPOSITORY_ID,
  }).resolve,
): Promise<void> {
  const lease = await store.pollRunner?.(runnerId)
  if (!lease) return
  try {
    const checkout = await resolveCheckout(lease.repository.fullName)
    const recorded = await store.recordLeaseCheckout?.({
      runnerId, jobId: lease.jobId, leaseToken: lease.leaseToken,
      repository: checkout.repository, revision: checkout.revision,
    })
    if (!recorded) throw new Error('Lease checkout could not be recorded')
    socket.send(JSON.stringify(envelope('runner.lease', { ...lease, checkout })))
  } catch {
    await store.releaseLease?.({ runnerId, jobId: lease.jobId, leaseToken: lease.leaseToken })
    await store.recordRunnerFault?.(runnerId, { code: 'runner.repository_checkout_unavailable' })
  }
}

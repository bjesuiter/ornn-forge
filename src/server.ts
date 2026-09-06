import handler from '@tanstack/react-start/server-entry'
import { cleanupRejectedDashboardLogins } from './dashboard-access'
import { refreshOpenAiSubscriptionUsage } from './openai-subscription-usage'

export { RunnerConnection } from './runner-connection'

export default {
  fetch: handler.fetch,
  async scheduled(_controller: ScheduledController, environment: Cloudflare.Env) {
    await cleanupRejectedDashboardLogins(environment.ORNN_D1)
    await refreshOpenAiSubscriptionUsage({
      database: environment.ORNN_D1,
      encryptionKey: environment.ORNN_D1_SECRETS_ENCRYPTION_KEY,
    })
  },
}

import handler from '@tanstack/react-start/server-entry'
import { cleanupRejectedDashboardLogins } from './dashboard-access'
import { createCloudflareControlPlane } from './control-plane.worker'
import { refreshOpenAiSubscriptionUsage } from './openai-subscription-usage'

export { RunnerConnection } from './runner-connection'

export default {
  fetch(request: Request, environment: Cloudflare.Env) {
    if (new URL(request.url).pathname.startsWith('/api/v1/')) return createCloudflareControlPlane(environment).fetch(request)
    return handler.fetch(request)
  },
  async scheduled(controller: ScheduledController, environment: Cloudflare.Env) {
    switch (controller.cron) {
      case '0 0 * * *':
        await cleanupRejectedDashboardLogins(environment.ORNN_D1)
        return
      case '* * * * *':
        await refreshOpenAiSubscriptionUsage({
          database: environment.ORNN_D1,
          encryptionKey: environment.ORNN_D1_SECRETS_ENCRYPTION_KEY,
        })
        return
      default:
        throw new Error(`Unknown Cron schedule: ${controller.cron}`)
    }
  },
}

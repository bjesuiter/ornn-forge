import handler from '@tanstack/react-start/server-entry'
import { cleanupRejectedDashboardLogins } from './dashboard-access'

export default {
  fetch: handler.fetch,
  async scheduled(_controller: ScheduledController, environment: Cloudflare.Env) {
    await cleanupRejectedDashboardLogins(environment.ORNN_D1)
  },
}

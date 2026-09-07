import { queryOptions } from '@tanstack/react-query'
import {
  getDashboardOpenAiUsage,
  getDashboardRunners,
  getDashboardWebhooks,
} from './dashboard.functions'
import { dashboardRefetchOptions } from './dashboard-refresh'

export const dashboardSnapshotQueryOptions = () => queryOptions({
  queryKey: ['dashboard', 'snapshot'] as const,
  queryFn: async () => {
    const [openAiUsage, runners, webhooks] = await Promise.all([
      getDashboardOpenAiUsage(),
      getDashboardRunners(),
      getDashboardWebhooks(),
    ])
    return { openAiUsage, runners, webhooks }
  },
  ...dashboardRefetchOptions,
})

export const dashboardRunnersQueryOptions = () => queryOptions({
  queryKey: ['dashboard', 'runners'] as const,
  queryFn: getDashboardRunners,
  ...dashboardRefetchOptions,
})

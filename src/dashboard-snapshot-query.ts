import { queryOptions } from '@tanstack/react-query'
import { dashboardRefetchOptions } from './dashboard-refresh'

export function createDashboardSnapshotQueryOptions<Snapshot>(loadSnapshot: () => Promise<Snapshot>) {
  return queryOptions({
    queryKey: ['dashboard', 'snapshot'] as const,
    queryFn: loadSnapshot,
    ...dashboardRefetchOptions,
  })
}

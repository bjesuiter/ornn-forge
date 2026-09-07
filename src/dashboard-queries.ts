import { queryOptions } from '@tanstack/react-query'
import {
  getDashboardRunners,
  getDashboardSnapshot,
} from './dashboard.functions'
import { dashboardRefetchOptions } from './dashboard-refresh'
import { createDashboardSnapshotQueryOptions } from './dashboard-snapshot-query'

export const dashboardSnapshotQueryOptions = () => createDashboardSnapshotQueryOptions(getDashboardSnapshot)

export const dashboardRunnersQueryOptions = () => queryOptions({
  queryKey: ['dashboard', 'runners'] as const,
  queryFn: getDashboardRunners,
  ...dashboardRefetchOptions,
})

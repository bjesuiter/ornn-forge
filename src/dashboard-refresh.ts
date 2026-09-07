export const dashboardRefreshIntervalMs = 5_000

export const dashboardRefetchOptions = {
  refetchInterval: dashboardRefreshIntervalMs,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const

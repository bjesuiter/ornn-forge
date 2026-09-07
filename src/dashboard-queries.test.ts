import { expect, test } from 'bun:test'
import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query'
import {
  dashboardRefreshIntervalMs,
  dashboardRefetchOptions,
} from './dashboard-refresh'
import { createDashboardSnapshotQueryOptions } from './dashboard-snapshot-query'

test('dashboard refreshes in the foreground and on return to the tab', async () => {
  expect(dashboardRefetchOptions.refetchInterval).toBe(dashboardRefreshIntervalMs)
  expect(dashboardRefetchOptions.refetchIntervalInBackground).toBe(false)
  expect(dashboardRefetchOptions.refetchOnWindowFocus).toBe(true)

  const client = new QueryClient()
  const wasFocused = focusManager.isFocused()
  let requests = 0
  client.mount()
  const observer = new QueryObserver(client, {
    queryKey: ['dashboard', 'refresh-test'],
    queryFn: async () => ++requests,
    ...dashboardRefetchOptions,
  })
  const unsubscribe = observer.subscribe(() => undefined)

  try {
    await nextTask()
    expect(requests).toBe(1)

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await nextTask()

    expect(requests).toBe(2)
  } finally {
    unsubscribe()
    client.unmount()
    focusManager.setFocused(wasFocused)
  }
})

test('dashboard snapshot refresh uses one server request', async () => {
  const client = new QueryClient()
  let requests = 0
  const observer = new QueryObserver(client, createDashboardSnapshotQueryOptions(async () => {
    requests += 1
    return { requests }
  }))
  const unsubscribe = observer.subscribe(() => undefined)

  try {
    await nextTask()
    expect(requests).toBe(1)
  } finally {
    unsubscribe()
  }
})

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

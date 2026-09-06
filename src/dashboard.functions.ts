import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { auth } from './auth.server'
import { createD1InvocationStore } from './control-plane'
import { listDashboardRunners } from './dashboard-runners'
import { listDashboardWebhooks } from './dashboard-webhooks'
import {
  completeOpenAiSubscriptionAuthorization,
  disconnectOpenAiSubscription,
  getCachedOpenAiSubscriptionUsage,
  startOpenAiSubscriptionAuthorization,
} from './openai-subscription-usage'

export const getDashboardRunners = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  return listDashboardRunners(env.ORNN_D1)
})

export const getDashboardWebhooks = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  return listDashboardWebhooks(env.ORNN_D1)
})

export const getDashboardOpenAiUsage = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  return getCachedOpenAiSubscriptionUsage(env.ORNN_D1)
})

export const startDashboardOpenAiSubscriptionAuthorization = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  return startOpenAiSubscriptionAuthorization({ database: env.ORNN_D1, encryptionKey: env.ORNN_D1_SECRETS_ENCRYPTION_KEY })
})

export const completeDashboardOpenAiSubscriptionAuthorization = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  return completeOpenAiSubscriptionAuthorization({ database: env.ORNN_D1, encryptionKey: env.ORNN_D1_SECRETS_ENCRYPTION_KEY })
})

export const disconnectDashboardOpenAiSubscription = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
  await disconnectOpenAiSubscription(env.ORNN_D1)
})

export const setDashboardRunnerPaused = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (!isPauseRequest(data)) throw new Error('Invalid Runner pause request')
    return data
  })
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new Error('Dashboard session required')
    const updated = await createD1InvocationStore(env.ORNN_D1).setRunnerPaused(data.runnerId, data.paused)
    if (!updated) throw new Error('Runner not found')
  })

function isPauseRequest(value: unknown): value is { runnerId: string; paused: boolean } {
  return typeof value === 'object' && value !== null
    && 'runnerId' in value && typeof value.runnerId === 'string' && value.runnerId.length > 0 && value.runnerId.length <= 200
    && 'paused' in value && typeof value.paused === 'boolean'
}

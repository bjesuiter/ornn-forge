import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { auth } from './auth.server'
import { createD1InvocationStore, createRemoteRunnerSetup, isRunnerLabel, type RemoteRunner } from './control-plane'
import { listDashboardRunners, type DashboardRunner } from './dashboard-runners'
import { listDashboardWebhooks, type DashboardWebhook } from './dashboard-webhooks'
import {
  completeOpenAiSubscriptionAuthorization,
  disconnectOpenAiSubscription,
  getCachedOpenAiSubscriptionUsage,
  startOpenAiSubscriptionAuthorization,
  type OpenAiSubscriptionUsage,
} from './openai-subscription-usage'

export type DashboardSnapshot = {
  openAiUsage: OpenAiSubscriptionUsage
  runners: DashboardRunner[]
  webhooks: DashboardWebhook[]
}

export const getDashboardSnapshot = createServerFn({ method: 'GET' }).handler(async (): Promise<DashboardSnapshot> => {
  setResponseHeader('Cache-Control', 'no-store')
  await requireDashboardSession()
  const [openAiUsage, runners, webhooks] = await Promise.all([
    getCachedOpenAiSubscriptionUsage(env.ORNN_D1),
    listDashboardRunners(env.ORNN_D1),
    listDashboardWebhooks(env.ORNN_D1),
  ])
  return { openAiUsage, runners, webhooks }
})

export const getDashboardRunners = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  await requireDashboardSession()
  return listDashboardRunners(env.ORNN_D1)
})

export const getDashboardWebhooks = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  await requireDashboardSession()
  return listDashboardWebhooks(env.ORNN_D1)
})

export const getDashboardOpenAiUsage = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  await requireDashboardSession()
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

export const setDashboardRunnerLabel = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (!isLabelRequest(data)) throw new Error('Invalid Runner label request')
    return data
  })
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new Error('Dashboard session required')
    const updated = await createD1InvocationStore(env.ORNN_D1).setRunnerLabel(data.runnerId, data.label)
    if (!updated) throw new Error('Runner not found')
  })

export const createDashboardRunner = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    if (!isRunnerCreationRequest(data)) throw new Error('Invalid Runner creation request')
    return data
  })
  .handler(async ({ data }): Promise<{ runner: RemoteRunner; setupToken: string }> => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new Error('Dashboard session required')
    return createRemoteRunnerSetup({ store: createD1InvocationStore(env.ORNN_D1) }, data.capacity)
  })

async function requireDashboardSession() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Dashboard session required')
}

function isPauseRequest(value: unknown): value is { runnerId: string; paused: boolean } {
  return typeof value === 'object' && value !== null
    && 'runnerId' in value && typeof value.runnerId === 'string' && value.runnerId.length > 0 && value.runnerId.length <= 200
    && 'paused' in value && typeof value.paused === 'boolean'
}

function isLabelRequest(value: unknown): value is { runnerId: string; label: string } {
  return typeof value === 'object' && value !== null
    && 'runnerId' in value && typeof value.runnerId === 'string' && value.runnerId.length > 0 && value.runnerId.length <= 200
    && 'label' in value && isRunnerLabel(value.label)
}

function isRunnerCreationRequest(value: unknown): value is { capacity: number } {
  return typeof value === 'object' && value !== null
    && 'capacity' in value && typeof value.capacity === 'number' && Number.isInteger(value.capacity)
    && value.capacity >= 1 && value.capacity <= 32
}

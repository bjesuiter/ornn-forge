import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { authClient } from '../auth-client'
import { Dashboard } from '../components/dashboard-placeholder'
import {
  completeDashboardOpenAiSubscriptionAuthorization,
  disconnectDashboardOpenAiSubscription,
  getDashboardOpenAiUsage,
  getDashboardRunners,
  getDashboardWebhooks,
  setDashboardRunnerPaused,
  startDashboardOpenAiSubscriptionAuthorization,
} from '../dashboard.functions'

export const Route = createFileRoute('/dashboard/')({
  loader: async () => {
    const [openAiUsage, runners, webhooks] = await Promise.all([getDashboardOpenAiUsage(), getDashboardRunners(), getDashboardWebhooks()])
    return { openAiUsage, runners, webhooks }
  },
  component: DashboardRoute,
})

function DashboardRoute() {
  const navigate = useNavigate()
  const router = useRouter()
  const { openAiUsage, runners, webhooks } = Route.useLoaderData()

  useEffect(() => {
    const refresh = window.setInterval(() => void router.invalidate(), 5_000)
    return () => window.clearInterval(refresh)
  }, [router])

  async function signOut() {
    const result = await authClient.signOut()
    if (result.error) throw new Error('Sign out failed')
    await navigate({
      to: '/login',
      search: { error: undefined, returnTo: '/dashboard' },
    })
  }

  async function setRunnerPaused(runnerId: string, paused: boolean) {
    await setDashboardRunnerPaused({ data: { runnerId, paused } })
    await router.invalidate()
  }

  async function startOpenAiSubscriptionAuthorization() {
    await startDashboardOpenAiSubscriptionAuthorization()
    await router.invalidate()
  }

  async function completeOpenAiSubscriptionAuthorization() {
    await completeDashboardOpenAiSubscriptionAuthorization()
    await router.invalidate()
  }

  async function disconnectOpenAiSubscription() {
    await disconnectDashboardOpenAiSubscription()
    await router.invalidate()
  }

  return <Dashboard
    openAiUsage={openAiUsage}
    runners={runners}
    webhooks={webhooks}
    onSignOut={signOut}
    onSetRunnerPaused={setRunnerPaused}
    onStartOpenAiSubscriptionAuthorization={startOpenAiSubscriptionAuthorization}
    onCompleteOpenAiSubscriptionAuthorization={completeOpenAiSubscriptionAuthorization}
    onDisconnectOpenAiSubscription={disconnectOpenAiSubscription}
  />
}

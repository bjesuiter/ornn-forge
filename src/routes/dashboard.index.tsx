import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { authClient } from '../auth-client'
import { Dashboard } from '../components/dashboard-placeholder'
import { getDashboardRunners, getDashboardWebhooks, setDashboardRunnerPaused } from '../dashboard.functions'

export const Route = createFileRoute('/dashboard/')({
  loader: async () => {
    const [runners, webhooks] = await Promise.all([getDashboardRunners(), getDashboardWebhooks()])
    return { runners, webhooks }
  },
  component: DashboardRoute,
})

function DashboardRoute() {
  const navigate = useNavigate()
  const router = useRouter()
  const { runners, webhooks } = Route.useLoaderData()

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

  return <Dashboard runners={runners} webhooks={webhooks} onSignOut={signOut} onSetRunnerPaused={setRunnerPaused} />
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { Dashboard } from '../components/dashboard-placeholder'
import {
  completeDashboardOpenAiSubscriptionAuthorization,
  createDashboardRunner,
  disconnectDashboardOpenAiSubscription,
  getDashboardSnapshot,
  setDashboardRunnerLabel,
  setDashboardRunnerPaused,
  startDashboardOpenAiSubscriptionAuthorization,
} from '../dashboard.functions'
import { dashboardSnapshotQueryOptions } from '../dashboard-queries'

export const Route = createFileRoute('/dashboard/')({
  loader: () => getDashboardSnapshot(),
  component: DashboardRoute,
})

function DashboardRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const initialDashboard = Route.useLoaderData()
  const { data: { openAiUsage, runners, webhooks } } = useQuery({
    ...dashboardSnapshotQueryOptions(),
    initialData: initialDashboard,
  })

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
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function setRunnerLabel(runnerId: string, label: string) {
    await setDashboardRunnerLabel({ data: { runnerId, label } })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function createRunner(capacity: number) {
    const created = await createDashboardRunner({ data: { capacity } })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    return created
  }

  async function startOpenAiSubscriptionAuthorization() {
    await startDashboardOpenAiSubscriptionAuthorization()
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function completeOpenAiSubscriptionAuthorization() {
    await completeDashboardOpenAiSubscriptionAuthorization()
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function disconnectOpenAiSubscription() {
    await disconnectDashboardOpenAiSubscription()
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  return <Dashboard
    openAiUsage={openAiUsage}
    runners={runners}
    webhooks={webhooks}
    onSignOut={signOut}
    onSetRunnerPaused={setRunnerPaused}
    onSetRunnerLabel={setRunnerLabel}
    onCreateRunner={createRunner}
    onStartOpenAiSubscriptionAuthorization={startOpenAiSubscriptionAuthorization}
    onCompleteOpenAiSubscriptionAuthorization={completeOpenAiSubscriptionAuthorization}
    onDisconnectOpenAiSubscription={disconnectOpenAiSubscription}
  />
}

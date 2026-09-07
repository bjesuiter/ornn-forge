import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { DashboardTopology } from '../components/dashboard-topology'
import { getDashboardRunners } from '../dashboard.functions'
import { dashboardRunnersQueryOptions } from '../dashboard-queries'

export const Route = createFileRoute('/dashboard/topology')({
  loader: () => getDashboardRunners(),
  component: DashboardTopologyRoute,
})

function DashboardTopologyRoute() {
  const navigate = useNavigate()
  const initialRunners = Route.useLoaderData()
  const { data: runners } = useQuery({
    ...dashboardRunnersQueryOptions(),
    initialData: initialRunners,
  })

  async function signOut() {
    const result = await authClient.signOut()
    if (result.error) throw new Error('Sign out failed')
    await navigate({ to: '/login', search: { error: undefined, returnTo: '/dashboard' } })
  }

  return <DashboardTopology runners={runners} onSignOut={signOut} />
}

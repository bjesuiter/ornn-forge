import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { DashboardPlaceholder } from '../components/dashboard-placeholder'

export const Route = createFileRoute('/dashboard/')({
  component: Dashboard,
})

function Dashboard() {
  const navigate = useNavigate()

  async function signOut() {
    const result = await authClient.signOut()
    if (result.error) throw new Error('Sign out failed')
    await navigate({
      to: '/login',
      search: { error: undefined, returnTo: '/dashboard' },
    })
  }

  return <DashboardPlaceholder onSignOut={signOut} />
}

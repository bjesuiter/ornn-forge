import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { hasDashboardSession } from '../auth.functions'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    if (!(await hasDashboardSession())) {
      throw redirect({
        to: '/login',
        search: { error: undefined, returnTo: '/dashboard' },
      })
    }
  },
  component: Dashboard,
})

function Dashboard() {
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    await navigate({
      to: '/login',
      search: { error: undefined, returnTo: '/dashboard' },
    })
  }

  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">Ornn Forge</p>
        <h1 id="page-title">Dashboard</h1>
        <p>The operator control surface is ready for its first controls.</p>
        <button className="button" onClick={signOut} type="button">
          Sign out
        </button>
      </section>
    </main>
  )
}

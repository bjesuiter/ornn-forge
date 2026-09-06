import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
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
  component: Outlet,
})

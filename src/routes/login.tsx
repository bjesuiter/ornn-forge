import { createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { hasDashboardSession } from '../auth.functions'

export const Route = createFileRoute('/login')({
  validateSearch: (search) => ({
    error: search.error === 'access-denied' ? search.error : undefined,
    returnTo: '/dashboard' as const,
  }),
  beforeLoad: async ({ search }) => {
    if (await hasDashboardSession()) {
      throw redirect({ to: search.returnTo })
    }
  },
  component: Login,
})

function Login() {
  const { error, returnTo } = Route.useSearch()

  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">Ornn Forge</p>
        <h1 id="page-title">Operator access</h1>
        <p>Sign in with the GitHub account approved for this control plane.</p>
        {error ? (
          <p role="alert">This GitHub account is not allowed to access the dashboard.</p>
        ) : null}
        <button
          className="button"
          onClick={() =>
            authClient.signIn.social({
              provider: 'github',
              callbackURL: returnTo,
              errorCallbackURL: '/login?error=access-denied',
            })
          }
          type="button"
        >
          Login with GitHub
        </button>
      </section>
    </main>
  )
}

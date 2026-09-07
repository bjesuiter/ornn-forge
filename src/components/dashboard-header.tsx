import { useState } from 'react'

export function DashboardHeader({
  currentPage,
  onSignOut,
}: {
  currentPage: 'dashboard' | 'topology'
  onSignOut: () => Promise<void>
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)

  async function signOut() {
    setSigningOut(true)
    setError(false)
    try {
      await onSignOut()
    } catch {
      setError(true)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <header className="fd-placeholder-header">
        <a href="/dashboard" className="fd-brand" aria-label="Ornn Forge Dashboard">
          <img src="/favicon.png" width="40" height="40" alt="" />
          <span>
            ORNN<span>FORGE</span>
          </span>
        </a>
        <nav className="fd-dashboard-navigation" aria-label="Dashboard-Navigation">
          <a href="/dashboard" aria-current={currentPage === 'dashboard' ? 'page' : undefined}>
            Dashboard
          </a>
          <a href="/dashboard/topology" aria-current={currentPage === 'topology' ? 'page' : undefined}>
            Topologie
          </a>
        </nav>
        <button className="fd-text-button" type="button" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? 'Wird abgemeldet …' : 'Abmelden'}
        </button>
      </header>
      {error && <p className="fd-dashboard-header-error fd-error" role="alert">Abmelden fehlgeschlagen. Bitte versuche es erneut.</p>}
    </>
  )
}

import { useState } from 'react'
import './forge-designs.css'

export function DashboardPlaceholder({
  onSignOut,
}: {
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
    <div className="fd fd-forge fd-placeholder" lang="de">
      <a className="fd-skip" href="#fd-main">
        Zum Inhalt
      </a>
      <header className="fd-placeholder-header">
        <a
          href="/dashboard"
          className="fd-brand"
          aria-label="Ornn Forge Dashboard"
        >
          <img src="/favicon.png" width="40" height="40" alt="" />
          <span>
            ORNN<span>FORGE</span>
          </span>
        </a>
        <button
          className="fd-text-button"
          type="button"
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? 'Wird abgemeldet …' : 'Abmelden'}
        </button>
      </header>
      <main id="fd-main" className="fd-main" tabIndex={-1}>
        <div className="fd-topline">
          <span>Deine Werkstatt / Dashboard</span>
        </div>
        {error && (
          <p className="fd-error" role="alert">
            Abmelden fehlgeschlagen. Bitte versuche es erneut.
          </p>
        )}
        <section className="fd-hero" aria-labelledby="fd-title">
          <div className="fd-hero-copy">
            <p className="fd-kicker">Ornn Forge</p>
            <h1 id="fd-title">
              Die Werkstatt
              <br />
              nimmt Gestalt an.
            </h1>
            <p className="fd-hero-description">
              Hier entsteht dein Dashboard.
              <br />
              Die ersten Bedienelemente folgen.
            </p>
            <a className="fd-primary" href="/dashboard/examples">
              Designbeispiele ansehen <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div
            className="fd-hero-art"
            role="img"
            aria-label="Ornn schmiedet glühendes Metall in seiner Vulkanschmiede"
          />
        </section>
        <footer className="fd-footer">
          <span>Ornn Forge · Mit Sorgfalt geschmiedet.</span>
          <a
            href="https://www.leagueoflegends.com/de-de/champions/ornn/"
            target="_blank"
            rel="noreferrer"
          >
            Ornn-Artwork © Riot Games ↗
          </a>
        </footer>
      </main>
    </div>
  )
}

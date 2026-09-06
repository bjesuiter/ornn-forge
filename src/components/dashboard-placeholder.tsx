import { useState } from 'react'
import type { DashboardRunner } from '../dashboard-runners'
import './forge-designs.css'

export function Dashboard({
  runners,
  onSignOut,
  onSetRunnerPaused,
}: {
  runners: DashboardRunner[]
  onSignOut: () => Promise<void>
  onSetRunnerPaused: (runnerId: string, paused: boolean) => Promise<void>
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)
  const [updatingRunnerId, setUpdatingRunnerId] = useState<string>()
  const [runnerError, setRunnerError] = useState(false)

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

  async function setRunnerPaused(runner: DashboardRunner) {
    setUpdatingRunnerId(runner.id)
    setRunnerError(false)
    try {
      await onSetRunnerPaused(runner.id, !runner.paused)
    } catch {
      setRunnerError(true)
    } finally {
      setUpdatingRunnerId(undefined)
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
        {error && (
          <p className="fd-error" role="alert">
            Abmelden fehlgeschlagen. Bitte versuche es erneut.
          </p>
        )}
        {runnerError && (
          <p className="fd-error" role="alert">
            Runner-Status konnte nicht geändert werden. Bitte versuche es erneut.
          </p>
        )}
        <section className="fd-runner-overview" aria-labelledby="fd-title">
          <div className="fd-runner-overview-heading">
            <p className="fd-kicker">Ornn Forge</p>
            <h1 id="fd-title">Runner</h1>
            <p>Alle registrierten Runner und ihre aktuelle Arbeit.</p>
          </div>
          {runners.length === 0 ? (
            <p className="fd-runner-empty">
              Noch kein Runner hat sich bei dieser Werkstatt registriert.
            </p>
          ) : (
            <ul className="fd-runner-list">
              {runners.map((runner) => (
                <li key={runner.id} className="fd-runner-row">
                  <div>
                    <h2>{runner.id}</h2>
                    <p className={`fd-runner-presence ${runner.paused ? 'is-paused' : runner.online ? 'is-online' : 'is-offline'}`}>
                      <span aria-hidden="true" />
                      {runner.paused ? 'Pausiert' : runner.online ? 'Online' : 'Offline'}
                    </p>
                  </div>
                  <div className="fd-runner-work">
                    <span>Aktuelle Arbeit</span>
                    {runner.workingOn ? (
                      <a
                        href={`https://github.com/${runner.workingOn.repository}/issues/${runner.workingOn.issueNumber}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {runner.workingOn.repository} #{runner.workingOn.issueNumber}: {runner.workingOn.issueTitle}
                      </a>
                    ) : (
                      <strong>Keine aktive Arbeit</strong>
                    )}
                  </div>
                  <button
                    className={`fd-runner-toggle ${runner.paused ? 'is-paused' : ''}`}
                    type="button"
                    aria-pressed={runner.paused}
                    aria-label={`${runner.id} ${runner.paused ? 'fortsetzen' : 'pausieren'}`}
                    onClick={() => void setRunnerPaused(runner)}
                    disabled={updatingRunnerId === runner.id}
                  >
                    {updatingRunnerId === runner.id ? 'Wird geändert …' : runner.paused ? 'Fortsetzen' : 'Pausieren'}
                  </button>
                </li>
              ))}
            </ul>
          )}
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

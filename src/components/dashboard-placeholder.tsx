import { useState } from 'react'
import type { DashboardRunner } from '../dashboard-runners'
import type { DashboardWebhook } from '../dashboard-webhooks'
import './forge-designs.css'

export function Dashboard({
  runners,
  webhooks,
  onSignOut,
  onSetRunnerPaused,
}: {
  runners: DashboardRunner[]
  webhooks: DashboardWebhook[]
  onSignOut: () => Promise<void>
  onSetRunnerPaused: (runnerId: string, paused: boolean) => Promise<void>
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)
  const [updatingRunnerId, setUpdatingRunnerId] = useState<string>()
  const [runnerError, setRunnerError] = useState(false)
  const [showAllWebhooks, setShowAllWebhooks] = useState(false)

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
        <section className="fd-webhook-history" aria-labelledby="fd-webhook-title">
          <div className="fd-webhook-heading">
            <div>
              <p className="fd-kicker">Eingang</p>
              <h2 id="fd-webhook-title">Neue Events</h2>
            </div>
            <span className="fd-webhook-count">{webhooks.length} zuletzt eingegangen</span>
          </div>
          {webhooks.length === 0 ? (
            <p className="fd-webhook-empty">Noch keine GitHub-Webhooks eingegangen.</p>
          ) : (
            <>
              <ul className="fd-webhook-list" aria-label="Eingegangene GitHub-Webhooks">
                {webhooks.slice(0, showAllWebhooks ? undefined : 3).map((webhook) => (
                  <li key={webhook.id} className="fd-webhook-row">
                    <span className={`fd-webhook-mark is-${webhook.status}`} aria-hidden="true" />
                    <div className="fd-webhook-content">
                      <p className="fd-webhook-title">
                        {webhook.repository} <span aria-hidden="true">·</span> #{webhook.issueNumber} {webhook.issueTitle}
                      </p>
                      <p className="fd-webhook-meta">
                        {webhook.source === 'comment' ? 'Kommentar-Webhook' : 'Issue-Webhook'} · {relativeTime(webhook.receivedAt)}
                        {webhook.runnerId && <> · Bearbeitet von <span className="fd-webhook-runner">{webhook.runnerId}</span></>}
                      </p>
                    </div>
                    <p className={`fd-webhook-status is-${webhook.status}`}>{webhookStatusLabel(webhook.status)}</p>
                  </li>
                ))}
              </ul>
              {webhooks.length > 3 && (
                <button
                  className="fd-webhook-more"
                  type="button"
                  aria-expanded={showAllWebhooks}
                  onClick={() => setShowAllWebhooks((visible) => !visible)}
                >
                  {showAllWebhooks ? 'Weniger anzeigen' : `Weitere ${webhooks.length - 3} anzeigen`}
                  <span aria-hidden="true">{showAllWebhooks ? '↑' : '↓'}</span>
                </button>
              )}
            </>
          )}
        </section>
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
                  <div className="fd-runner-summary">
                    <div>
                      <h2>{runner.id}</h2>
                      <div className="fd-runner-state">
                        <p className={`fd-runner-presence ${runner.online ? 'is-online' : 'is-offline'}`}>
                          <span aria-hidden="true" />
                          {runner.online ? 'Online' : 'Offline'}
                        </p>
                        <span className={`fd-runner-enrollment is-${runner.enrollment}`}>
                          {runner.enrollment === 'awaiting_setup' ? 'Einrichtung ausstehend' : 'Eingeschrieben'}
                        </span>
                        <span className={`fd-runner-readiness ${runner.ready ? 'is-ready' : 'is-not-ready'}`}>
                          {runner.ready ? 'Bereit' : 'Nicht bereit'}
                        </span>
                        {runner.paused && <span className="fd-runner-pause">Pausiert</span>}
                        {runner.fault && <span className="fd-runner-fault">Fehler</span>}
                      </div>
                    </div>
                    <p className="fd-runner-seen">
                      Letzter Kontakt {runner.lastSeenAt ? relativeTime(runner.lastSeenAt) : 'nie'}
                      {runner.lastSeenAt && <> · {dateTime(runner.lastSeenAt)}</>}
                    </p>
                  </div>
                  <div className="fd-runner-details">
                    <section className="fd-runner-detail">
                      <span>Aktuelle Arbeit</span>
                      {runner.activeJobs.length === 0 ? (
                        <strong>Keine aktive Arbeit</strong>
                      ) : (
                        <ul className="fd-runner-job-list">
                          {runner.activeJobs.map((job) => (
                            <li key={job.id}>
                              <a href={`https://github.com/${job.repository}/issues/${job.issueNumber}`} target="_blank" rel="noreferrer">
                                {job.repository} #{job.issueNumber}: {job.issueTitle}
                              </a>
                              <small>
                                {job.id} · Lease {job.generation} · läuft {elapsed(job.startedAt)} · Heartbeat {relativeTime(job.lastHeartbeatAt)}
                              </small>
                              <small>Lease läuft ab {dateTime(job.expiresAt)}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className="fd-runner-detail">
                      <span>Kapazität</span>
                      <strong>{runner.reservations} von {runner.desiredCapacity} reserviert</strong>
                      <small>Reservierungen bleiben bis zur verifizierten Sandbox-Bereinigung bestehen.</small>
                    </section>
                    {runner.fault && (
                      <section className="fd-runner-detail fd-runner-detail-fault">
                        <span>Letzter Fehler</span>
                        <strong>{runner.fault.code}</strong>
                        <small>{relativeTime(runner.fault.occurredAt)} · {dateTime(runner.fault.occurredAt)}</small>
                      </section>
                    )}
                    <section className="fd-runner-detail">
                      <span>Letztes Ergebnis</span>
                      {runner.lastResult ? (
                        <>
                          <strong>Erfolgreich nach {elapsed(runner.lastResult.startedAt, runner.lastResult.completedAt)}</strong>
                          <a href={`https://github.com/${runner.lastResult.repository}/issues/${runner.lastResult.issueNumber}`} target="_blank" rel="noreferrer">
                            {runner.lastResult.repository} #{runner.lastResult.issueNumber}: {runner.lastResult.issueTitle}
                          </a>
                          <small>{relativeTime(runner.lastResult.completedAt)}</small>
                        </>
                      ) : <strong>Noch kein abgeschlossener Job</strong>}
                    </section>
                    {runner.profile && (
                      <section className="fd-runner-detail">
                        <span>Runner-Umgebung</span>
                        <strong>{runner.profile.release} · {runner.profile.executor}</strong>
                        <small>{runner.profile.platform}/{runner.profile.architecture} · {runner.profile.runtime}</small>
                      </section>
                    )}
                    {runner.recentJobs.length > 1 && (
                      <section className="fd-runner-detail fd-runner-history">
                        <span>Letzte Jobs</span>
                        <ul>
                          {runner.recentJobs.slice(1).map((job) => (
                            <li key={job.id}>
                              <a href={`https://github.com/${job.repository}/issues/${job.issueNumber}`} target="_blank" rel="noreferrer">
                                #{job.issueNumber} {job.issueTitle}
                              </a>
                              <small>Erfolgreich · {elapsed(job.startedAt, job.completedAt)} · {relativeTime(job.completedAt)}</small>
                            </li>
                          ))}
                        </ul>
                      </section>
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

function webhookStatusLabel(status: DashboardWebhook['status']) {
  switch (status) {
    case 'queued': return 'Angenommen · wartet auf Runner'
    case 'running': return 'Beim Runner in Arbeit'
    case 'completed': return 'Erfolgreich abgeschlossen'
    case 'message_uncertain': return 'GitHub-Antwort ungeklärt'
  }
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000))
  if (seconds < 60) return `vor ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `vor ${minutes} min`
  const hours = Math.round(minutes / 60)
  return `vor ${hours} h`
}

function elapsed(startedAt: string, endedAt = new Date().toISOString()) {
  const seconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1_000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${seconds % 60} s`
}

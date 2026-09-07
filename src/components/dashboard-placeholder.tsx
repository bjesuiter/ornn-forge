import { useEffect, useRef, useState } from 'react'
import type { RemoteRunner, RunnerDecommissionResult } from '../control-plane'
import type { DashboardRunner } from '../dashboard-runners'
import type { DashboardWebhook } from '../dashboard-webhooks'
import type { OpenAiSubscriptionUsage } from '../openai-subscription-usage'
import { DashboardHeader } from './dashboard-header'
import './forge-designs.css'

const setupTokenLifetimeMs = 15 * 60_000

type CreatedRunner = { runner: RemoteRunner; setupToken: string; setupExpiresAt: number }

export function Dashboard({
  openAiUsage,
  runners,
  webhooks,
  onSignOut,
  onSetRunnerPaused,
  onSetRunnerLabel,
  onCreateRunner,
  onDecommissionRunner,
  onStartOpenAiSubscriptionAuthorization,
  onCompleteOpenAiSubscriptionAuthorization,
  onDisconnectOpenAiSubscription,
}: {
  openAiUsage: OpenAiSubscriptionUsage
  runners: DashboardRunner[]
  webhooks: DashboardWebhook[]
  onSignOut: () => Promise<void>
  onSetRunnerPaused: (runnerId: string, paused: boolean) => Promise<void>
  onSetRunnerLabel: (runnerId: string, label: string) => Promise<void>
  onCreateRunner: (capacity: number) => Promise<{ runner: RemoteRunner; setupToken: string }>
  onDecommissionRunner: (runnerId: string, force: boolean) => Promise<RunnerDecommissionResult>
  onStartOpenAiSubscriptionAuthorization: () => Promise<void>
  onCompleteOpenAiSubscriptionAuthorization: () => Promise<void>
  onDisconnectOpenAiSubscription: () => Promise<void>
}) {
  const [updatingRunnerId, setUpdatingRunnerId] = useState<string>()
  const [decommissioningRunnerId, setDecommissioningRunnerId] = useState<string>()
  const [editingRunnerId, setEditingRunnerId] = useState<string>()
  const [runnerLabel, setRunnerLabel] = useState('')
  const [runnerError, setRunnerError] = useState<string>()
  const [showRunnerDialog, setShowRunnerDialog] = useState(false)
  const [runnerCapacity, setRunnerCapacity] = useState(1)
  const [creatingRunner, setCreatingRunner] = useState(false)
  const [createdRunner, setCreatedRunner] = useState<CreatedRunner>()
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [runnerSetupError, setRunnerSetupError] = useState(false)
  const [setupTokenCopied, setSetupTokenCopied] = useState(false)
  const [showAllWebhooks, setShowAllWebhooks] = useState(false)
  const [updatingOpenAiSubscription, setUpdatingOpenAiSubscription] = useState(false)
  const [openAiSubscriptionError, setOpenAiSubscriptionError] = useState(false)
  const runnerDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (showRunnerDialog && runnerDialog.current && !runnerDialog.current.open) runnerDialog.current.showModal()
  }, [showRunnerDialog])

  useEffect(() => {
    if (!showRunnerDialog || !createdRunner) return
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [createdRunner, showRunnerDialog])

  useEffect(() => {
    if (createdRunner && runners.some((runner) => runner.id === createdRunner.runner.id && runner.enrollment === 'enrolled')) {
      setShowRunnerDialog(false)
    }
  }, [createdRunner, runners])

  async function setRunnerPaused(runner: DashboardRunner) {
    setUpdatingRunnerId(runner.id)
    setRunnerError(undefined)
    try {
      await onSetRunnerPaused(runner.id, !runner.paused)
    } catch {
      setRunnerError('Runner konnte nicht aktualisiert werden. Bitte versuche es erneut.')
    } finally {
      setUpdatingRunnerId(undefined)
    }
  }

  function startEditingRunnerLabel(runner: DashboardRunner) {
    setRunnerLabel(runner.label)
    setEditingRunnerId(runner.id)
  }

  async function saveRunnerLabel(event: React.FormEvent<HTMLFormElement>, runner: DashboardRunner) {
    event.preventDefault()
    const label = runnerLabel.trim()
    if (!label) return
    setUpdatingRunnerId(runner.id)
    setRunnerError(undefined)
    try {
      await onSetRunnerLabel(runner.id, label)
      setEditingRunnerId(undefined)
    } catch {
      setRunnerError('Runner konnte nicht aktualisiert werden. Bitte versuche es erneut.')
    } finally {
      setUpdatingRunnerId(undefined)
    }
  }

  async function decommissionRunner(runner: DashboardRunner, force: boolean) {
    const action = force ? 'sofort stilllegen' : 'stilllegen'
    const consequence = force
      ? 'Die Runner-Authentifizierung und neue Leases werden sofort gesperrt. Bereits reservierte Sandboxes bleiben zur Bereinigung erhalten.'
      : 'Der Runner wird dauerhaft deaktiviert und kann sich nicht erneut verbinden.'
    if (!window.confirm(`${runner.label} ${action}?\n\n${consequence}`)) return
    setDecommissioningRunnerId(runner.id)
    setRunnerError(undefined)
    try {
      const result = await onDecommissionRunner(runner.id, force)
      const message = decommissionError(result)
      if (message) setRunnerError(message)
    } catch {
      setRunnerError('Runner konnte nicht stillgelegt werden. Bitte versuche es erneut.')
    } finally {
      setDecommissioningRunnerId(undefined)
    }
  }

  async function updateOpenAiSubscription(action: () => Promise<void>) {
    setUpdatingOpenAiSubscription(true)
    setOpenAiSubscriptionError(false)
    try {
      await action()
    } catch {
      setOpenAiSubscriptionError(true)
    } finally {
      setUpdatingOpenAiSubscription(false)
    }
  }

  function openRunnerDialog() {
    setCreatedRunner(undefined)
    setRunnerSetupError(false)
    setSetupTokenCopied(false)
    setShowRunnerDialog(true)
  }

  function closeRunnerDialog() {
    if (creatingRunner) return
    setShowRunnerDialog(false)
  }

  async function createRunner(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingRunner(true)
    setRunnerSetupError(false)
    try {
      const runner = await onCreateRunner(runnerCapacity)
      setCurrentTime(Date.now())
      setCreatedRunner({ ...runner, setupExpiresAt: Date.now() + setupTokenLifetimeMs })
    } catch {
      setRunnerSetupError(true)
    } finally {
      setCreatingRunner(false)
    }
  }

  async function copySetupToken() {
    if (!createdRunner || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(createdRunner.setupToken)
      setSetupTokenCopied(true)
    } catch {
      setSetupTokenCopied(false)
    }
  }

  return (
    <div className="fd fd-forge fd-placeholder" lang="de">
      <a className="fd-skip" href="#fd-main">
        Zum Inhalt
      </a>
      <DashboardHeader currentPage="dashboard" onSignOut={onSignOut} />
      <main id="fd-main" className="fd-main" tabIndex={-1}>
        {runnerError && (
          <p className="fd-error" role="alert">
            {runnerError}
          </p>
        )}
        <section className="fd-openai-usage" aria-labelledby="fd-openai-usage-title">
          <div className="fd-openai-usage-heading">
            <div>
              <p className="fd-kicker">Außerhalb von Ornn Forge</p>
              <h2 id="fd-openai-usage-title">OpenAI-Abo</h2>
            </div>
            {openAiUsage.status === 'available' && (
              <div className="fd-openai-usage-status">
                <p className="fd-openai-usage-plan">{openAiUsage.plan ? formatPlan(openAiUsage.plan) : 'ChatGPT'}</p>
                {openAiUsage.credits !== undefined && <p className="fd-openai-usage-credits">{formatCredits(openAiUsage.credits)} Credits</p>}
              </div>
            )}
          </div>
          {openAiUsage.status === 'available' ? (
            <>
              <ul className="fd-openai-usage-list">
                {openAiUsage.windows.map((window) => (
                  <li key={window.label}>
                    <div className="fd-openai-usage-window">
                      <span>{window.label}</span>
                      <strong>{formatPercent(100 - window.usedPercent)} frei</strong>
                    </div>
                    <div className="fd-openai-usage-track" aria-label={`${window.label}: ${formatPercent(100 - window.usedPercent)} frei`}>
                      <span style={{ width: `${window.usedPercent}%` }} />
                    </div>
                    <small>{window.resetsAt ? `Zurückgesetzt ${dateTime(window.resetsAt)}` : 'Zeitpunkt zum Zurücksetzen nicht verfügbar'}</small>
                  </li>
                ))}
              </ul>
              <div className="fd-openai-usage-footer">
                <p className="fd-openai-usage-note">Zuletzt geprüft {relativeTime(openAiUsage.checkedAt)}. Diese Anzeige gehört nicht zum Runner-Status.</p>
                <button className="fd-openai-usage-action" type="button" disabled={updatingOpenAiSubscription} onClick={() => void updateOpenAiSubscription(onDisconnectOpenAiSubscription)}>
                  Verbindung trennen
                </button>
              </div>
            </>
          ) : openAiUsage.status === 'connecting' ? (
            <div className="fd-openai-usage-connection">
              <p>Öffne <a href={openAiUsage.verificationUri} target="_blank" rel="noreferrer">OpenAI verbinden</a> und bestätige den Code <strong>{openAiUsage.userCode}</strong>.</p>
              <p className="fd-openai-usage-note">Der Code ist bis {dateTime(openAiUsage.expiresAt)} gültig. Das Dashboard erhält keine Tokens.</p>
              <button className="fd-openai-usage-action" type="button" disabled={updatingOpenAiSubscription} onClick={() => void updateOpenAiSubscription(onCompleteOpenAiSubscriptionAuthorization)}>
                {updatingOpenAiSubscription ? 'Prüft …' : 'Verbindung prüfen'}
              </button>
            </div>
          ) : (
            <div className="fd-openai-usage-connection">
              <p className="fd-openai-usage-unavailable">
                {openAiUsage.reason === 'not_connected'
                  ? 'Das OpenAI-Abo ist noch nicht mit dieser Control Plane verbunden.'
                  : 'Der letzte Usage-Refresh war nicht erfolgreich.'}
              </p>
              <button className="fd-openai-usage-action" type="button" disabled={updatingOpenAiSubscription} onClick={() => void updateOpenAiSubscription(onStartOpenAiSubscriptionAuthorization)}>
                {updatingOpenAiSubscription ? 'Startet …' : 'OpenAI verbinden'}
              </button>
            </div>
          )}
          {openAiSubscriptionError && <p className="fd-error fd-openai-usage-error" role="alert">OpenAI-Verbindung konnte nicht geändert werden. Bitte erneut versuchen.</p>}
        </section>
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
            <div>
              <p className="fd-kicker">Ornn Forge</p>
              <h1 id="fd-title">Runner</h1>
              <p>Alle registrierten Runner und ihre aktuelle Arbeit.</p>
            </div>
            <button className="fd-runner-add" type="button" onClick={openRunnerDialog}>
              Runner hinzufügen
            </button>
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
                      {editingRunnerId === runner.id ? (
                        <form className="fd-runner-label-form" onSubmit={(event) => void saveRunnerLabel(event, runner)}>
                          <label>
                            <input
                              aria-label="Runner-Label"
                              value={runnerLabel}
                              onChange={(event) => setRunnerLabel(event.target.value)}
                              maxLength={255}
                              autoFocus
                              disabled={updatingRunnerId === runner.id}
                            />
                          </label>
                          <button type="submit" disabled={updatingRunnerId === runner.id || runnerLabel.trim().length === 0}>
                            {updatingRunnerId === runner.id ? 'Speichert …' : 'Speichern'}
                          </button>
                          <button type="button" onClick={() => setEditingRunnerId(undefined)} disabled={updatingRunnerId === runner.id}>Abbrechen</button>
                        </form>
                      ) : (
                        <div className="fd-runner-label-heading">
                          <h2>{runner.label}</h2>
                          <button
                            className="fd-runner-label-edit"
                            type="button"
                            aria-label={`${runner.label} umbenennen`}
                            title="Runner-Label bearbeiten"
                            onClick={() => startEditingRunnerLabel(runner)}
                            disabled={updatingRunnerId === runner.id}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
                          </button>
                        </div>
                      )}
                      <p className="fd-runner-id">{runner.id}</p>
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
                        <span>Hardware & Umgebung</span>
                        <strong>{runner.profile.hardwareModel}</strong>
                        <small>{runner.profile.release} · {runner.profile.platform}/{runner.profile.architecture} · {runner.profile.runtime} · {runner.profile.executor}</small>
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
                  <div className="fd-runner-actions">
                    <button
                      className={`fd-runner-toggle ${runner.paused ? 'is-paused' : ''}`}
                      type="button"
                      aria-pressed={runner.paused}
                      aria-label={`${runner.id} ${runner.paused ? 'fortsetzen' : 'pausieren'}`}
                      onClick={() => void setRunnerPaused(runner)}
                      disabled={updatingRunnerId === runner.id || decommissioningRunnerId === runner.id}
                    >
                      {updatingRunnerId === runner.id ? 'Wird geändert …' : runner.paused ? 'Fortsetzen' : 'Pausieren'}
                    </button>
                    <button
                      className="fd-runner-decommission"
                      type="button"
                      onClick={() => void decommissionRunner(runner, !runner.paused || runner.reservations > 0)}
                      disabled={updatingRunnerId === runner.id || decommissioningRunnerId === runner.id}
                    >
                      {decommissioningRunnerId === runner.id
                        ? 'Wird stillgelegt …'
                        : !runner.paused || runner.reservations > 0
                          ? 'Sofort stilllegen'
                          : 'Runner löschen'}
                    </button>
                  </div>
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
      {showRunnerDialog && (
        <dialog ref={runnerDialog} className="fd-runner-dialog" aria-labelledby="fd-runner-dialog-title" onCancel={(event) => {
          event.preventDefault()
          closeRunnerDialog()
        }}>
          <div className="fd-runner-dialog-panel">
            <div className="fd-runner-dialog-header">
              <div>
                <p className="fd-kicker">Neue Identität</p>
                <h2 id="fd-runner-dialog-title">Runner hinzufügen</h2>
              </div>
              <button className="fd-dialog-close" type="button" aria-label="Dialog schließen" onClick={closeRunnerDialog} disabled={creatingRunner}>×</button>
            </div>
            {createdRunner ? (
              <div className="fd-runner-setup-result">
                <p className="fd-runner-setup-success">{createdRunner.runner.id} wartet auf die Einrichtung.</p>
                <p>Übertrage dieses Setup-Token auf den neuen Runner. Es wird nur jetzt angezeigt und ist 15 Minuten gültig.</p>
                <div className="fd-setup-token">
                  <code>{createdRunner.setupToken}</code>
                  <button type="button" onClick={() => void copySetupToken()}>{setupTokenCopied ? 'Kopiert' : 'Kopieren'}</button>
                </div>
                <p className="fd-runner-setup-note">Starte auf dem Runner <code>bun run runner:setup</code> und füge das Token bei der Abfrage ein.</p>
                <p className={`fd-runner-setup-status ${currentTime >= createdRunner.setupExpiresAt ? 'is-timed-out' : ''}`} role="status">
                  {currentTime >= createdRunner.setupExpiresAt
                    ? 'Status: Zeitüberschreitung – Setup-Token abgelaufen'
                    : 'Status: wartet auf Verbindung'}
                </p>
                <button className="fd-dialog-primary" type="button" onClick={closeRunnerDialog}>Fertig</button>
              </div>
            ) : (
              <form onSubmit={(event) => void createRunner(event)}>
                <p className="fd-runner-dialog-description">Lege eine Runner-Identität an und erhalte ein einmaliges Setup-Token für die sichere Einrichtung.</p>
                <label className="fd-runner-capacity" htmlFor="fd-runner-capacity">
                  <span>Gleichzeitige Jobs</span>
                  <input
                    id="fd-runner-capacity"
                    type="number"
                    min="1"
                    max="32"
                    value={runnerCapacity}
                    onChange={(event) => setRunnerCapacity(Math.min(32, Math.max(1, Number(event.target.value) || 1)))}
                    disabled={creatingRunner}
                    autoFocus
                  />
                  <small>Der Runner kann zwischen 1 und 32 Jobs gleichzeitig annehmen.</small>
                </label>
                {runnerSetupError && <p className="fd-error fd-runner-dialog-error" role="alert">Runner konnte nicht angelegt werden. Bitte erneut versuchen.</p>}
                <div className="fd-dialog-actions">
                  <button className="fd-dialog-cancel" type="button" onClick={closeRunnerDialog} disabled={creatingRunner}>Abbrechen</button>
                  <button className="fd-dialog-primary" type="submit" disabled={creatingRunner}>{creatingRunner ? 'Wird angelegt …' : 'Runner anlegen'}</button>
                </div>
              </form>
            )}
          </div>
        </dialog>
      )}
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

function decommissionError(result: RunnerDecommissionResult): string | undefined {
  switch (result) {
    case 'decommissioned': return undefined
    case 'not_found': return 'Dieser Runner ist nicht mehr registriert.'
    case 'requires_pause': return 'Zum Stilllegen muss der Runner zuerst pausiert werden.'
    case 'has_reservations': return 'Der Runner hat noch Kapazitätsreservierungen und kann nicht normal stillgelegt werden.'
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

function formatPercent(value: number) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value) + ' %'
}

function formatPlan(value: string) {
  return value.replace(/(^|[_-])(\w)/g, (_, separator: string, character: string) => `${separator}${character.toUpperCase()}`)
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)
}

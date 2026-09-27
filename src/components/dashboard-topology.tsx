import { useEffect, useRef, useState } from 'react'
import type { RemoteRunner, RunnerDecommissionResult } from '../control-plane'
import type { DashboardRunner, DashboardRunnerJob } from '../dashboard-runners'
import type { DashboardWebhook } from '../dashboard-webhooks'
import type { OpenAiSubscriptionUsage } from '../openai-subscription-usage'
import { DashboardHeader } from './dashboard-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog'
import './forge-designs.css'

type TopologyProps = {
  openAiUsage: OpenAiSubscriptionUsage
  runners: DashboardRunner[]
  webhooks: DashboardWebhook[]
  onSignOut: () => Promise<void>
  onSetRunnerPaused: (runnerId: string, paused: boolean) => Promise<void>
  onForceQuitJob: (jobId: string) => Promise<void>
  onSetRunnerLabel: (runnerId: string, label: string) => Promise<void>
  onCreateRunner: (capacity: number) => Promise<{ runner: RemoteRunner; setupToken: string }>
  onDecommissionRunner: (runnerId: string, force: boolean) => Promise<RunnerDecommissionResult>
  onStartOpenAiSubscriptionAuthorization: () => Promise<void>
  onCompleteOpenAiSubscriptionAuthorization: () => Promise<void>
  onDisconnectOpenAiSubscription: () => Promise<void>
}

export function DashboardTopology({
  openAiUsage,
  runners,
  webhooks,
  onSignOut,
  onSetRunnerPaused,
  onForceQuitJob,
  onSetRunnerLabel,
  onCreateRunner,
  onDecommissionRunner,
  onStartOpenAiSubscriptionAuthorization,
  onCompleteOpenAiSubscriptionAuthorization,
  onDisconnectOpenAiSubscription,
}: TopologyProps) {
  const [busyRunnerId, setBusyRunnerId] = useState<string>()
  const [runnerError, setRunnerError] = useState<string>()
  const [editingRunnerId, setEditingRunnerId] = useState<string>()
  const [runnerLabel, setRunnerLabel] = useState('')
  const [busyJobId, setBusyJobId] = useState<string>()
  const [forceQuitDialogJobId, setForceQuitDialogJobId] = useState<string>()
  const [jobError, setJobError] = useState(false)
  const [busyOpenAi, setBusyOpenAi] = useState(false)
  const [openAiError, setOpenAiError] = useState(false)
  const [showAllWebhooks, setShowAllWebhooks] = useState(false)
  const [showRunnerDialog, setShowRunnerDialog] = useState(false)
  const [runnerCapacity, setRunnerCapacity] = useState(1)
  const [creatingRunner, setCreatingRunner] = useState(false)
  const [createdRunner, setCreatedRunner] = useState<{ runner: RemoteRunner; setupToken: string; expiresAt: number }>()
  const [setupError, setSetupError] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [currentTime, setCurrentTime] = useState(Date.now())
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

  async function changeRunner(runner: DashboardRunner, action: () => Promise<void>) {
    setBusyRunnerId(runner.id)
    setRunnerError(undefined)
    try {
      await action()
    } catch {
      setRunnerError(`Runner ${runner.label} konnte nicht aktualisiert werden.`)
    } finally {
      setBusyRunnerId(undefined)
    }
  }

  async function saveLabel(event: React.FormEvent<HTMLFormElement>, runner: DashboardRunner) {
    event.preventDefault()
    const label = runnerLabel.trim()
    if (!label) return
    await changeRunner(runner, async () => {
      await onSetRunnerLabel(runner.id, label)
      setEditingRunnerId(undefined)
    })
  }

  async function decommission(runner: DashboardRunner) {
    const force = !runner.paused || runner.reservations > 0
    const consequence = force
      ? 'Die Runner-Authentifizierung und neue Leases werden sofort gesperrt. Reservierte Sandboxes bleiben zur Bereinigung erhalten.'
      : 'Der Runner wird dauerhaft deaktiviert und kann sich nicht erneut verbinden.'
    if (!window.confirm(`${runner.label} ${force ? 'sofort stilllegen' : 'stilllegen'}?\n\n${consequence}`)) return
    await changeRunner(runner, async () => {
      const result = await onDecommissionRunner(runner.id, force)
      if (result !== 'decommissioned') throw new Error(result)
    })
  }

  async function forceQuit(job: DashboardRunnerJob) {
    setBusyJobId(job.id)
    setJobError(false)
    try {
      await onForceQuitJob(job.id)
      setForceQuitDialogJobId(undefined)
    } catch {
      setJobError(true)
    } finally {
      setBusyJobId(undefined)
    }
  }

  async function changeOpenAi(action: () => Promise<void>) {
    setBusyOpenAi(true)
    setOpenAiError(false)
    try {
      await action()
    } catch {
      setOpenAiError(true)
    } finally {
      setBusyOpenAi(false)
    }
  }

  async function createRunner(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreatingRunner(true)
    setSetupError(false)
    try {
      const result = await onCreateRunner(runnerCapacity)
      setCreatedRunner({ ...result, expiresAt: Date.now() + 15 * 60_000 })
      setCurrentTime(Date.now())
    } catch {
      setSetupError(true)
    } finally {
      setCreatingRunner(false)
    }
  }

  async function copyToken() {
    if (!createdRunner || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(createdRunner.setupToken)
      setTokenCopied(true)
    } catch {
      setTokenCopied(false)
    }
  }

  const onlineCount = runners.filter((runner) => runner.presence === 'online').length
  const reservedCount = runners.reduce((count, runner) => count + runner.reservations, 0)

  return (
    <div className="fd fd-forge fd-placeholder fd-topology-view" lang="de">
      <a className="fd-skip" href="#fd-main">Zum Inhalt</a>
      <DashboardHeader currentPage="topology" onSignOut={onSignOut} />
      <main id="fd-main" className="fd-main" tabIndex={-1}>
        <header className="fd-topology-overview">
          <div>
            <p className="fd-kicker">Systemübersicht</p>
            <h1>Topologie</h1>
          </div>
          <p><strong>{onlineCount}/{runners.length}</strong> Runner online <span aria-hidden="true">·</span> <strong>{reservedCount}</strong> Slots belegt</p>
        </header>
        {runnerError && <p className="fd-error" role="alert">{runnerError}</p>}
        <div className="fd-topology-layout">
          <section className="fd-topology-control-plane" aria-labelledby="fd-control-plane-title">
            <p className="fd-topology-kind">Control Plane</p>
            <h2 id="fd-control-plane-title">Ornn Forge</h2>
          </section>
          <section className="fd-topology-usage" aria-labelledby="fd-topology-usage-title">
            <div className="fd-topology-section-heading">
              <h3 id="fd-topology-usage-title">OpenAI-Abo</h3>
              {openAiUsage.status === 'available' && <span>{openAiUsage.plan ? formatPlan(openAiUsage.plan) : 'ChatGPT'}</span>}
            </div>
            {openAiUsage.status === 'available' ? (
              <>
                {openAiUsage.credits !== undefined && <p className="fd-topology-credits">{formatNumber(openAiUsage.credits)} Credits</p>}
                <ul className="fd-topology-usage-list">
                  {openAiUsage.windows.map((window) => (
                    <li key={window.label}>
                      <div><span>{window.label}</span><strong>{formatNumber(100 - window.usedPercent)} % frei</strong></div>
                      <div className="fd-topology-meter" role="meter" aria-label={window.label} aria-valuenow={100 - window.usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${100 - window.usedPercent}%` }} /></div>
                      {window.resetsAt && <small>Reset {dateTime(window.resetsAt)}</small>}
                    </li>
                  ))}
                </ul>
                <div className="fd-topology-usage-footer">
                  <small>Geprüft {relativeTime(openAiUsage.checkedAt)}</small>
                  <button type="button" disabled={busyOpenAi} onClick={() => void changeOpenAi(onDisconnectOpenAiSubscription)}>Trennen</button>
                </div>
              </>
            ) : openAiUsage.status === 'connecting' ? (
              <div className="fd-topology-connection">
                <p><a href={openAiUsage.verificationUri} target="_blank" rel="noreferrer">OpenAI verbinden ↗</a> · Code <strong>{openAiUsage.userCode}</strong></p>
                <small>Gültig bis {dateTime(openAiUsage.expiresAt)}</small>
                <button type="button" disabled={busyOpenAi} onClick={() => void changeOpenAi(onCompleteOpenAiSubscriptionAuthorization)}>Verbindung prüfen</button>
              </div>
            ) : (
              <div className="fd-topology-connection">
                <p>{openAiUsage.reason === 'not_connected' ? 'Nicht verbunden' : 'Usage derzeit nicht verfügbar'}</p>
                <button type="button" disabled={busyOpenAi} onClick={() => void changeOpenAi(onStartOpenAiSubscriptionAuthorization)}>OpenAI verbinden</button>
              </div>
            )}
            {openAiError && <p className="fd-error" role="alert">OpenAI-Verbindung konnte nicht geändert werden.</p>}
          </section>
          <section className="fd-topology-events" aria-labelledby="fd-topology-events-title">
            <div className="fd-topology-section-heading">
              <h3 id="fd-topology-events-title">Neue Events</h3>
              <span>{webhooks.length}</span>
            </div>
            {webhooks.length === 0 ? <p className="fd-topology-empty">Noch keine GitHub-Webhooks.</p> : (
              <>
                <ul>
                  {webhooks.slice(0, showAllWebhooks ? undefined : 3).map((webhook) => (
                    <li key={webhook.id}>
                      <span className={`fd-webhook-mark is-${webhook.status}`} aria-hidden="true" />
                      <div>
                        <strong>{webhook.repository} #{webhook.issueNumber}: {webhook.issueTitle}</strong>
                        <small>{webhook.source === 'comment' ? 'Kommentar' : 'Issue'} · {relativeTime(webhook.receivedAt)} · {webhookStatus(webhook.status)}{webhook.runnerId && ` · ${webhook.runnerId}`}</small>
                      </div>
                    </li>
                  ))}
                </ul>
                {webhooks.length > 3 && <button className="fd-topology-more" type="button" aria-expanded={showAllWebhooks} onClick={() => setShowAllWebhooks(!showAllWebhooks)}>{showAllWebhooks ? 'Weniger' : `Weitere ${webhooks.length - 3}`}</button>}
              </>
            )}
          </section>
          <section className="fd-topology-runners" aria-labelledby="fd-topology-runners-title">
            <div className="fd-topology-runners-heading">
              <div><p className="fd-topology-kind">Ausführungsumgebung</p><h2 id="fd-topology-runners-title">Remote Runner</h2></div>
              <button className="fd-runner-add" type="button" onClick={() => { setCreatedRunner(undefined); setSetupError(false); setTokenCopied(false); setShowRunnerDialog(true) }}>Runner hinzufügen</button>
            </div>
            {runners.length === 0 ? <p className="fd-topology-empty">Noch kein Runner registriert.</p> : (
              <ul className="fd-topology-runner-list">
                {runners.map((runner) => (
                  <li key={runner.id} className="fd-topology-runner">
                    <div className="fd-topology-runner-main">
                      <div className="fd-topology-runner-heading">
                        <div>
                          {editingRunnerId === runner.id ? (
                            <form className="fd-runner-label-form" onSubmit={(event) => void saveLabel(event, runner)}>
                              <input aria-label="Runner-Label" value={runnerLabel} onChange={(event) => setRunnerLabel(event.target.value)} maxLength={255} autoFocus disabled={busyRunnerId === runner.id} />
                              <button type="submit" disabled={busyRunnerId === runner.id || !runnerLabel.trim()}>Speichern</button>
                              <button type="button" onClick={() => setEditingRunnerId(undefined)}>Abbrechen</button>
                            </form>
                          ) : (
                            <div className="fd-runner-label-heading">
                              <h3>{runner.label}</h3>
                              <button className="fd-runner-label-edit" type="button" aria-label={`${runner.label} umbenennen`} onClick={() => { setRunnerLabel(runner.label); setEditingRunnerId(runner.id) }} disabled={busyRunnerId === runner.id}>✎</button>
                            </div>
                          )}
                          <p className="fd-topology-runner-id">{runner.id}</p>
                        </div>
                        <div className="fd-topology-runner-status">
                          <span className={`is-${runner.presence}`}>{runner.presence === 'online' ? 'Online' : runner.presence === 'late' ? 'Heartbeat verspätet' : 'Offline'}</span>
                          {runner.enrollment === 'awaiting_setup' && <span>Setup ausstehend</span>}
                          {runner.paused && <span>Pausiert</span>}
                          {!runner.ready && <span>Nicht bereit</span>}
                          {runner.fault && <span className="is-fault">Fehler</span>}
                        </div>
                      </div>
                      <div className="fd-topology-runner-facts">
                        <div><span>Kapazität</span><strong>{runner.reservations} / {runner.desiredCapacity}</strong></div>
                        <div><span>Letzter Kontakt</span><strong title={runner.lastSeenAt ? dateTime(runner.lastSeenAt) : undefined}>{runner.lastSeenAt ? relativeTime(runner.lastSeenAt) : 'Nie'}</strong></div>
                        {runner.profile && <div><span>Host</span><strong>{runner.profile.hardwareModel}</strong><small>{runner.profile.release} · {runner.profile.platform}/{runner.profile.architecture} · {runner.profile.runtime} · {runner.profile.executor}</small></div>}
                      </div>
                      {runner.fault && <p className="fd-topology-fault">Fehler {runner.fault.code} · {relativeTime(runner.fault.occurredAt)}</p>}
                    </div>
                    <div className="fd-topology-runner-work">
                      <div className="fd-topology-work-block">
                        <span>Belegte Slots</span>
                        {runner.activeJobs.length === 0 ? <strong>Keine laufenden Jobs</strong> : (
                          <ul>
                            {runner.activeJobs.map((job) => (
                              <li key={job.id}>
                                <a href={`https://github.com/${job.repository}/issues/${job.issueNumber}`} target="_blank" rel="noreferrer">{job.repository} #{job.issueNumber}: {job.issueTitle}</a>
                                <small>{job.id} · Lease {job.generation} · läuft {elapsed(job.startedAt)} · Heartbeat {relativeTime(job.lastHeartbeatAt)} · Ablauf {dateTime(job.expiresAt)}</small>
                                {job.forceQuitCompletedAt ? <small>Force Quit abgeschlossen, Bereinigung fehlgeschlagen.</small> : job.forceQuitRequestedAt ? <small>Force Quit angefordert.</small> : (
                                  <AlertDialog open={forceQuitDialogJobId === job.id} onOpenChange={(open) => { setForceQuitDialogJobId(open ? job.id : undefined); setJobError(false) }}>
                                    <AlertDialogTrigger render={<button className="fd-runner-force-quit" type="button" disabled={busyJobId === job.id} />}>Force Quit</AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Job per Force Quit beenden?</AlertDialogTitle>
                                        <AlertDialogDescription>Job {job.id} wird abgebrochen. Der Slot wird erst nach verifizierter Sandbox-Bereinigung frei.</AlertDialogDescription>
                                        {jobError && <p className="text-sm text-destructive" role="alert">Force Quit konnte nicht angefordert werden.</p>}
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                        <AlertDialogAction variant="destructive" disabled={busyJobId === job.id} onClick={() => void forceQuit(job)}>Force Quit</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="fd-topology-work-block">
                        <span>Letztes Ergebnis</span>
                        {runner.lastResult ? (
                          <><strong>Erfolgreich nach {elapsed(runner.lastResult.startedAt, runner.lastResult.completedAt)}</strong><a href={`https://github.com/${runner.lastResult.repository}/issues/${runner.lastResult.issueNumber}`} target="_blank" rel="noreferrer">{runner.lastResult.repository} #{runner.lastResult.issueNumber}: {runner.lastResult.issueTitle}</a><small>{relativeTime(runner.lastResult.completedAt)}</small></>
                        ) : <strong>Noch kein abgeschlossener Job</strong>}
                      </div>
                      {runner.recentJobs.length > 1 && <details className="fd-topology-history"><summary>Weitere Ergebnisse ({runner.recentJobs.length - 1})</summary><ul>{runner.recentJobs.slice(1).map((job) => <li key={job.id}><a href={`https://github.com/${job.repository}/issues/${job.issueNumber}`} target="_blank" rel="noreferrer">#{job.issueNumber} {job.issueTitle}</a><small>Erfolgreich · {elapsed(job.startedAt, job.completedAt)} · {relativeTime(job.completedAt)}</small></li>)}</ul></details>}
                    </div>
                    <div className="fd-topology-runner-actions">
                      <button className={`fd-runner-toggle ${runner.paused ? 'is-paused' : ''}`} type="button" aria-pressed={runner.paused} disabled={busyRunnerId === runner.id} onClick={() => void changeRunner(runner, () => onSetRunnerPaused(runner.id, !runner.paused))}>{runner.paused ? 'Fortsetzen' : 'Pausieren'}</button>
                      <button className="fd-runner-decommission" type="button" disabled={busyRunnerId === runner.id} onClick={() => void decommission(runner)}>{!runner.paused || runner.reservations > 0 ? 'Sofort stilllegen' : 'Runner löschen'}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
      {showRunnerDialog && (
        <dialog ref={runnerDialog} className="fd-runner-dialog" aria-labelledby="fd-topology-runner-dialog-title" onCancel={(event) => { event.preventDefault(); if (!creatingRunner) setShowRunnerDialog(false) }}>
          <div className="fd-runner-dialog-panel">
            <div className="fd-runner-dialog-header">
              <div><p className="fd-kicker">Neue Identität</p><h2 id="fd-topology-runner-dialog-title">Runner hinzufügen</h2></div>
              <button className="fd-dialog-close" type="button" aria-label="Dialog schließen" disabled={creatingRunner} onClick={() => setShowRunnerDialog(false)}>×</button>
            </div>
            {createdRunner ? (
              <div className="fd-runner-setup-result">
                <p className="fd-runner-setup-success">{createdRunner.runner.id} wartet auf die Einrichtung.</p>
                <p>Übertrage dieses Setup-Token auf den neuen Runner. Es wird nur jetzt angezeigt und ist 15 Minuten gültig.</p>
                <div className="fd-setup-token"><code>{createdRunner.setupToken}</code><button type="button" onClick={() => void copyToken()}>{tokenCopied ? 'Kopiert' : 'Kopieren'}</button></div>
                <p className="fd-runner-setup-note">Starte auf dem Runner <code>bun run runner:setup</code> und füge das Token bei der Abfrage ein.</p>
                <p className={`fd-runner-setup-status ${currentTime >= createdRunner.expiresAt ? 'is-timed-out' : ''}`} role="status">{currentTime >= createdRunner.expiresAt ? 'Status: Setup-Token abgelaufen' : 'Status: wartet auf Verbindung'}</p>
                <button className="fd-dialog-primary" type="button" onClick={() => setShowRunnerDialog(false)}>Fertig</button>
              </div>
            ) : (
              <form onSubmit={(event) => void createRunner(event)}>
                <label className="fd-runner-capacity" htmlFor="fd-topology-runner-capacity"><span>Gleichzeitige Jobs</span><input id="fd-topology-runner-capacity" type="number" min="1" max="32" value={runnerCapacity} onChange={(event) => setRunnerCapacity(Math.min(32, Math.max(1, Number(event.target.value) || 1)))} disabled={creatingRunner} autoFocus /><small>Der Runner kann zwischen 1 und 32 Jobs gleichzeitig annehmen.</small></label>
                {setupError && <p className="fd-error fd-runner-dialog-error" role="alert">Runner konnte nicht angelegt werden.</p>}
                <div className="fd-dialog-actions"><button className="fd-dialog-cancel" type="button" disabled={creatingRunner} onClick={() => setShowRunnerDialog(false)}>Abbrechen</button><button className="fd-dialog-primary" type="submit" disabled={creatingRunner}>{creatingRunner ? 'Wird angelegt …' : 'Runner anlegen'}</button></div>
              </form>
            )}
          </div>
        </dialog>
      )}
    </div>
  )
}

function webhookStatus(status: DashboardWebhook['status']) {
  switch (status) {
    case 'queued': return 'Wartet auf Runner'
    case 'running': return 'In Arbeit'
    case 'completed': return 'Abgeschlossen'
    case 'message_uncertain': return 'GitHub-Antwort ungeklärt'
  }
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)
}

function formatPlan(value: string) {
  return value.replace(/(^|[_-])(\w)/g, (_, separator: string, character: string) => `${separator}${character.toUpperCase()}`)
}

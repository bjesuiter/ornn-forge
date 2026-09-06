import { useEffect, useRef, useState } from 'react'
import './forge-designs.css'

export type ForgeDesign = 'forge' | 'hall' | 'grove'
export const forgeDesigns = [
  { id: 'forge', name: 'Vulkanschmiede', note: 'Basalt · Kupfer · Glut' },
  { id: 'hall', name: 'Halle des Donners', note: 'Stein · Silber · Eislicht' },
  { id: 'grove', name: 'Ahnenholz', note: 'Wald · Runen · Blütenlicht' },
] as const

type View = 'overview' | 'jobs' | 'artifacts' | 'runners'
const views: { id: View; name: string; symbol: string }[] = [
  { id: 'overview', name: 'Übersicht', symbol: '◈' },
  { id: 'jobs', name: 'Jobs', symbol: '☷' },
  { id: 'artifacts', name: 'Artifacts', symbol: '◇' },
  { id: 'runners', name: 'Runner', symbol: '⌁' },
]
const jobs = [
  {
    id: 'job_1042',
    title: 'Dashboard neu gestalten',
    repo: 'ornn-forge',
    issue: '#42',
    state: 'running',
    label: 'In Arbeit',
    description:
      'Ornn untersucht die Navigation und erarbeitet einen Vorschlag für das Dashboard.',
    cleanup: 'Ausstehend',
    artifact: null,
  },
  {
    id: 'job_1041',
    title: 'Runner-Verbindung prüfen',
    repo: 'ornn-forge',
    issue: '#41',
    state: 'pending',
    label: 'Wartet',
    description:
      'Die Work order ist vorbereitet. Dieser Job wartet auf freie Runner capacity.',
    cleanup: 'Keine Sandbox angelegt',
    artifact: null,
  },
  {
    id: 'job_1040',
    title: 'GitHub-Nachrichten nachvollziehbar machen',
    repo: 'ornn-forge',
    issue: '#40',
    state: 'succeeded',
    label: 'Erfolgreich',
    description:
      'Die Analyse ist abgeschlossen. Das Analysis artifact enthält die betroffenen Verträge und einen Implementierungsplan.',
    cleanup: 'Verifiziert',
    artifact: 'Analyse zur Nachrichtenverfolgung',
  },
  {
    id: 'job_1039',
    title: 'Sandbox-Cleanup untersuchen',
    repo: 'ornn-forge',
    issue: '#39',
    state: 'succeeded',
    label: 'Erfolgreich',
    description:
      'Die Analyse ist abgeschlossen. Der Sandbox-Cleanup ist noch ausstehend; die Capacity reservation bleibt bestehen.',
    cleanup: 'Ausstehend',
    artifact: 'Analyse zum Sandbox-Cleanup',
  },
] as const

type Job = (typeof jobs)[number]

export function ForgeDesigns({
  design,
  onDesignChange,
  onSignOut,
}: {
  design: ForgeDesign
  onDesignChange: (design: ForgeDesign) => void
  onSignOut: () => Promise<void>
}) {
  const [view, setView] = useState<View>('overview')
  const [filter, setFilter] = useState('all')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [signOutError, setSignOutError] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const activeDesign =
    forgeDesigns.find((item) => item.id === design) ?? forgeDesigns[0]
  const visibleJobs =
    filter === 'all' ? jobs : jobs.filter((job) => job.state === filter)

  function changeView(next: View) {
    setView(next)
    setSelectedJob(null)
  }

  async function signOut() {
    setSigningOut(true)
    setSignOutError(false)
    try {
      await onSignOut()
    } catch {
      setSignOutError(true)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className={`fd fd-${design}`} lang="de">
      <a className="fd-skip" href="#fd-main">
        Zum Inhalt
      </a>
      <div className="fd-design-bar">
        <span className="fd-preview-label">
          <a href="/dashboard">← Dashboard</a>
          <span className="fd-preview-divider">/</span>{' '}
          <span>Beispieldaten</span>
        </span>
        <label className="fd-design-select">
          Design ansehen
          <select
            value={design}
            onChange={(event) =>
              onDesignChange(event.target.value as ForgeDesign)
            }
          >
            {forgeDesigns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fd-layout">
        <header className="fd-navigation">
          <a
            href="#fd-main"
            className="fd-brand"
            onClick={() => changeView('overview')}
            aria-label="Ornn Forge Übersicht"
          >
            <img src="/favicon.png" width="40" height="40" alt="" />
            <span>
              ORNN<span>FORGE</span>
            </span>
          </a>
          <span className="fd-nav-caption">Deine Werkstatt</span>
          <nav aria-label="Hauptnavigation">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'is-active' : ''}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => changeView(item.id)}
              >
                <span aria-hidden="true">{item.symbol}</span>
                {item.name}
                {item.id === 'jobs' && (
                  <span className="fd-count">{jobs.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="fd-operator">
            <span className="fd-avatar" aria-hidden="true">
              O
            </span>
            <span>
              Operator<small>Private Werkstatt</small>
            </span>
            <button
              type="button"
              aria-label="Abmelden"
              title="Abmelden"
              disabled={signingOut}
              onClick={signOut}
            >
              ↪
            </button>
          </div>
        </header>

        <main id="fd-main" className="fd-main" tabIndex={-1}>
          <div className="fd-topline">
            <span>
              Werkstatt <span aria-hidden="true">/</span>{' '}
              {views.find((item) => item.id === view)?.name}
            </span>
            <span className="fd-topline-note">{activeDesign.note}</span>
          </div>
          {signOutError && (
            <p role="alert" className="fd-error">
              Abmelden fehlgeschlagen. Bitte versuche es erneut.
            </p>
          )}
          {view === 'overview' ? (
            <>
              <section className="fd-hero" aria-labelledby="fd-title">
                <div className="fd-hero-copy">
                  <p className="fd-kicker">
                    {design === 'forge'
                      ? 'Aus Ideen werden Meisterwerke'
                      : design === 'hall'
                        ? 'Mit Ruhe. Mit Sorgfalt.'
                        : 'Raum für gute Arbeit'}
                  </p>
                  <h1 id="fd-title">
                    {design === 'forge' ? (
                      <>
                        Die Schmiede
                        <br />
                        ist erwacht.
                      </>
                    ) : design === 'hall' ? (
                      <>
                        Große Ideen.
                        <br />
                        Solides Handwerk.
                      </>
                    ) : (
                      <>
                        Hier wächst
                        <br />
                        dein nächstes Werk.
                      </>
                    )}
                  </h1>
                  <p className="fd-hero-description">
                    Deine Jobs, ihre Fortschritte und Ergebnisse.
                    <br className="fd-desktop-break" /> Alles an einem Ort.
                  </p>
                  <button
                    type="button"
                    className="fd-primary"
                    onClick={() => changeView('jobs')}
                  >
                    Jobs ansehen <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <div
                  className="fd-hero-art"
                  role="img"
                  aria-label={
                    design === 'forge'
                      ? 'Ornn schmiedet glühendes Metall in seiner Vulkanschmiede'
                      : design === 'hall'
                        ? 'Donnerfürst Ornn mit Hammer im blauen Blitzlicht'
                        : 'Ahnenholz-Ornn zwischen leuchtenden Blättern und alten Bäumen'
                  }
                />
                <span className="fd-art-caption">
                  {design === 'forge'
                    ? 'Die Wiege des Feuers'
                    : design === 'hall'
                      ? 'Die Kraft der Berge'
                      : 'Im Herzen des Ahnenwalds'}
                </span>
              </section>
              <div className="fd-overview-body">
                <div className="fd-workspace">
                  <div
                    className="fd-metrics"
                    role="group"
                    aria-label="Beispielübersicht"
                  >
                    <div>
                      <span>In Arbeit</span>
                      <strong>
                        01<small>Job</small>
                      </strong>
                    </div>
                    <div>
                      <span>Wartet auf Runner</span>
                      <strong>
                        01<small>Job</small>
                      </strong>
                    </div>
                    <div>
                      <span>Artifacts bereit</span>
                      <strong>
                        02<small>Ergebnisse</small>
                      </strong>
                    </div>
                  </div>
                  <section
                    className="fd-section"
                    aria-labelledby="fd-jobs-heading"
                  >
                    <div className="fd-section-heading">
                      <h2 id="fd-jobs-heading">In deiner Schmiede</h2>
                      <button
                        type="button"
                        className="fd-text-button"
                        onClick={() => changeView('jobs')}
                      >
                        Alle Jobs <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                    <JobRows
                      items={jobs.slice(0, 3)}
                      onSelect={setSelectedJob}
                    />
                  </section>
                </div>
                <aside className="fd-runner-card">
                  <div className="fd-section-heading">
                    <span className="fd-kicker">Runner</span>
                    <span className="fd-online">Verbunden</span>
                  </div>
                  <span className="fd-runner-symbol" aria-hidden="true">
                    ⌁
                  </span>
                  <h2>homeserv1</h2>
                  <p>
                    Dein Handwerk.
                    <br />
                    Deine Maschine.
                  </p>
                  <div className="fd-capacity">
                    <span>Runner capacity</span>
                    <strong>2 / 3 belegt</strong>
                  </div>
                  <div className="fd-capacity-track" aria-hidden="true">
                    <span />
                  </div>
                  <small>1 Job aktiv · 1 Cleanup ausstehend</small>
                  <button
                    type="button"
                    className="fd-text-button"
                    onClick={() => changeView('runners')}
                  >
                    Runner ansehen <span aria-hidden="true">↗</span>
                  </button>
                </aside>
              </div>
            </>
          ) : (
            <>
              <div className="fd-page-heading">
                <p className="fd-kicker">Deine Werkstatt</p>
                <h1>{views.find((item) => item.id === view)?.name}</h1>
                <p>
                  {view === 'jobs'
                    ? 'Jede Work order. Jeder Fortschritt. Jedes Ergebnis.'
                    : view === 'artifacts'
                      ? 'Die Ergebnisse deiner abgeschlossenen Analysen.'
                      : 'Hier führen deine Maschinen Jobs aus.'}
                </p>
              </div>
              {view === 'jobs' && (
                <section className="fd-section">
                  <div className="fd-section-heading">
                    <h2>
                      Alle Jobs{' '}
                      <span className="fd-muted">{visibleJobs.length}</span>
                    </h2>
                    <label className="fd-filter">
                      Status{' '}
                      <select
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                      >
                        <option value="all">Alle</option>
                        <option value="running">In Arbeit</option>
                        <option value="pending">Wartet</option>
                        <option value="succeeded">Erfolgreich</option>
                      </select>
                    </label>
                  </div>
                  <JobRows items={visibleJobs} onSelect={setSelectedJob} />
                </section>
              )}
              {view === 'artifacts' && (
                <div className="fd-artifacts">
                  {jobs
                    .filter((job) => job.artifact)
                    .map((job) => (
                      <button
                        type="button"
                        key={job.id}
                        onClick={() => setSelectedJob(job)}
                      >
                        <span className="fd-artifact-icon" aria-hidden="true">
                          ◇
                        </span>
                        <span className="fd-kicker">Analysis artifact</span>
                        <h2>{job.artifact}</h2>
                        <p>
                          {job.repo} · {job.issue}
                        </p>
                        <span className="fd-text-button">
                          Ergebnis ansehen ↗
                        </span>
                      </button>
                    ))}
                </div>
              )}
              {view === 'runners' && (
                <section className="fd-detail">
                  <div className="fd-section-heading">
                    <h2>homeserv1</h2>
                    <span className="fd-online">Verbunden</span>
                  </div>
                  <p>Remote Runner · 2 von 3 Capacity reservations belegt</p>
                  <dl>
                    <div>
                      <dt>Aktiver Job</dt>
                      <dd>job_1042</dd>
                    </div>
                    <div>
                      <dt>Cleanup ausstehend</dt>
                      <dd>job_1039</dd>
                    </div>
                    <div>
                      <dt>Freie Kapazität</dt>
                      <dd>1</dd>
                    </div>
                  </dl>
                  <p>
                    Ein Job behält seine Capacity reservation, bis der
                    Sandbox-Cleanup verifiziert ist.
                  </p>
                </section>
              )}
            </>
          )}
          {selectedJob && (
            <JobDetail job={selectedJob} onClose={() => setSelectedJob(null)} />
          )}
          <footer className="fd-footer">
            <span>
              Ornn Forge <span aria-hidden="true">✧</span> Mit Sorgfalt
              geschmiedet.
            </span>
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
    </div>
  )
}

function Status({ job }: { job: Job }) {
  return (
    <span className={`fd-status fd-status-${job.state}`}>
      <span aria-hidden="true" />
      {job.label}
    </span>
  )
}

function JobRows({
  items,
  onSelect,
}: {
  items: readonly Job[]
  onSelect: (job: Job) => void
}) {
  return (
    <div className="fd-job-list">
      {items.map((job) => (
        <button
          key={job.id}
          className="fd-job"
          type="button"
          onClick={() => onSelect(job)}
        >
          <span className="fd-job-symbol" aria-hidden="true">
            {job.state === 'succeeded'
              ? '✓'
              : job.state === 'running'
                ? '✧'
                : '·'}
          </span>
          <span className="fd-job-text">
            <strong>{job.title}</strong>
            <span>
              {job.repo} <span className="fd-issue">{job.issue}</span>{' '}
              <span className="fd-dot">·</span> Analyze
            </span>
          </span>
          <Status job={job} />
          <span className="fd-row-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      ))}
    </div>
  )
}

function JobDetail({ job, onClose }: { job: Job; onClose: () => void }) {
  const detail = useRef<HTMLElement>(null)
  useEffect(() => {
    detail.current?.focus()
  }, [job.id])
  return (
    <section
      ref={detail}
      tabIndex={-1}
      className="fd-detail"
      aria-labelledby="fd-detail-title"
    >
      <div className="fd-section-heading">
        <span className="fd-kicker">Job-Details · Beispiel</span>
        <button className="fd-text-button" type="button" onClick={onClose}>
          Schließen ×
        </button>
      </div>
      <h2 id="fd-detail-title">{job.title}</h2>
      <p>{job.description}</p>
      <dl>
        <div>
          <dt>Job</dt>
          <dd>{job.id}</dd>
        </div>
        <div>
          <dt>Ausführung</dt>
          <dd>
            <Status job={job} />
          </dd>
        </div>
        <div>
          <dt>Cleanup</dt>
          <dd>{job.cleanup}</dd>
        </div>
        <div>
          <dt>Flow</dt>
          <dd>Analyze</dd>
        </div>
      </dl>
      {job.artifact && (
        <div className="fd-artifact-note">
          <span className="fd-kicker">Analysis artifact</span>
          <h3>{job.artifact}</h3>
          <p>
            Beispielergebnis: Verträge prüfen, Änderungen eingrenzen und den
            Implementierungsplan auf der GitHub-Issue festhalten.
          </p>
        </div>
      )}
    </section>
  )
}

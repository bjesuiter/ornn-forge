import type { DashboardRunner } from '../dashboard-runners'
import { DashboardHeader } from './dashboard-header'
import './forge-designs.css'

export function DashboardTopology({
  runners,
  onSignOut,
}: {
  runners: DashboardRunner[]
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="fd fd-forge fd-placeholder" lang="de">
      <a className="fd-skip" href="#fd-main">Zum Inhalt</a>
      <DashboardHeader currentPage="topology" onSignOut={onSignOut} />
      <main id="fd-main" className="fd-main" tabIndex={-1}>
        <section className="fd-topology" aria-labelledby="fd-topology-title">
          <div className="fd-topology-heading">
            <p className="fd-kicker">Systemübersicht</p>
            <h1 id="fd-topology-title">Topologie</h1>
            <p>Die Control Plane verteilt Arbeit an die registrierten Remote Runner.</p>
          </div>
          <div className="fd-topology-map">
            <section className="fd-topology-control-plane" aria-labelledby="fd-control-plane-title">
              <p className="fd-topology-kind">Control Plane</p>
              <h2 id="fd-control-plane-title">Ornn Forge</h2>
              <p>Authentifiziert Invocations, verwaltet Jobs und hält den Runner-Zustand vor.</p>
            </section>
            <div className="fd-topology-link" aria-hidden="true" />
            <section className="fd-topology-runners" aria-labelledby="fd-topology-runners-title">
              <p className="fd-topology-kind">Ausführungsumgebung</p>
              <h2 id="fd-topology-runners-title">Remote Runner</h2>
              {runners.length === 0 ? (
                <p className="fd-topology-empty">Noch kein Runner ist registriert.</p>
              ) : (
                <ul>
                  {runners.map((runner) => (
                    <li key={runner.id} className="fd-topology-runner">
                      <div>
                        <h3>{runner.label}</h3>
                        <p>{runner.id}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>Verbindung</dt>
                          <dd className={runner.online ? 'is-online' : 'is-offline'}>{runner.online ? 'Online' : 'Offline'}</dd>
                        </div>
                        <div>
                          <dt>Kapazität</dt>
                          <dd>{runner.reservations} / {runner.desiredCapacity} reserviert</dd>
                        </div>
                        <div>
                          <dt>Zustand</dt>
                          <dd>{runner.paused ? 'Pausiert' : runner.ready ? 'Bereit' : 'Nicht bereit'}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}

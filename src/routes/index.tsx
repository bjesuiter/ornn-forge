import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <p className="eyebrow">Ornn Forge</p>
        <h1 id="page-title">Deployable application foundation</h1>
        <p>
          This minimal TanStack Start app is configured to run on Cloudflare
          Workers. Product workflows and Ornn business logic are intentionally
          not implemented yet.
        </p>
      </section>
    </main>
  )
}

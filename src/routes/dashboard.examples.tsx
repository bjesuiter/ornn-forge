import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { authClient } from '../auth-client'
import { ForgeDesigns, type ForgeDesign } from '../components/forge-designs'

export const Route = createFileRoute('/dashboard/examples')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { design?: ForgeDesign } => ({
    design:
      search.design === 'hall' || search.design === 'grove'
        ? search.design
        : 'forge',
  }),
  component: DashboardExamples,
})

function DashboardExamples() {
  const navigate = useNavigate()
  const { design = 'forge' } = Route.useSearch()

  async function signOut() {
    const result = await authClient.signOut()
    if (result.error) throw new Error('Sign out failed')
    await navigate({
      to: '/login',
      search: { error: undefined, returnTo: '/dashboard' },
    })
  }

  return (
    <ForgeDesigns
      design={design}
      onDesignChange={(next) => {
        void navigate({
          to: '/dashboard/examples',
          search: { design: next },
          replace: true,
          resetScroll: false,
        })
      }}
      onSignOut={signOut}
    />
  )
}

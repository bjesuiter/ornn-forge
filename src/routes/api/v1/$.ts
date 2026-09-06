import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { createCloudflareControlPlane } from '../../../control-plane.worker'

const controlPlane = ({ request }: { request: Request }) => createCloudflareControlPlane(env).fetch(request)

export const Route = createFileRoute('/api/v1/$')({
  server: { handlers: { GET: controlPlane, POST: controlPlane } },
})

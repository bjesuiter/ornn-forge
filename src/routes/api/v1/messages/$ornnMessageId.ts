import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { createCloudflareControlPlane } from '../../../../control-plane.worker'

export const Route = createFileRoute('/api/v1/messages/$ornnMessageId')({
  server: {
    handlers: {
      GET: ({ request }) => createCloudflareControlPlane(env).fetch(request),
    },
  },
})

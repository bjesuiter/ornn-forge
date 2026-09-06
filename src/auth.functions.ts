import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { auth } from './auth.server'

export const hasDashboardSession = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return Boolean(await auth.api.getSession({ headers: getRequestHeaders() }))
})

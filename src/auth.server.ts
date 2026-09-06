import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { allowsDashboardSession } from './dashboard-access'

const dayInSeconds = 60 * 60 * 24

export const auth = betterAuth({
  database: env.ORNN_D1,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  account: {
    encryptOAuthTokens: true,
  },
  session: {
    expiresIn: dayInSeconds,
    disableSessionRefresh: true,
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  user: {
    validateUserInfo: ({ source }) => {
      const githubId = source.oauth?.profile?.id

      if (
        source.oauth?.providerId !== 'github' ||
        (typeof githubId !== 'string' && typeof githubId !== 'number') ||
        !allowsDashboardSession(githubId, env.DASHBOARD_OPERATOR_GITHUB_IDS)
      ) {
        return {
          error: 'dashboard_access_denied',
          errorDescription: 'This GitHub account is not allowed to access the dashboard.',
        }
      }
    },
  },
  plugins: [tanstackStartCookies()],
})

import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { allowsDashboardSession, recordRejectedDashboardLogin } from './dashboard-access'

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
    validateUserInfo: async ({ source }) => {
      const githubId = source.oauth?.profile?.id
      const githubLogin = source.oauth?.profile?.login
      const isGitHubProfile = source.oauth?.providerId === 'github'
        && (typeof githubId === 'string' || typeof githubId === 'number')
      const isAllowed = isGitHubProfile
        && allowsDashboardSession(githubId, env.DASHBOARD_OPERATOR_GITHUB_IDS)

      if (!isAllowed) {
        if (isGitHubProfile && typeof githubLogin === 'string') {
          await recordRejectedDashboardLogin(env.ORNN_D1, {
            githubId,
            githubLogin,
            reason: 'github-id-not-allowed',
          })
        }

        return {
          error: 'dashboard_access_denied',
          errorDescription: 'This GitHub account is not allowed to access the dashboard.',
        }
      }
    },
  },
  plugins: [tanstackStartCookies()],
})

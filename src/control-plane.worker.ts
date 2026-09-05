import { createControlPlane, createD1InvocationStore } from './control-plane'

export function createCloudflareControlPlane(env: Cloudflare.Env) {
  return createControlPlane({
    store: createD1InvocationStore(env.ORNN_D1),
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubInstallationId: env.GITHUB_APP_INSTALLATION_ID,
    githubRepositoryId: env.GITHUB_REPOSITORY_ID,
    githubRepositoryFullName: env.GITHUB_REPOSITORY_FULL_NAME,
    operatorBearerSecret: env.OPERATOR_BEARER_SECRET,
  })
}

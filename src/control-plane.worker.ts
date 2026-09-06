import { createControlPlane, createD1InvocationStore } from './control-plane'
import { createGitHubMessagePublisher } from './github-message-publisher'

export function createCloudflareControlPlane(env: Cloudflare.Env) {
  return createControlPlane({
    store: createD1InvocationStore(env.ORNN_D1),
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubInstallationId: env.GITHUB_APP_INSTALLATION_ID,
    githubRepositoryId: env.GITHUB_REPOSITORY_ID,
    githubRepositoryFullName: env.GITHUB_REPOSITORY_FULL_NAME,
    operatorBearerSecret: env.OPERATOR_BEARER_SECRET,
    runnerCredentialId: env.ORNN_RUNNER_CREDENTIAL_ID,
    runnerCredentialSecret: env.ORNN_RUNNER_CREDENTIAL_SECRET,
    messagePublisher: createGitHubMessagePublisher({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
      repositoryId: env.GITHUB_REPOSITORY_ID,
    }),
  })
}

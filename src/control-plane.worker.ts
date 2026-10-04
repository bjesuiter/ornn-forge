import { createControlPlane, createD1InvocationStore } from './control-plane'
import { createGitHubMessagePublisher } from './github-message-publisher'
import { githubAppCredentials } from './github-configuration'

export function createCloudflareControlPlane(env: Cloudflare.Env) {
  const github = githubAppCredentials(env)
  return createControlPlane({
    store: createD1InvocationStore(env.ORNN_D1),
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
    githubInstallationId: env.GITHUB_APP_INSTALLATION_ID,
    githubRepositoryId: env.GITHUB_REPOSITORY_ID,
    githubRepositoryFullName: env.GITHUB_REPOSITORY_FULL_NAME,
    githubAdditionalRepositories: github.repositories.slice(1),
    operatorBearerSecret: env.OPERATOR_BEARER_SECRET,
    runnerConnection: { connect: (runnerId, request) => env.RUNNER_CONNECTION.getByName(runnerId).fetch(request) },
    notifyRunner: async (runnerId) => {
      await env.RUNNER_CONNECTION.getByName(runnerId).fetch(new Request('https://runner.internal/command', {
        method: 'POST', headers: { 'x-ornn-runner-id': runnerId },
      }))
    },
    messagePublisher: createGitHubMessagePublisher(github),
  })
}

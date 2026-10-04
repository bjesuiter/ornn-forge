import type { GitHubAppCredentials, GitHubRepository } from './github-message-publisher'

export function configuredGitHubRepositories(env: Cloudflare.Env): GitHubRepository[] {
  const additional: unknown = JSON.parse(env.GITHUB_ADDITIONAL_REPOSITORIES)
  if (!Array.isArray(additional)) throw new Error('GITHUB_ADDITIONAL_REPOSITORIES must be an array')

  const repositories: GitHubRepository[] = [
    { id: env.GITHUB_REPOSITORY_ID, fullName: env.GITHUB_REPOSITORY_FULL_NAME },
  ]
  for (const value of additional) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid additional GitHub repository')
    const repository = value as Record<string, unknown>
    if (typeof repository.id !== 'string' || typeof repository.fullName !== 'string') throw new Error('Invalid additional GitHub repository')
    repositories.push({ id: repository.id, fullName: repository.fullName })
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  for (const repository of repositories) {
    if (!/^\d+$/.test(repository.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.fullName)
      || ids.has(repository.id) || names.has(repository.fullName)) {
      throw new Error('Invalid or duplicate GitHub repository configuration')
    }
    ids.add(repository.id)
    names.add(repository.fullName)
  }
  return repositories
}

export function githubAppCredentials(env: Cloudflare.Env): GitHubAppCredentials {
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    repositories: configuredGitHubRepositories(env),
  }
}

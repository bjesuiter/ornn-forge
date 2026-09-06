import { createGitHubInstallationToken, type GitHubAppCredentials } from './github-message-publisher'

export type RepositoryCheckout = {
  repository: string
  revision: string
  archiveUrl: string
  token: string
  expiresAt: string
}

export function createGitHubRepositoryCheckout(credentials: GitHubAppCredentials, request: typeof fetch = fetch) {
  return {
    async resolve(repository: string): Promise<RepositoryCheckout> {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository must be owner/name')
      const credential = await createGitHubInstallationToken(credentials, { contents: 'read' }, request)
      const headers = githubHeaders(credential.token)
      const repositoryResponse = await request(`https://api.github.com/repos/${repository}`, { headers })
      if (!repositoryResponse.ok) throw new Error(`GitHub repository lookup failed: ${repositoryResponse.status}`)
      const repositoryBody = await repositoryResponse.json() as { default_branch?: unknown }
      if (typeof repositoryBody.default_branch !== 'string' || repositoryBody.default_branch.length === 0) throw new Error('GitHub repository did not report a default branch')
      const refResponse = await request(`https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(repositoryBody.default_branch)}`, { headers })
      if (!refResponse.ok) throw new Error(`GitHub repository revision lookup failed: ${refResponse.status}`)
      const refBody = await refResponse.json() as { object?: { type?: unknown; sha?: unknown } }
      if (refBody.object?.type !== 'commit' || typeof refBody.object.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(refBody.object.sha)) {
        throw new Error('GitHub repository revision was not a commit SHA')
      }
      return {
        repository,
        revision: refBody.object.sha,
        archiveUrl: `https://api.github.com/repos/${repository}/tarball/${refBody.object.sha}`,
        token: credential.token,
        expiresAt: credential.expiresAt,
      }
    },
  }
}

function githubHeaders(token: string): HeadersInit {
  return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'ornn-forge', 'x-github-api-version': '2022-11-28' }
}

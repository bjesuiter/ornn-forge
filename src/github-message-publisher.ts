import type { OrnnMessagePublisher } from './control-plane'

export function createGitHubMessagePublisher(token: string, request: typeof fetch = fetch): OrnnMessagePublisher {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'ornn-forge',
  }
  return {
    async reconcile({ repository, issueNumber, effectKey, githubCommentId, body }) {
      if (!githubCommentId) return findEffectComment(repository, issueNumber, effectKey, body, request, headers)
      const response = await request(`https://api.github.com/repos/${repository}/issues/comments/${githubCommentId}`, { headers })
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`GitHub comment reconciliation failed: ${response.status}`)
      const comment = await response.json() as { id?: number; body?: string }
      return comment.body === body && comment.id !== undefined
        ? { githubCommentId: String(comment.id) }
        : undefined
    },
    async create({ repository, issueNumber, body }) {
      const response = await request(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`, {
        method: 'POST', headers, body: JSON.stringify({ body }),
      })
      if (!response.ok) throw new Error(`GitHub comment creation failed: ${response.status}`)
      const comment = await response.json() as { id?: number }
      if (comment.id === undefined) throw new Error('GitHub comment creation returned no comment ID')
      return { githubCommentId: String(comment.id) }
    },
    async update({ repository, githubCommentId, body }) {
      const response = await request(`https://api.github.com/repos/${repository}/issues/comments/${githubCommentId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ body }),
      })
      if (!response.ok) throw new Error(`GitHub comment update failed: ${response.status}`)
    },
  }
}

async function findEffectComment(
  repository: string,
  issueNumber: number,
  effectKey: string,
  body: string,
  request: typeof fetch,
  headers: HeadersInit,
): Promise<{ githubCommentId: string } | undefined> {
  let url: string | undefined = `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments?per_page=100`
  while (url) {
    const response = await request(url, { headers })
    if (!response.ok) throw new Error(`GitHub comment listing failed: ${response.status}`)
    const comments = await response.json() as Array<{ id?: number; body?: string }>
    const match = comments.find((comment) => comment.id !== undefined && comment.body === body)
    if (match?.id !== undefined) return { githubCommentId: String(match.id) }
    url = nextPage(response.headers.get('link'))
  }
  return undefined
}

function nextPage(link: string | null): string | undefined {
  return link?.split(',').map((part) => part.trim()).find((part) => part.endsWith('rel="next"'))?.match(/^<([^>]+)>/)?.[1]
}

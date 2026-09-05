import { expect, test } from 'bun:test'
import { createGitHubMessagePublisher } from './github-message-publisher'

test('GitHub message publisher creates, updates, and finds only the rendered effect', async () => {
  const calls: Array<{ url: string; method: string }> = []
  const body = 'Ornn message\n<!-- ornn-effect:github-message:job_v1_a -->'
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' })
    if (String(input).includes('/comments?')) return Response.json([{ id: 17, body }], { headers: { link: '' } })
    if (init?.method === 'POST') return Response.json({ id: 18 }, { status: 201 })
    if (init?.method === 'PATCH') return Response.json({ id: 17 })
    return Response.json({ id: 17, body })
  }) as typeof fetch
  const publisher = createGitHubMessagePublisher('token', request)

  await expect(publisher.reconcile({ repository: 'bjesuiter/ornn-forge', issueNumber: 23, effectKey: 'github-message:job_v1_a', body }))
    .resolves.toEqual({ githubCommentId: '17' })
  await expect(publisher.create({ repository: 'bjesuiter/ornn-forge', issueNumber: 23, effectKey: 'github-message:job_v1_a', body })).resolves.toEqual({ githubCommentId: '18' })
  await expect(publisher.update({ repository: 'bjesuiter/ornn-forge', githubCommentId: '17', effectKey: 'github-message:job_v1_a', body })).resolves.toBeUndefined()
  expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'PATCH'])
})

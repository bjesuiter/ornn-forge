export { RunnerConnection } from '../src/runner-connection'

export default {
  fetch(request: Request, environment: Cloudflare.Env): Promise<Response> {
    const runnerId = request.headers.get('x-ornn-runner-id')
    if (!runnerId) return Promise.resolve(new Response('Runner identity required', { status: 401 }))
    return environment.RUNNER_CONNECTION.getByName(runnerId).fetch(request)
  },
}

import { request } from 'node:http'

export async function checkDocker(endpoint = process.env.DOCKER_HOST): Promise<void> {
  if (!endpoint?.startsWith('unix://')) throw new Error('DOCKER_HOST must be a unix:// endpoint')

  const socketPath = new URL(endpoint).pathname
  await new Promise<void>((resolve, reject) => {
    const probe = request({ socketPath, path: '/_ping' }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode === 200 && body.trim() === 'OK') return resolve()
        reject(new Error(`Docker ping failed with ${response.statusCode ?? 'no'} status`))
      })
    })

    probe.setTimeout(5_000, () => probe.destroy(new Error('Docker ping timed out')))
    probe.on('error', reject)
    probe.end()
  })
}

if (import.meta.main) await checkDocker()

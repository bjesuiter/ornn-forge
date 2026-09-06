import { expect, test } from 'bun:test'
import { createDockerCliGateway } from './docker-gateway'

test('the Docker CLI gateway aborts an in-flight exec when its deadline expires', async () => {
  let receivedSignal: AbortSignal | undefined
  const gateway = createDockerCliGateway(async (_arguments, _input, signal?: AbortSignal) => {
    receivedSignal = signal
    await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }
  })

  await expect(gateway.exec('container-123', ['sleep', 'infinity'], { timeoutMs: 1 })).rejects.toThrow('aborted')
  expect(receivedSignal?.aborted).toBe(true)
})

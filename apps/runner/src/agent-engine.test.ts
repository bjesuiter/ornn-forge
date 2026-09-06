import { expect, test } from 'bun:test'
import type { AnalysisArtifact, LeaseGrant } from '@ornn-forge/protocol'
import { createDeterministicAgentEngine, type AgentEngine, type EngineTools } from './agent-engine'

const workOrder: LeaseGrant['workOrder'] = {
  issueNumber: 22,
  title: 'Inspect the repository',
  body: 'Find the smallest safe plan.',
  comment: '@ornn analyze',
}

const artifact: AnalysisArtifact = {
  schemaVersion: 1,
  kind: 'plan',
  summary: 'Ready for implementation',
  details: 'The deterministic engine found no blocker.',
}

test('an AgentEngine returns one structured artifact without receiving sandbox or repository-provider access', async () => {
  const engine = createDeterministicAgentEngine(artifact)
  const tools: EngineTools = {
    async readFile() { throw new Error('not used') },
    async writeFile() { throw new Error('not used') },
    async searchText() { throw new Error('not used') },
    async exec() { throw new Error('not used') },
  }

  const events = await collect(engine, tools)

  expect(events).toEqual([
    { type: 'progress', phase: 'started' },
    { type: 'artifact', artifact },
  ])
})

async function collect(engine: AgentEngine, tools: EngineTools) {
  const events = []
  for await (const event of engine.run({
    jobId: 'job_v1_abcdefghijklmnopqrstuv', workOrder, tools,
    toolPolicy: { read: true, write: false, search: true, command: true },
    signal: new AbortController().signal,
  })) events.push(event)
  return events
}

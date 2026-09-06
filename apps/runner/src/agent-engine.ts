import type { AnalysisArtifact, LeaseGrant } from '@ornn-forge/protocol'

export type ToolPolicy = {
  read: boolean
  write: boolean
  search: boolean
  command: boolean
}

export type EngineTools = {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  searchText(query: string): Promise<readonly { path: string; line: number; text: string }[]>
  exec(command: readonly string[]): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>
}

export type AgentEvent =
  | { type: 'progress'; phase: 'started' | 'thinking' | 'tool_call' }
  | { type: 'artifact'; artifact: AnalysisArtifact }

export interface AgentEngine {
  run(input: {
    jobId: string
    workOrder: LeaseGrant['workOrder']
    toolPolicy: ToolPolicy
    tools: EngineTools
    signal: AbortSignal
  }): AsyncIterable<AgentEvent>
}

export function createDeterministicAgentEngine(artifact: AnalysisArtifact): AgentEngine {
  return {
    async *run() {
      yield { type: 'progress', phase: 'started' }
      yield { type: 'artifact', artifact }
    },
  }
}

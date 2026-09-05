export type ExecutionOutcome = {
  status: 'succeeded' | 'failed' | 'cancelled'
  completedAt: string
}

export type CleanupStatus = {
  status: 'pending' | 'verified' | 'failed'
  updatedAt: string
}

export type OrnnMessageState = {
  id: string
  revision: number
  effectKey: string
  githubCommentId?: string
  latestAttempt: 'pending' | 'succeeded' | 'uncertain' | 'failed'
}

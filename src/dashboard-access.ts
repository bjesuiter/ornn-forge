export function allowsDashboardSession(githubId: string | number, configuredGitHubIds: string): boolean {
  return configuredGitHubIds.split(',').some((configuredId) => configuredId.trim() === String(githubId))
}

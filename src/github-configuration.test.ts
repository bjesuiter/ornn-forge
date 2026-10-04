import { expect, test } from 'bun:test'
import { configuredGitHubRepositories } from './github-configuration'

const environment = {
  GITHUB_REPOSITORY_ID: '1296836371',
  GITHUB_REPOSITORY_FULL_NAME: 'bjesuiter/ornn-forge',
  GITHUB_ADDITIONAL_REPOSITORIES: '[{"id":"930524684","fullName":"bjesuiter/bgf-wlan-translation-v5"}]',
} as Cloudflare.Env

test('accepts only distinct, explicit GitHub repository identities', () => {
  expect(configuredGitHubRepositories(environment)).toEqual([
    { id: '1296836371', fullName: 'bjesuiter/ornn-forge' },
    { id: '930524684', fullName: 'bjesuiter/bgf-wlan-translation-v5' },
  ])
  expect(() => configuredGitHubRepositories({ ...environment,
    GITHUB_ADDITIONAL_REPOSITORIES: '[{"id":"1296836371","fullName":"bjesuiter/other"}]',
  })).toThrow('duplicate')
  expect(() => configuredGitHubRepositories({ ...environment,
    GITHUB_ADDITIONAL_REPOSITORIES: '[{"id":"930524684","fullName":"bjesuiter/ornn-forge"}]',
  })).toThrow('duplicate')
})

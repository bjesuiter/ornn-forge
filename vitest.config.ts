import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest({
    main: './test/worker.ts',
    wrangler: { configPath: './wrangler.jsonc' },
  })],
  test: { include: ['test/**/*.integration.ts'] },
})

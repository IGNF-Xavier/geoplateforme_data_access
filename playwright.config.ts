import { defineConfig } from '@playwright/test'

/**
 * Les scénarios E2E interrogent les VRAIES APIs de la Géoplateforme (réseau requis).
 * Ils utilisent le Chrome installé (`channel: 'chrome'`) : aucun navigateur à télécharger.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: 1,
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', locale: 'fr-FR', acceptDownloads: true },
  webServer: { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
})

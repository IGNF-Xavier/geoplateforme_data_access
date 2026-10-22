import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  // Une seule copie d'OpenLayers : les extensions Géoplateforme en dépendent aussi.
  resolve: { dedupe: ['ol', 'proj4'] },
  optimizeDeps: { include: ['ol', 'geopf-extensions-openlayers', 'geoportal-access-lib'] },
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0])

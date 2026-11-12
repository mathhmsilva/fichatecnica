import { defineConfig, devices } from '@playwright/test';

/** Teste de ponta a ponta: o app de verdade, no celular, do primeiro acesso ao fechamento. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  use: { ...devices['Pixel 7'], locale: 'pt-BR', baseURL: 'http://localhost:4180', trace: 'off' },
  webServer: { command: 'npx vite preview --port 4180 --strictPort', url: 'http://localhost:4180', reuseExistingServer: true },
});

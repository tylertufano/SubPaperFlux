import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    exclude: [...defaultExclude, 'e2e/**/*'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})

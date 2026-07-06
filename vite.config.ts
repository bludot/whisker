/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Kept current by semantic-release bumping package.json on release.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'happy-dom',
  },
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest picks up this config for the React JSX transform in component tests.
export default defineConfig({
  plugins: [react()]
})

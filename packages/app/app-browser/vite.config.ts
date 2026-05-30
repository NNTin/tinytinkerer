import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow dynamic imports from the pnpm virtual store when running from a worktree
      // where node_modules are symlinked from a different directory.
      strict: false
    }
  }
})

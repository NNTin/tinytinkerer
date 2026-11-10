import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served under /embed-host/ by the Playwright acceptance spec.
export default defineConfig({
  base: './',
  plugins: [react()]
})

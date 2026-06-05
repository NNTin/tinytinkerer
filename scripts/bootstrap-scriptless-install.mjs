import { execFileSync } from 'node:child_process'

const run = (command, args, options = {}) => {
  console.log(`$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

// CI installs with --ignore-scripts. These packages have reviewed native/CLI
// lifecycle scripts and are explicitly allowlisted in pnpm-workspace.yaml, so
// rebuild only them before jobs that need their binaries at runtime.
run('pnpm', ['rebuild', 'sharp', 'esbuild', 'workerd', '@sentry/cli'])

run('node', ['-e', "await import('sharp'); console.log('sharp ok')"])
run('pnpm', ['--filter', '@tinytinkerer/edge', 'exec', 'workerd', '--version'])
run('pnpm', ['--filter', '@tinytinkerer/edge', 'exec', 'sentry-cli', '--version'])

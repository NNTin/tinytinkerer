import { spawnSync } from 'node:child_process'

const generatedPort = !process.env.E2E_PORT
const port = process.env.E2E_PORT ?? String(40000 + Math.floor(Math.random() * 20000))
const executable = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
const result = spawnSync(executable, ['test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_PORT: port,
    E2E_PORT_GENERATED: generatedPort ? '1' : ''
  }
})

if (result.signal) {
  process.kill(process.pid, result.signal)
}

process.exit(result.status ?? 1)

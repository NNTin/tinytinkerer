import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readAppVersion = () => {
  try {
    const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const readBuildHash = () => {
  const fromEnv = process.env.GIT_SHA?.trim()
  if (fromEnv) {
    return fromEnv.slice(0, 7)
  }
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

/**
 * Resolves the build-time metadata injected into the client bundles.
 * `GIT_SHA` (set in CI) takes precedence over a local `git rev-parse`.
 */
export const getBuildInfo = () => ({
  appVersion: readAppVersion(),
  buildHash: readBuildHash()
})

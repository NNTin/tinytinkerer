import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(currentDir, '../../..')
const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')

const hostDistDir = join(workspaceRoot, 'apps/host/dist')
const hostPublicDir = join(workspaceRoot, 'apps/host/public')
const webDistDir = join(workspaceRoot, 'apps/web/dist')
const widgetDistDir = join(workspaceRoot, 'apps/widget/dist')
const mobileDistDir = join(workspaceRoot, 'apps/mobile/dist')

await rm(hostDistDir, { recursive: true, force: true })
await mkdir(hostDistDir, { recursive: true })
await mkdir(join(hostDistDir, 'web'), { recursive: true })
await mkdir(join(hostDistDir, 'widget'), { recursive: true })
await mkdir(join(hostDistDir, 'mobile'), { recursive: true })

await cp(hostPublicDir, hostDistDir, { recursive: true })
await cp(webDistDir, join(hostDistDir, 'web'), { recursive: true })
await cp(widgetDistDir, join(hostDistDir, 'widget'), { recursive: true })
await cp(mobileDistDir, join(hostDistDir, 'mobile'), { recursive: true })

console.log(
  `Composed frontend bundles into apps/host/dist${deployBase ? ` for ${deployBase}` : ''}`
)

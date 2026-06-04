import { describe, expect, it } from 'vitest'

import {
  getStaleWorkerdPids,
  isRepoWorkerdProcess,
  parseProcessList
} from './wrangler-dev.mjs'

const rootDir = '/workspace/tinytinkerer'
const repoWorkerdCommand = `${rootDir}/node_modules/.pnpm/@cloudflare+workerd-linux-64@1.20260520.1/node_modules/@cloudflare/workerd-linux-64/bin/workerd serve --binary --experimental --socket-addr=entry=0.0.0.0:8787 --control-fd=3 -`

describe('wrangler dev process cleanup', () => {
  it('parses process list rows with long commands', () => {
    const processes = parseProcessList(`  48085     1 76544 Sl ${repoWorkerdCommand}\n`)

    expect(processes).toEqual([
      {
        pid: 48085,
        ppid: 1,
        pgid: 76544,
        stat: 'Sl',
        command: repoWorkerdCommand
      }
    ])
  })

  it('matches workerd processes launched from this checkout', () => {
    expect(
      isRepoWorkerdProcess(
        {
          pid: 48085,
          ppid: 1,
          pgid: 76544,
          stat: 'Sl',
          command: repoWorkerdCommand
        },
        rootDir
      )
    ).toBe(true)

    expect(
      isRepoWorkerdProcess(
        {
          pid: 44130,
          ppid: 43998,
          pgid: 43947,
          stat: 'Sl',
          command:
            '/workspace/worktrees/tin-39/node_modules/.pnpm/@cloudflare+workerd-linux-64@1.20260520.1/node_modules/@cloudflare/workerd-linux-64/bin/workerd serve --binary --experimental'
        },
        rootDir
      )
    ).toBe(false)
  })

  it('only returns orphaned repo-local workerd processes as stale', () => {
    const processes = [
      {
        pid: 48085,
        ppid: 1,
        pgid: 76544,
        stat: 'Sl',
        command: repoWorkerdCommand
      },
      {
        pid: 50323,
        ppid: 50225,
        pgid: 50153,
        stat: 'Sl',
        command: repoWorkerdCommand
      },
      {
        pid: 44130,
        ppid: 1,
        pgid: 43947,
        stat: 'Sl',
        command:
          '/workspace/worktrees/tin-39/node_modules/.pnpm/@cloudflare+workerd-linux-64@1.20260520.1/node_modules/@cloudflare/workerd-linux-64/bin/workerd serve --binary --experimental'
      }
    ]

    expect(getStaleWorkerdPids(processes, rootDir)).toEqual([48085])
  })
})

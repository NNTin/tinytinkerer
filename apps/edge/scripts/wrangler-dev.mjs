// @ts-check

import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const edgeDir = resolve(currentDir, '..')
const workspaceRoot = resolve(edgeDir, '../..')

const defaultWranglerArgs = ['dev', '--port', '8787', '--ip', '0.0.0.0']
const signalExitCodes = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143
}

/**
 * @typedef ProcessInfo
 * @property {number} pid
 * @property {number} ppid
 * @property {number} pgid
 * @property {string} stat
 * @property {string} command
 */

/**
 * @param {string} value
 * @returns {string}
 */
const normalizePath = (value) => value.replaceAll('\\', '/')

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
const sleep = async (milliseconds) =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })

/**
 * @param {string} output
 * @returns {ProcessInfo[]}
 */
export const parseProcessList = (output) =>
  output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)
      if (!match) {
        return undefined
      }

      const [, pid, ppid, pgid, stat, command] = match
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        pgid: Number(pgid),
        stat,
        command
      }
    })
    .filter((processInfo) => processInfo !== undefined)

/**
 * @param {string} rootDir
 * @returns {ProcessInfo[]}
 */
export const listProcesses = (rootDir = workspaceRoot) => {
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,pgid=,stat=,args=', '-ww'], {
    cwd: rootDir,
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `ps exited with status ${result.status}`)
  }

  return parseProcessList(result.stdout)
}

/**
 * @param {ProcessInfo} processInfo
 * @param {string} rootDir
 * @returns {boolean}
 */
export const isRepoWorkerdProcess = (processInfo, rootDir = workspaceRoot) => {
  const command = normalizePath(processInfo.command)
  const root = normalizePath(rootDir)

  return (
    command.includes(`${root}/node_modules/.pnpm/@cloudflare+workerd-`) &&
    command.includes('/bin/workerd serve ')
  )
}

/**
 * @param {ProcessInfo[]} processes
 * @param {string} rootDir
 * @returns {number[]}
 */
export const getStaleWorkerdPids = (processes, rootDir = workspaceRoot) =>
  processes
    .filter((processInfo) => processInfo.ppid === 1)
    .filter((processInfo) => isRepoWorkerdProcess(processInfo, rootDir))
    .map((processInfo) => processInfo.pid)

/**
 * @param {number} pid
 * @returns {boolean}
 */
const isProcessRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      return true
    }

    return false
  }
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 * @returns {void}
 */
const killPid = (pid, signal) => {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw error
    }
  }
}

/**
 * @param {number[]} pids
 * @param {{ forceAfterMs?: number }} [options]
 * @returns {Promise<void>}
 */
export const terminatePids = async (pids, { forceAfterMs = 1500 } = {}) => {
  if (pids.length === 0) {
    return
  }

  for (const pid of pids) {
    killPid(pid, 'SIGTERM')
  }

  await sleep(forceAfterMs)

  for (const pid of pids) {
    if (isProcessRunning(pid)) {
      killPid(pid, 'SIGKILL')
    }
  }
}

/**
 * @param {number} pgid
 * @param {{ forceAfterMs?: number }} [options]
 * @returns {Promise<void>}
 */
export const terminateProcessGroup = async (pgid, { forceAfterMs = 1500 } = {}) => {
  const targetPid = process.platform === 'win32' ? pgid : -pgid

  try {
    process.kill(targetPid, 'SIGTERM')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return
    }

    throw error
  }

  await sleep(forceAfterMs)

  try {
    process.kill(targetPid, 0)
    process.kill(targetPid, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw error
    }
  }
}

/**
 * @param {{ rootDir?: string }} [options]
 * @returns {Promise<number[]>}
 */
export const cleanupStaleWorkerd = async ({ rootDir = workspaceRoot } = {}) => {
  const stalePids = getStaleWorkerdPids(listProcesses(rootDir), rootDir)
  await terminatePids(stalePids)
  return stalePids
}

/**
 * @param {NodeJS.Signals | null} signal
 * @returns {number}
 */
const getExitCode = (signal) => {
  if (!signal) {
    return 1
  }

  return signalExitCodes[signal] ?? 1
}

/**
 * @param {{ cwd?: string, rootDir?: string, wranglerArgs?: string[] }} [options]
 * @returns {Promise<void>}
 */
export const runWranglerDev = async ({
  cwd = edgeDir,
  rootDir = workspaceRoot,
  wranglerArgs = defaultWranglerArgs
} = {}) => {
  const stalePids = await cleanupStaleWorkerd({ rootDir })
  if (stalePids.length > 0) {
    console.warn(`Stopped stale workerd process(es): ${stalePids.join(', ')}`)
  }

  const child = spawn('wrangler', wranglerArgs, {
    cwd,
    detached: process.platform !== 'win32',
    stdio: 'inherit'
  })

  let shuttingDown = false

  /** @param {NodeJS.Signals} signal */
  const shutdown = (signal) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    if (!child.pid) {
      process.exit(getExitCode(signal))
      return
    }

    void terminateProcessGroup(child.pid).finally(() => {
      process.exit(getExitCode(signal))
    })
  }

  process.once('SIGHUP', shutdown)
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      resolvePromise(code ?? getExitCode(signal))
    })
  })

  process.off('SIGHUP', shutdown)
  process.off('SIGINT', shutdown)
  process.off('SIGTERM', shutdown)

  if (!shuttingDown && child.pid) {
    await terminateProcessGroup(child.pid)
    await cleanupStaleWorkerd({ rootDir })
  }

  process.exit(exitCode)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runWranglerDev().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

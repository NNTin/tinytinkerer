import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MERMAID_CLI_VERSION = '11.15.0'

const listMarkdownFiles = () => {
  const output = execFileSync('git', ['ls-files', '--', '*.md'], { encoding: 'utf8' })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const extractMermaidBlocks = (content, filePath) => {
  const lines = content.split(/\r?\n/)
  const blocks = []

  let inBlock = false
  let blockStartLine = 0
  let blockLines = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (!inBlock) {
      if (/^\s*```mermaid(?:\s+.*)?\s*$/.test(line)) {
        inBlock = true
        blockStartLine = index + 1
        blockLines = []
      }
      continue
    }

    if (/^\s*```\s*$/.test(line)) {
      blocks.push({
        filePath,
        startLine: blockStartLine,
        source: blockLines.join('\n')
      })
      inBlock = false
      blockStartLine = 0
      blockLines = []
      continue
    }

    blockLines.push(line)
  }

  if (inBlock) {
    throw new Error(`Unclosed Mermaid code fence in ${filePath}:${blockStartLine}`)
  }

  return blocks
}

const resolveMmdcCommand = () => {
  const npxCheck = spawnSync('npx', ['--version'], { stdio: 'ignore' })
  if (npxCheck.status === 0) {
    return {
      command: 'npx',
      baseArgs: ['-y', '-p', `@mermaid-js/mermaid-cli@${MERMAID_CLI_VERSION}`, 'mmdc']
    }
  }

  const localCheck = spawnSync('mmdc', ['--version'], { stdio: 'ignore' })
  if (localCheck.status === 0) {
    return { command: 'mmdc', baseArgs: [] }
  }

  throw new Error(
    'Unable to find Mermaid CLI. Install mmdc or make npx available before running check:mermaid.'
  )
}

const renderBlock = (block, tempDir, mmdc) => {
  const baseName = `${basename(block.filePath).replace(/[^a-zA-Z0-9_.-]/g, '_')}-${block.startLine}`
  const inputPath = join(tempDir, `${baseName}.mmd`)
  const outputPath = join(tempDir, `${baseName}.svg`)
  const puppeteerConfigPath = join(tempDir, 'puppeteer-config.json')
  const executablePath = resolveChromeExecutablePath()

  writeFileSync(inputPath, block.source, 'utf8')
  writeFileSync(
    puppeteerConfigPath,
    JSON.stringify(
      {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(executablePath ? { executablePath } : {})
      },
      null,
      2
    ),
    'utf8'
  )

  const result = spawnSync(
    mmdc.command,
    [...mmdc.baseArgs, '-p', puppeteerConfigPath, '-i', inputPath, '-o', outputPath],
    {
      encoding: 'utf8'
    }
  )

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `Mermaid render failed in ${block.filePath}:${block.startLine}\n${details || 'Unknown Mermaid CLI error'}`
    )
  }
}

const canFallbackToParse = (error) => {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Could not find Chrome') ||
    message.includes('Failed to launch the browser process') ||
    message.includes('error while loading shared libraries')
  )
}

const parseBlock = (block) => {
  const jsdomModuleUrl = pathToFileURL(
    join(
      process.cwd(),
      'packages',
      'content',
      'renderers',
      'content-mermaid',
      'node_modules',
      'jsdom',
      'lib',
      'api.js'
    )
  ).href
  const mermaidModuleUrl = pathToFileURL(
    join(
      process.cwd(),
      'packages',
      'content',
      'renderers',
      'content-mermaid',
      'node_modules',
      'mermaid',
      'dist',
      'mermaid.core.mjs'
    )
  ).href
  const parserScript = [
    'const jsdomModuleUrl = process.argv[1]',
    'const mermaidModuleUrl = process.argv[2]',
    "const input = Buffer.from(process.argv[3] ?? '', 'base64').toString('utf8')",
    'const { JSDOM } = await import(jsdomModuleUrl)',
    "const { window } = new JSDOM('<!doctype html><html><body></body></html>')",
    'globalThis.window = window',
    'globalThis.document = window.document',
    "Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })",
    'globalThis.Element = window.Element',
    'globalThis.HTMLElement = window.HTMLElement',
    'globalThis.SVGElement = window.SVGElement',
    'const { default: mermaid } = await import(mermaidModuleUrl)',
    "mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })",
    'await mermaid.parse(input)'
  ].join('; ')

  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      parserScript,
      jsdomModuleUrl,
      mermaidModuleUrl,
      Buffer.from(block.source, 'utf8').toString('base64')
    ],
    {
      encoding: 'utf8'
    }
  )

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `Mermaid syntax validation failed in ${block.filePath}:${block.startLine}\n${details || 'Unknown Mermaid parser error'}`
    )
  }
}

const resolveChromeExecutablePath = () => {
  const candidates = [
    process.env.PUPPETEER_CACHE_DIR ? dirname(process.env.PUPPETEER_CACHE_DIR) : null,
    process.env.HOME,
    ...listAncestorDirs(process.cwd())
  ]
    .filter(
      (value, index, array) =>
        typeof value === 'string' && value.length > 0 && array.indexOf(value) === index
    )
    .flatMap((baseDir) => [
      join(baseDir, '.cache', 'puppeteer', 'chrome'),
      join(baseDir, '.cache', 'puppeteer', 'chrome-headless-shell')
    ])

  for (const root of candidates) {
    const executablePath = resolveCachedChromeExecutable(root)
    if (executablePath) {
      return executablePath
    }
  }

  return null
}

const listAncestorDirs = (startDir) => {
  const dirs = []
  let current = startDir

  while (true) {
    dirs.push(current)
    const parent = dirname(current)
    if (parent === current) {
      return dirs
    }
    current = parent
  }
}

const resolveCachedChromeExecutable = (cacheRoot) => {
  if (!existsSync(cacheRoot)) {
    return null
  }

  const builds = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

  for (const build of builds) {
    const chromePath = join(cacheRoot, build, 'chrome-linux64', 'chrome')
    if (existsSync(chromePath)) {
      return chromePath
    }

    const headlessShellPath = join(
      cacheRoot,
      build,
      'chrome-headless-shell-linux64',
      'chrome-headless-shell'
    )
    if (existsSync(headlessShellPath)) {
      return headlessShellPath
    }
  }

  return null
}

const main = () => {
  const markdownFiles = listMarkdownFiles()
  const blocks = markdownFiles.flatMap((filePath) =>
    extractMermaidBlocks(readFileSync(filePath, 'utf8'), filePath)
  )

  if (blocks.length === 0) {
    console.log('No Mermaid diagrams found in tracked Markdown files.')
    return
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'tinytinkerer-mermaid-'))
  const mmdc = resolveMmdcCommand()

  try {
    for (const block of blocks) {
      try {
        renderBlock(block, tempDir, mmdc)
      } catch (error) {
        if (!canFallbackToParse(error)) {
          throw error
        }

        parseBlock(block)
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.log(
    `Validated ${blocks.length} Mermaid diagram(s) across ${markdownFiles.length} Markdown file(s).`
  )
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const MERMAID_CLI_VERSION = '11.12.0'

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
  const localCheck = spawnSync('mmdc', ['--version'], { stdio: 'ignore' })
  if (localCheck.status === 0) {
    return { command: 'mmdc', baseArgs: [] }
  }

  const npxCheck = spawnSync('npx', ['--version'], { stdio: 'ignore' })
  if (npxCheck.status === 0) {
    return {
      command: 'npx',
      baseArgs: ['-y', '-p', `@mermaid-js/mermaid-cli@${MERMAID_CLI_VERSION}`, 'mmdc']
    }
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

  writeFileSync(inputPath, block.source, 'utf8')
  writeFileSync(
    puppeteerConfigPath,
    JSON.stringify(
      {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      renderBlock(block, tempDir, mmdc)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.log(`Validated ${blocks.length} Mermaid diagram(s) across ${markdownFiles.length} Markdown file(s).`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}

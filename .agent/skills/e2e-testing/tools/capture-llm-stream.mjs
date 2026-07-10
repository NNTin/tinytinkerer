import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// .agent/skills/e2e-testing/tools/ -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

// There is no bare `playwright` package installed in this repo — only
// `@playwright/test` (a devDependency of packages/e2e). Resolve chromium
// through that package's own require so this plain-JS tool can run outside
// any package's node_modules.
const require = createRequire(join(repoRoot, 'packages/e2e/package.json'))
const { chromium } = require('@playwright/test')

const HELP = `capture-llm-stream.mjs — drive the live frontend and capture real /api/models/chat
exchanges into a replayable fixture (see packages/e2e/fixtures/mock-litellm.ts).

Usage:
  node .agent/skills/e2e-testing/tools/capture-llm-stream.mjs --scenario <file.json> [options]

Options:
  --scenario <file.json>   Required. Path to a scenario JSON file (see schema below).
  --target dev|pr          Which deployment to hit. Default: dev.
                              dev -> https://dev.tiny.nntin.xyz
                              pr  -> resolved via \`gh pr view --json number,headRefName\`
                                     against https://pr-<number>-<branch-slug>.tiny.preview.nntin.xyz
  --url <base>              Overrides --target with an explicit base URL.
  --out <path>               Output fixture path. Default:
                              packages/e2e/fixtures/captures/<scenario name>.json
  --help                    Print this message.

Scenario JSON schema:
  {
    "name": string,                                   // fixture name (used for default --out)
    "shell": "/canvas/" | "/web/" | "/mobile/" | "/widget/",
    "settings": string[],                              // Settings toggle labels to enable (may be empty)
    "steps": Step[]
  }

Step kinds (one key selects the kind):
  { "prompt": "...", "await": true|false }   // fill composer, click Send; await defaults true
                                              // (wait for settle: run idle — Send button back —
                                              // AND no /api/models/chat activity for 20s,
                                              // budget 10min)
  { "waitToast": true }                      // wait for .Toast__message inside the app iframe
                                              // (canvas only), timeout 10min
  { "waitText": "..." }                      // wait for text on the page OR inside the app iframe,
                                              // timeout 10min
  { "clickCanvas": "center" | { "x": n, "y": n } }  // click at iframe-relative coords; minimizes
                                              // the floating chat first if it overlays the canvas
  { "press": "Control+a" }                   // page.keyboard.press
  { "sleepMs": n }
  { "settle": true }                         // explicit settle wait (e.g. after a clickCanvas that
                                              // resolves a blocked run)

Output fixture format:
  {
    "meta": {
      "tool": "capture-llm-stream.mjs",
      "capturedAt": "<ISO>",
      "baseUrl": "...",
      "shell": "...",
      "scenario": "<name>",
      "settings": [...],
      "prompts": [<the prompt step texts in order>],
      "rateLimited": <n non-200 chat responses>
    },
    "exchanges": [
      {
        "request": {
          "systemPrefix": "...",
          "toolResultCount": 0,
          "mediaRefs": [],
          "lastUserText": "..."
        },
        "sse": "data: ...\\n\\n..."
      }
    ]
  }
`

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const log = (message) => console.log(`[capture-llm-stream] ${message}`)

const parseArgs = (argv) => {
  const args = { scenario: null, target: 'dev', url: null, out: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--scenario') args.scenario = argv[++i]
    else if (arg === '--target') args.target = argv[++i]
    else if (arg === '--url') args.url = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--help' || arg === '-h') args.help = true
    else fail(`unknown argument: ${arg}`)
  }
  return args
}

// Resolve the PR preview base URL via `gh pr view`. A stale GH_TOKEN can break
// `gh` in some environments — retry once with it stripped from the child env
// before giving up.
const resolvePrUrl = () => {
  const runGhPrView = (env) =>
    execFileSync('gh', ['pr', 'view', '--json', 'number,headRefName'], {
      encoding: 'utf8',
      env
    })

  let output
  try {
    output = runGhPrView(process.env)
  } catch {
    log('gh pr view failed; retrying with GH_TOKEN removed from the environment')
    const envWithoutToken = { ...process.env }
    delete envWithoutToken.GH_TOKEN
    try {
      output = runGhPrView(envWithoutToken)
    } catch (retryError) {
      fail(
        `--target pr could not resolve the current PR via \`gh pr view\` (even with GH_TOKEN ` +
          `removed): ${retryError.message}. Pass --url <base> instead.`
      )
    }
  }

  const { number, headRefName } = JSON.parse(output)
  if (!number || !headRefName) {
    fail(
      'gh pr view returned an unexpected shape (missing number/headRefName) — pass --url instead'
    )
  }
  const slug = headRefName.replace(/\//g, '-')
  return `https://pr-${number}-${slug}.tiny.preview.nntin.xyz`
}

const resolveBaseUrl = (args) => {
  if (args.url) return args.url
  if (args.target === 'dev') return 'https://dev.tiny.nntin.xyz'
  if (args.target === 'pr') return resolvePrUrl()
  fail(`unknown --target: ${args.target} (expected "dev" or "pr")`)
  return undefined
}

const loadScenario = (path) => {
  let raw
  try {
    raw = require('node:fs').readFileSync(resolve(path), 'utf8')
  } catch (error) {
    fail(`could not read scenario file ${path}: ${error.message}`)
  }
  let scenario
  try {
    scenario = JSON.parse(raw)
  } catch (error) {
    fail(`scenario file ${path} is not valid JSON: ${error.message}`)
  }
  if (!scenario.name) fail('scenario is missing "name"')
  if (!scenario.shell) fail('scenario is missing "shell"')
  if (!Array.isArray(scenario.steps)) fail('scenario is missing "steps" (array)')
  scenario.settings ??= []
  return scenario
}

const MEDIA_REF_RE = /media:[0-9a-f-]+#\d+/g

// A compact, secret-free digest of a captured request's POST body — never the
// headers/cookies/keys, just enough shape to eyeball drift.
const digestRequest = (postData) => {
  const empty = { systemPrefix: '', toolResultCount: 0, mediaRefs: [], lastUserText: '' }
  if (!postData) return empty
  let parsed
  try {
    parsed = JSON.parse(postData)
  } catch {
    return empty
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []

  const firstSystem = messages.find((m) => m.role === 'system')
  const systemPrefix =
    typeof firstSystem?.content === 'string' ? firstSystem.content.slice(0, 60) : ''

  const toolResultCount = messages.filter((m) => m.role === 'tool').length

  const mediaRefs = []
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const content = typeof message.content === 'string' ? message.content : ''
    for (const match of content.matchAll(MEDIA_REF_RE)) {
      mediaRefs.push(match[0])
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserContent = typeof lastUser?.content === 'string' ? lastUser.content : ''
  const lastUserText = lastUserContent.slice(0, 200)

  return { systemPrefix, toolResultCount, mediaRefs, lastUserText }
}

const defaultOutPath = (scenarioName) =>
  join(repoRoot, 'packages/e2e/fixtures/captures', `${scenarioName}.json`)

const screenshotPathFor = (outPath) => outPath.replace(/\.json$/, '') + '.png'

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }
  if (!args.scenario) fail('--scenario <file.json> is required (see --help)')

  const scenario = loadScenario(args.scenario)
  const baseUrl = resolveBaseUrl(args)
  const outPath = args.out ? resolve(args.out) : defaultOutPath(scenario.name)

  log(`scenario: ${scenario.name} (shell=${scenario.shell})`)
  log(`base url: ${baseUrl}`)
  log(`output: ${outPath}`)

  const exchanges = []
  const promptTexts = []
  let rateLimited = 0
  let lastChatActivity = Date.now()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  page.on('response', async (resp) => {
    const req = resp.request()
    if (req.method() !== 'POST' || !resp.url().includes('/api/models/chat')) return
    lastChatActivity = Date.now()
    const status = resp.status()
    if (status !== 200) {
      rateLimited += 1
      log(
        `chat response status=${status} (not recorded as an exchange; rateLimited=${rateLimited})`
      )
      lastChatActivity = Date.now()
      return
    }
    let sse
    try {
      sse = await resp.text()
    } catch (error) {
      log(`warning: could not read chat response body: ${error.message}`)
      return
    }
    const request = digestRequest(req.postData())
    exchanges.push({ request, sse })
    lastChatActivity = Date.now()
    log(`captured exchange #${exchanges.length}: status=200 bytes=${sse.length}`)
  })

  const fatal = async (message) => {
    log(`FATAL: ${message}`)
    try {
      await page.screenshot({ path: screenshotPathFor(outPath) })
      log(`screenshot written to ${screenshotPathFor(outPath)}`)
    } catch (error) {
      log(`could not write screenshot: ${error.message}`)
    }
    await browser.close()
    process.exit(1)
  }

  // Waits until the run is idle: the composer shows the Send button again (while a
  // run streams it is replaced by "Stop generating", and during a rate-limit retry
  // cooldown its accessible name becomes "Wait <n>s" — note the Send button is
  // deliberately NOT probed for enabled-ness, it is disabled whenever the composer
  // is empty) AND no /api/models/chat response has landed for 20s (a 429 counts as
  // activity — the live frontend auto-retries after retryAfterMs, typically ~60s).
  // Bounded by a generous patience budget; the live frontend genuinely rate-limits.
  const waitForSettle = async (budgetMs = 10 * 60 * 1000) => {
    const start = Date.now()
    lastChatActivity = Date.now()
    while (Date.now() - start < budgetMs) {
      await page.waitForTimeout(2000)
      // A minimized floating chat (e.g. after clickCanvas) hides both probe
      // buttons — restore it so the composer state is observable again.
      const restore = page.getByRole('button', { name: 'Restore widget' })
      if (await restore.isVisible().catch(() => false)) {
        await restore.click().catch(() => undefined)
        log('restored minimized chat widget (settle probe)')
      }
      const running = await page
        .getByRole('button', { name: 'Stop generating' })
        .first()
        .isVisible()
        .catch(() => false)
      const sendVisible = await page
        .getByRole('button', { name: 'Send', exact: true })
        .first()
        .isVisible()
        .catch(() => false)
      const quietFor = Date.now() - lastChatActivity
      if (!running && sendVisible && quietFor > 20000) {
        log('settled')
        return
      }
    }
    log('settle timeout reached (patience budget exhausted)')
  }

  const dismissFirstLoad = async (wantsSettingsOpen) => {
    const decline = page.getByRole('button', { name: 'Continue without' })
    await decline.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined)
    if (await decline.isVisible().catch(() => false)) {
      await decline.click()
      log('dismissed telemetry dialog')
    }
    if (!wantsSettingsOpen) {
      const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
      if (await settingsDialog.isVisible().catch(() => false)) {
        await settingsDialog.getByRole('button', { name: 'Close settings' }).click()
        log('closed auto-opened settings dialog')
      }
    }
  }

  // Opens Settings if not already open, reveals the tab that renders `label`
  // (Settings is tabbed and only the active tab's panel is mounted), and clicks
  // the label if its checkbox is not already checked. Mirrors
  // packages/e2e/fixtures/mock-litellm.ts's openSettingsAndEnablePlugin.
  const enableSetting = async (label) => {
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
    if (!(await settingsDialog.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Settings' }).click()
      await settingsDialog.waitFor({ state: 'visible', timeout: 10000 })
    }

    const labelText = page.getByText(label)
    if (!(await labelText.isVisible().catch(() => false))) {
      const tabs = settingsDialog.getByRole('tab')
      const tabCount = await tabs.count()
      for (let index = 0; index < tabCount; index += 1) {
        await tabs.nth(index).click()
        if (await labelText.isVisible().catch(() => false)) break
      }
    }
    await labelText.scrollIntoViewIfNeeded()
    const checkbox = page.getByRole('checkbox', { name: label })
    if (!(await checkbox.isChecked())) {
      await labelText.click()
    }
    log(`enabled setting: ${label}`)
  }

  const closeSettings = async () => {
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
    if (await settingsDialog.isVisible().catch(() => false)) {
      await settingsDialog.getByRole('button', { name: 'Close settings' }).click()
      await settingsDialog.waitFor({ state: 'hidden', timeout: 10000 })
    }
  }

  const minimizeChatIfOverlaying = async () => {
    const minimize = page.getByRole('button', { name: 'Minimize widget' })
    if (await minimize.isVisible().catch(() => false)) {
      await minimize.click()
      await minimize.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
    }
  }

  const runStep = async (step, index) => {
    if ('prompt' in step) {
      log(`step ${index}: prompt "${step.prompt}"`)
      promptTexts.push(step.prompt)
      // A prior clickCanvas may have minimized the floating chat (its bubble
      // overlays the canvas); restore it so the composer is reachable again.
      const composer = page.getByRole('textbox', { name: 'Message' })
      if (!(await composer.isVisible().catch(() => false))) {
        const restore = page.getByRole('button', { name: 'Restore widget' })
        if (await restore.isVisible().catch(() => false)) {
          await restore.click()
          log('restored minimized chat widget')
        }
      }
      await composer.fill(step.prompt)
      await page.getByRole('button', { name: 'Send' }).click()
      if (step.await !== false) await waitForSettle()
      return
    }
    if ('waitToast' in step && step.waitToast) {
      log(`step ${index}: waitToast`)
      const toast = page.frameLocator('iframe.app-harness-frame').locator('.Toast__message')
      await toast.waitFor({ state: 'visible', timeout: 10 * 60 * 1000 })
      return
    }
    if ('waitText' in step) {
      log(`step ${index}: waitText "${step.waitText}"`)
      const onPage = page.getByText(step.waitText).first()
      const inFrame = page.frameLocator('iframe.app-harness-frame').getByText(step.waitText).first()
      const budgetMs = 10 * 60 * 1000
      const start = Date.now()
      while (Date.now() - start < budgetMs) {
        if (await onPage.isVisible().catch(() => false)) return
        if (await inFrame.isVisible().catch(() => false)) return
        await page.waitForTimeout(2000)
      }
      throw new Error(`waitText "${step.waitText}" timed out after ${budgetMs}ms`)
    }
    if ('clickCanvas' in step) {
      log(`step ${index}: clickCanvas ${JSON.stringify(step.clickCanvas)}`)
      await minimizeChatIfOverlaying()
      const iframe = page.locator('iframe.app-harness-frame')
      const box = await iframe.boundingBox()
      if (!box) throw new Error('clickCanvas: app iframe has no bounding box')
      let x
      let y
      if (step.clickCanvas === 'center') {
        x = box.x + box.width / 2
        y = box.y + box.height / 2
      } else {
        x = box.x + step.clickCanvas.x
        y = box.y + step.clickCanvas.y
      }
      await page.mouse.click(x, y)
      return
    }
    if ('press' in step) {
      log(`step ${index}: press ${step.press}`)
      await page.keyboard.press(step.press)
      return
    }
    if ('sleepMs' in step) {
      log(`step ${index}: sleep ${step.sleepMs}ms`)
      await page.waitForTimeout(step.sleepMs)
      return
    }
    if ('settle' in step && step.settle) {
      log(`step ${index}: explicit settle`)
      await waitForSettle()
      return
    }
    throw new Error(`step ${index}: unrecognized step ${JSON.stringify(step)}`)
  }

  try {
    log('navigating...')
    await page.goto(`${baseUrl}${scenario.shell}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    })

    const wantsSettingsOpen = scenario.settings.length > 0
    await dismissFirstLoad(wantsSettingsOpen)

    if (scenario.settings.length > 0) {
      for (const label of scenario.settings) {
        await enableSetting(label)
      }
      await closeSettings()
      log(`applied ${scenario.settings.length} setting(s)`)
    }

    if (scenario.shell === '/canvas/') {
      await page
        .locator('iframe.app-harness-frame[data-app-frame-status="ready"]')
        .waitFor({ state: 'attached', timeout: 45000 })
      log('canvas ready')
    }

    for (let i = 0; i < scenario.steps.length; i += 1) {
      await runStep(scenario.steps[i], i)
    }
  } catch (error) {
    await fatal(error.message ?? String(error))
    return
  }

  const fixture = {
    meta: {
      tool: 'capture-llm-stream.mjs',
      capturedAt: new Date().toISOString(),
      baseUrl,
      shell: scenario.shell,
      scenario: scenario.name,
      settings: scenario.settings,
      prompts: promptTexts,
      rateLimited
    },
    exchanges
  }

  // Fixtures are committed, so emit them prettier-formatted (the repo's format
  // gate covers JSON). Prettier is a root devDependency; fall back to plain
  // stringify if it is ever unavailable.
  let serialized = JSON.stringify(fixture, null, 2) + '\n'
  try {
    const rootRequire = createRequire(join(repoRoot, 'package.json'))
    const prettier = rootRequire('prettier')
    const options = (await prettier.resolveConfig(outPath)) ?? {}
    serialized = await prettier.format(serialized, { ...options, filepath: outPath })
  } catch (error) {
    log(`prettier formatting skipped (${error.message}); writing plain JSON`)
  }
  writeFileSync(outPath, serialized)
  log(`wrote fixture to ${outPath} (${exchanges.length} exchanges, rateLimited=${rateLimited})`)

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

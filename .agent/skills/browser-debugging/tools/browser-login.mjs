import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// .agent/skills/browser-debugging/tools/ -> repo root
const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
)

const parseArgs = (argv) => {
  const args = {
    port: '3111',
    url: null,
    tokenFile: join(repoRoot, '.env.github')
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') args.port = argv[++i]
    else if (arg === '--url') args.url = argv[++i]
    else if (arg === '--token-file') args.tokenFile = resolve(argv[++i])
    else fail(`unknown argument: ${arg}`)
  }
  // Default to the web shell directly (/web/). The host root (/) embeds every
  // shell in an iframe, which DOM probes below cannot see across.
  args.url ??= `http://localhost:${args.port}/web/`
  return args
}

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const log = (message) => console.log(`[browser-login] ${message}`)

// Read the GitHub token by *reference* — never echo it, never write it anywhere
// it would be committed. Prefer the TINYTINKERER_GITHUB_TOKEN environment
// variable (exported from ~/.bashrc), honouring the legacy GITHUB_MODELS_TOKEN
// name from the GitHub-Models-provider era; fall back to the .env.github file
// when both are unset (e.g. a non-interactive shell). Only its value is handed
// to the local browser.
const readToken = (tokenFile) => {
  const fromEnv =
    process.env.TINYTINKERER_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_MODELS_TOKEN?.trim()
  if (fromEnv) return fromEnv

  let contents
  try {
    contents = readFileSync(tokenFile, 'utf8')
  } catch {
    fail(
      `TINYTINKERER_GITHUB_TOKEN is not set and ${tokenFile} is unreadable — ` +
        'export TINYTINKERER_GITHUB_TOKEN (see ~/.bashrc) or create the file'
    )
  }
  const match = contents.match(
    /^\s*(?:TINYTINKERER_GITHUB_TOKEN|GITHUB_MODELS_TOKEN)\s*=\s*(.+?)\s*$/m
  )
  const token = match?.[1]?.replace(/^['"]|['"]$/g, '')
  if (!token) {
    fail(
      `TINYTINKERER_GITHUB_TOKEN is empty in ${tokenFile} and not set in the environment`
    )
  }
  return token
}

// Run agent-browser; throw on failure. Token values are never logged.
const ab = (...args) =>
  execFileSync('agent-browser', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

// Same, but never throws — returns null on failure (for best-effort steps).
const abTry = (...args) => {
  try {
    return ab(...args)
  } catch {
    return null
  }
}

// Synchronous DOM probe (returns immediately, no 25s wait). Returns true/false.
const domHas = (js) => abTry('eval', js) === 'true'

const buttonWithText = (text) =>
  `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(text)})`

const main = () => {
  const { url, tokenFile } = parseArgs(process.argv.slice(2))
  const token = readToken(tokenFile)

  // 1. Open the app and wait for it to settle. A stale browser session can hang
  //    Page.navigate; recover by closing every session and retrying once.
  log(`opening ${url}`)
  if (abTry('open', url) === null) {
    abTry('close', '--all')
    if (abTry('open', url) === null) {
      fail(
        `could not open ${url} — is "pnpm dev" running? (frontend :3111, edge :8787)`
      )
    }
  }
  abTry('wait', '--load', 'networkidle')

  // 2. Consent to the telemetry/privacy notice if it popped up.
  if (domHas('!!document.querySelector(\'[aria-label="Telemetry"]\')')) {
    log('accepting telemetry/privacy consent')
    abTry('find', 'text', 'Accept', 'click', '--exact')
    abTry('wait', '500')
  }

  // 3. Dismiss the "privacy policy updated" notice if a returning profile shows it.
  if (domHas(buttonWithText('Dismiss'))) {
    log('dismissing privacy policy update notice')
    abTry('find', 'text', 'Dismiss', 'click', '--exact')
    abTry('wait', '500')
  }

  // 4. Already signed in? On the main page the "Sign in with GitHub" entry point
  //    is shown only while signed out. The auth store rehydrates the persisted
  //    token asynchronously after load, so poll briefly for the button to clear
  //    before concluding we are signed out.
  const signedOut = () =>
    domHas('!!document.querySelector(\'[aria-label="Sign in with GitHub"]\')')
  for (let i = 0; i < 6 && signedOut(); i += 1) abTry('wait', '500')
  if (!signedOut()) {
    log('already signed in to GitHub — nothing to do')
    log('ready: app is open and authenticated')
    return
  }

  // 5. Open Settings → Auth and paste the PAT.
  log('signing in via personal access token')
  ab('find', 'role', 'button', 'click', '--name', 'Settings')
  ab('wait', '[aria-label="Settings"][role="dialog"]')

  if (domHas(buttonWithText('Use a personal access token instead'))) {
    ab('find', 'text', 'Use a personal access token instead', 'click')
  }
  ab('wait', '[aria-label="Settings"] input[type="password"]')
  ab('fill', '[aria-label="Settings"] input[type="password"]', token)
  ab('press', 'Enter')

  // 6. The store accepts the token immediately (the Auth section flips to its
  //    signed-in "Sign out" view). Confirm that first.
  try {
    ab('wait', '--text', 'Sign out')
  } catch {
    fail('token was not accepted by the app — the PAT field may have changed')
  }
  abTry('find', 'role', 'button', 'click', '--name', 'Close settings')

  // 7. ...but the app probes api.github.com/user on the side and DROPS any token
  //    that returns 401 (github-user.ts). A Models-only PAT (models:read but no
  //    profile/read:user access) 401s there, so the session does not stick. Let
  //    the probe settle, then verify the sign-in entry point did not return.
  for (let i = 0; i < 6 && !signedOut(); i += 1) abTry('wait', '500')
  if (signedOut()) {
    fail(
      'token was accepted but the app dropped it: api.github.com/user returned 401. ' +
        'This PAT lacks profile access — use a token GitHub recognises for /user ' +
        '(a classic PAT, or a fine-grained token with read access to your profile). ' +
        'The browser is left open on the app for debugging.'
    )
  }

  log('signed in to GitHub')
  log('ready: app is open and authenticated')
}

main()

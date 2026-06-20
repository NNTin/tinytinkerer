import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import os from 'node:os'

// Write the three fixed-name Allure metadata files into the merged results directory
// BEFORE `allure generate` runs (issue #258). The Overview widgets they back —
// Environment, Executors, Categories — are populated ONLY from these files at
// generate time; neither allure-vitest nor allure-playwright emits any of them, so
// without this step the widgets are empty. They are written here (in the report job),
// NOT by collect-allure-results.mjs, which only consolidates the per-package
// UUID-named result files.
//
// `allure generate dir1 dir2 ...` reads each metadata file from every input dir, so
// writing into a SINGLE dir is enough: environment.properties / categories.json are
// merged across dirs, and executor.json becomes one Executors entry per file — so we
// deliberately emit it into one dir only to avoid a duplicate executor.
//
// Every field falls back to a sane default, so the script also runs locally (for the
// `allure generate` verification in the PR) without the GitHub Actions context.

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')

const target = resolve(workspaceRoot, process.argv[2] ?? 'allure-results-vitest')

const env = process.env
const firstOf = (...values) => values.find((value) => value && value.trim() !== '')

// @playwright/test is the single source of truth for the engine version under test.
const readPlaywrightVersion = async () => {
  try {
    const pkg = JSON.parse(
      await readFile(join(workspaceRoot, 'packages', 'e2e', 'package.json'), 'utf8')
    )
    return pkg.devDependencies?.['@playwright/test'] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const serverUrl = firstOf(env.GITHUB_SERVER_URL) ?? 'https://github.com'
const repository = firstOf(env.GITHUB_REPOSITORY) ?? 'NNTin/tinytinkerer'
const runId = firstOf(env.GITHUB_RUN_ID)
const runNumber = firstOf(env.GITHUB_RUN_NUMBER)
const prNumber = firstOf(env.PR_NUMBER)
const sha = firstOf(env.GITHUB_SHA) ?? 'local'
const buildUrl = runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined

const playwrightVersion = await readPlaywrightVersion()

// environment.properties — a single global, informational table (NOT a per-test
// filter). Keys are single tokens so the java .properties parser reads them cleanly.
// The Base URL paths are each shell's stable Vite base; the localhost host:port the
// suite actually binds is a runner-internal detail with no meaning in the report.
const environment = [
  ['Browsers', 'chromium, firefox, webkit'],
  ['Node', process.version],
  ['OS', firstOf(env.RUNNER_OS) ?? `${os.type()} ${os.release()}`],
  ['Playwright', playwrightVersion],
  ['Commit', sha],
  ['Web.BaseURL', '/web/'],
  ['Widget.BaseURL', '/widget/'],
  ['Mobile.BaseURL', '/mobile/']
]
  .map(([key, value]) => `${key} = ${value}`)
  .join('\n')

// executor.json — links the report to the CI run (type "github" renders the Actions
// logo + a clickable build link) and is the metadata Allure keys trend/history off.
// reportUrl (the eventual <preview>/test-report/ URL) is intentionally omitted: the
// preview domain is only derived later in the deploy-preview job, after this report is
// built, so it is not known here. History PERSISTENCE across runs (copying the prior
// report's history/ dir back in) is out of scope for the ephemeral per-PR preview.
const executor = {
  name: 'GitHub Actions',
  type: 'github',
  buildName: prNumber ? `PR #${prNumber}` : `Local (${sha})`,
  reportName: 'Tinytinkerer merged Allure report',
  ...(buildUrl ? { buildUrl, url: buildUrl } : {}),
  ...(runNumber ? { buildOrder: Number(runNumber) } : {})
}

// categories.json — custom defect buckets, only ever shown when something fails.
// messageRegex is a full-match java pattern, so each is wrapped in (?si).*…* to match
// anywhere in a multi-line message, case-insensitively. First matching bucket wins.
const categories = [
  {
    name: 'Sandbox guarantee violated',
    messageRegex: '(?si).*(sandbox|isolation|opaque origin|srcdoc|csp).*',
    matchedStatuses: ['failed']
  },
  {
    name: 'Timeout',
    messageRegex: '(?si).*(timeout|timed out|exceeded).*',
    matchedStatuses: ['broken', 'failed']
  },
  {
    name: 'Flaky',
    matchedStatuses: ['passed', 'failed', 'broken'],
    flaky: true
  }
]

await writeFile(join(target, 'environment.properties'), `${environment}\n`)
await writeFile(join(target, 'executor.json'), `${JSON.stringify(executor, null, 2)}\n`)
await writeFile(join(target, 'categories.json'), `${JSON.stringify(categories, null, 2)}\n`)

const printable = relative(workspaceRoot, target) || target
console.log(
  `Wrote environment.properties, executor.json, categories.json into ${printable} ` +
    `(buildName=${executor.buildName}${buildUrl ? `, buildUrl=${buildUrl}` : ''})`
)

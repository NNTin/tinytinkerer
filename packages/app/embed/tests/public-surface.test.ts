import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The package's public entry is a semver contract (issue #510, T1): a name
// added here is a minor release, a name removed or changed is a major one. This
// test pins the list, so changing the surface is a visible, reviewed diff to
// the test rather than a side effect of editing a re-export — and so the list
// in docs/extending/embed-package.md has one place to be checked against.
//
// Read from the source with the compiler API rather than by importing the
// module: importing would boot the browser runtime, and the question here is
// only what the entry SAYS it exports.

const entryPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))

const exportsOf = (path: string): { values: string[]; types: string[] } => {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest)
  const values: string[] = []
  const types: string[] = []
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) {
      continue
    }
    if (!ts.isNamedExports(statement.exportClause)) {
      throw new Error('the entry must not use `export * as`; name every export')
    }
    for (const element of statement.exportClause.elements) {
      ;(statement.isTypeOnly || element.isTypeOnly ? types : values).push(element.name.text)
    }
  }
  return { values: values.sort(), types: types.sort() }
}

describe('@nntin/tinytinkerer-embed public entry', () => {
  const surface = exportsOf(entryPath)

  it('exports exactly these runtime values', () => {
    expect(surface.values).toEqual([
      'BrowserAppShell',
      'CATALOGUE_PLUGIN_NAMES',
      'ChatApp',
      'DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES',
      'GITHUB_OAUTH_CALLBACK_PATH',
      'NO_GLOBAL_HOST_CAPABILITIES',
      'completeGitHubOAuth',
      'createBrowserApp',
      'createStageTools',
      'genericToolTreeSummarizer',
      'isSignInRequired',
      'loadPlugins',
      'resolveBrowserShellBootstrapConfig',
      'z'
    ])
  })

  it('exports exactly these types', () => {
    expect(surface.types).toEqual([
      'ActivityStatus',
      'ActivitySummarizer',
      'ActivityView',
      'ActivityViewSection',
      'AppAssistantPolicy',
      'AppInstructionBoundary',
      'AppSignIn',
      'AppTool',
      'AppToolGroup',
      'AppToolResultRecord',
      'AppToolRunBindings',
      'AppToolRunImplementation',
      'BrowserApp',
      'BrowserAppShellProps',
      'BrowserAuthMode',
      'BrowserShell',
      'BrowserShellBootstrapOptions',
      'BrowserShellConfig',
      'CataloguePluginName',
      'ChatAppProps',
      'ChatDockEdge',
      'ChatLoadingComponent',
      'ChatMode',
      'ChatPresentation',
      'ConversationResetBehavior',
      'CreateStageToolsOptions',
      'DocumentGlobalCapabilities',
      'GlobalHostCapabilities',
      'HostMcpServer',
      'PluginCatalogue',
      'PreSendDisclosure',
      'ShellThemeTokens',
      'StageToolDefinition',
      'StageToolRequestHandle',
      'Tool',
      'ToolTreeSummarizer',
      'ToolTreeView'
    ])
  })

  it('is documented name for name in docs/extending/embed-package.md', () => {
    const docs = readFileSync(
      fileURLToPath(new URL('../../../../docs/extending/embed-package.md', import.meta.url)),
      'utf8'
    )
    const undocumented = [...surface.values, ...surface.types].filter(
      (name) => !docs.includes(`\`${name}\``)
    )
    expect(undocumented).toEqual([])
  })
})

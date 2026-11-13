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
const oauthEntryPath = fileURLToPath(new URL('../src/oauth.ts', import.meta.url))
const stageEntryPath = fileURLToPath(new URL('../src/stage.ts', import.meta.url))

const specifiersOf = (path: string): string[] => {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest)
  return [
    ...new Set(
      source.statements.flatMap((statement) =>
        (ts.isExportDeclaration(statement) || ts.isImportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : []
      )
    )
  ]
}

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
      'EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES',
      'GITHUB_OAUTH_CALLBACK_PATH',
      'NO_GLOBAL_HOST_CAPABILITIES',
      'completeGitHubOAuth',
      'createBrowserApp',
      'createStageControllerHandle',
      'createStageTools',
      'genericToolTreeSummarizer',
      'hostMcpServerStatus',
      'isGitHubOAuthCallback',
      'isSignInRequired',
      'loadPlugins',
      'resolveBrowserShellBootstrapConfig',
      'retryHostMcpDiscovery',
      'useHostMcp',
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
      'CreateControllerStageToolsOptions',
      'CreateStageToolsOptions',
      'DocumentGlobalCapabilities',
      'GlobalHostCapabilities',
      'HostMcpServer',
      'HostMcpServerStatus',
      'HostMcpState',
      'HostMcpStore',
      'PluginCatalogue',
      'PreSendDisclosure',
      'ShellThemeTokens',
      'StageControllerHandle',
      'StageControllerMethod',
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

describe('@nntin/tinytinkerer-embed/oauth subpath (#518 F3)', () => {
  const surface = exportsOf(oauthEntryPath)

  it('exports exactly the callback helpers', () => {
    expect(surface.values).toEqual([
      'GITHUB_OAUTH_CALLBACK_PATH',
      'completeGitHubOAuth',
      'isGitHubOAuthCallback'
    ])
    expect(surface.types).toEqual(['GitHubOAuthCallbackConfig'])
  })

  it('re-exports only from the side-effect-free app-browser facade', () => {
    expect(specifiersOf(oauthEntryPath)).toEqual(['@tinytinkerer/app-browser/oauth'])
  })

  it('is documented in docs/extending/host-sign-in.md', () => {
    const docs = readFileSync(
      fileURLToPath(new URL('../../../../docs/extending/host-sign-in.md', import.meta.url)),
      'utf8'
    )
    expect(docs).toContain('@nntin/tinytinkerer-embed/oauth')
    const undocumented = [...surface.values, ...surface.types].filter(
      (name) => !docs.includes(`\`${name}\``)
    )
    expect(undocumented).toEqual([])
  })
})

describe('@nntin/tinytinkerer-embed/stage subpath (#523 G1)', () => {
  const surface = exportsOf(stageEntryPath)
  const root = exportsOf(entryPath)

  it('exports exactly the stage helpers', () => {
    expect(surface.values).toEqual(['createStageControllerHandle', 'createStageTools'])
    expect(surface.types).toEqual([
      'CreateControllerStageToolsOptions',
      'CreateStageToolsOptions',
      'StageControllerHandle',
      'StageControllerMethod',
      'StageToolDefinition',
      'StageToolRequestHandle'
    ])
  })

  it('is a subset of the root, which still exports every name', () => {
    expect(surface.values.filter((name) => !root.values.includes(name))).toEqual([])
    expect(surface.types.filter((name) => !root.types.includes(name))).toEqual([])
  })

  it('re-exports only from the side-effect-free app-shell facade', () => {
    expect(specifiersOf(stageEntryPath)).toEqual(['@tinytinkerer/app-shell/stage'])
  })

  it('is documented in docs/extending/embed-package.md', () => {
    const docs = readFileSync(
      fileURLToPath(new URL('../../../../docs/extending/embed-package.md', import.meta.url)),
      'utf8'
    )
    expect(docs).toContain('@nntin/tinytinkerer-embed/stage')
  })
})

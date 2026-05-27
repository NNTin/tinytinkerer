import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const workspaceRoots = [join(rootDir, 'apps'), join(rootDir, 'packages')]
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

const importPattern =
  /\b(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const workspacePackages = await loadWorkspacePackages()
const workspaceByName = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]))
const errors = []
const graph = new Map(workspacePackages.map((pkg) => [pkg.name, new Set()]))
const sourceRules = new Map([
  [
    '@tinytinkerer/app-core',
    [
      { pattern: /\bfetch\s*\(/, label: 'fetch()' },
      { pattern: /\bwindow(?=\s*[\.\[])/, label: 'window' },
      { pattern: /\bdocument(?=\s*[\.\[])/, label: 'document' },
      { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
      { pattern: /\blocalStorage\b/, label: 'localStorage' },
      { pattern: /\bindexedDB\b/, label: 'indexedDB' },
      { pattern: /\bDexie\b/, label: 'Dexie' },
      { pattern: /from\s+['"]react(?:\/[^'"]*)?['"]/, label: 'React import' },
      { pattern: /from\s+['"]zustand(?:\/[^'"]*)?['"]/, label: 'Zustand import' }
    ]
  ],
  [
    '@tinytinkerer/agent-core',
    [
      { pattern: /\bfetch\s*\(/, label: 'fetch()' },
      { pattern: /\bwindow(?=\s*[\.\[])/, label: 'window' },
      { pattern: /\bdocument(?=\s*[\.\[])/, label: 'document' },
      { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
      { pattern: /\blocalStorage\b/, label: 'localStorage' },
      { pattern: /\bindexedDB\b/, label: 'indexedDB' },
      { pattern: /\bDexie\b/, label: 'Dexie' },
      { pattern: /from\s+['"]react(?:\/[^'"]*)?['"]/, label: 'React import' },
      { pattern: /from\s+['"]zustand(?:\/[^'"]*)?['"]/, label: 'Zustand import' }
    ]
  ],
  [
    '@tinytinkerer/content-core',
    [
      { pattern: /\bfetch\s*\(/, label: 'fetch()' },
      { pattern: /\bwindow(?=\s*[\.\[])/, label: 'window' },
      { pattern: /\bdocument(?=\s*[\.\[])/, label: 'document' },
      { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
      { pattern: /\blocalStorage\b/, label: 'localStorage' },
      { pattern: /\bindexedDB\b/, label: 'indexedDB' },
      { pattern: /\bDexie\b/, label: 'Dexie' },
      { pattern: /from\s+['"]react(?:\/[^'"]*)?['"]/, label: 'React import' },
      { pattern: /from\s+['"]zustand(?:\/[^'"]*)?['"]/, label: 'Zustand import' }
    ]
  ],
  [
    '@tinytinkerer/content-runtime',
    [
      { pattern: /\bfetch\s*\(/, label: 'fetch()' },
      { pattern: /\bwindow(?=\s*[\.\[])/, label: 'window' },
      { pattern: /\bdocument(?=\s*[\.\[])/, label: 'document' },
      { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
      { pattern: /\blocalStorage\b/, label: 'localStorage' },
      { pattern: /\bindexedDB\b/, label: 'indexedDB' },
      { pattern: /\bDexie\b/, label: 'Dexie' },
      { pattern: /from\s+['"]react(?:\/[^'"]*)?['"]/, label: 'React import' },
      { pattern: /from\s+['"]zustand(?:\/[^'"]*)?['"]/, label: 'Zustand import' }
    ]
  ]
])

for (const pkg of workspacePackages) {
  validateDeclaredWorkspaceDependencies(pkg)
  const files = await collectSourceFiles(pkg.dir)

  for (const file of files) {
    const { source, specifiers } = await parseSourceFile(file)
    validateSourceConstraints(pkg, file, source)
    for (const specifier of specifiers) {
      const target = resolveTarget(pkg, file, specifier)
      if (!target) {
        continue
      }

      if (target.pkg.name !== pkg.name) {
        graph.get(pkg.name)?.add(target.pkg.name)
      }

      validateBoundary(pkg, target, file)
    }
  }
}

detectCycles()

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error)
  }
  process.exit(1)
}

console.log('Boundary checks passed.')

async function loadWorkspacePackages() {
  const packages = []

  for (const baseDir of workspaceRoots) {
    const entries = await readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const dir = join(baseDir, entry.name)
      const packageJsonPath = join(dir, 'package.json')
      try {
        const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
        packages.push({
          name: manifest.name,
          dir,
          kind: relative(rootDir, baseDir).startsWith('apps') ? 'app' : 'package',
          slug: entry.name,
          manifest
        })
      } catch {
        // Ignore directories without a package manifest.
      }
    }
  }

  return packages
}

async function collectSourceFiles(dir) {
  const files = []
  const stack = [join(dir, 'src'), join(dir, 'tests')]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'node_modules') {
          continue
        }
        stack.push(fullPath)
        continue
      }

      if (sourceExtensions.has(extname(entry.name))) {
        files.push(fullPath)
      }
    }
  }

  return files
}

function validateDeclaredWorkspaceDependencies(pkg) {
  const dependencySections = [
    pkg.manifest.dependencies,
    pkg.manifest.devDependencies,
    pkg.manifest.peerDependencies,
    pkg.manifest.optionalDependencies
  ]
  const declaredWorkspaceDependencies = new Set()

  for (const section of dependencySections) {
    for (const dependencyName of Object.keys(section ?? {})) {
      if (workspaceByName.has(dependencyName)) {
        declaredWorkspaceDependencies.add(dependencyName)
      }
    }
  }

  for (const dependencyName of declaredWorkspaceDependencies) {
    const targetPkg = workspaceByName.get(dependencyName)
    if (!targetPkg) {
      continue
    }

    graph.get(pkg.name)?.add(targetPkg.name)
    validateBoundary(
      pkg,
      {
        pkg: targetPkg,
        specifier: dependencyName,
        isSubpathImport: false
      },
      join(pkg.dir, 'package.json')
    )
  }
}

async function parseSourceFile(filePath) {
  const source = await readFile(filePath, 'utf8')
  const specifiers = []
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier) {
      specifiers.push(specifier)
    }
  }
  return { source, specifiers }
}

function resolveTarget(sourcePkg, filePath, specifier) {
  if (specifier.startsWith('@tinytinkerer/')) {
    const [scope, name, ...subpath] = specifier.split('/')
    const packageName = `${scope}/${name}`
    const pkg = workspaceByName.get(packageName)
    if (!pkg) {
      return undefined
    }

    return {
      pkg,
      specifier,
      isSubpathImport: subpath.length > 0
    }
  }

  if (!specifier.startsWith('.')) {
    return undefined
  }

  const resolved = resolve(dirname(filePath), specifier)
  const target = workspacePackages.find((pkg) => {
    const rel = relative(pkg.dir, resolved)
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('../'))
  })

  if (!target || target.name === sourcePkg.name) {
    return undefined
  }

  return {
    pkg: target,
    specifier,
    isSubpathImport: false
  }
}

function validateBoundary(sourcePkg, target, filePath) {
  const sourceLabel = relative(rootDir, filePath)
  const targetPkg = target.pkg

  if (target.isSubpathImport && targetPkg.name !== sourcePkg.name) {
    errors.push(`${sourceLabel}: workspace package subpath imports are forbidden (${target.specifier})`)
  }

  if (sourcePkg.kind === 'app' && targetPkg.kind === 'app' && sourcePkg.name !== targetPkg.name) {
    errors.push(`${sourceLabel}: app-to-app imports are forbidden (${sourcePkg.name} -> ${targetPkg.name})`)
  }

  if (
    sourcePkg.name === '@tinytinkerer/web' ||
    sourcePkg.name === '@tinytinkerer/widget' ||
    sourcePkg.name === '@tinytinkerer/mobile'
  ) {
    if (!isBrowserAppDependencyAllowed(targetPkg)) {
      errors.push(
        `${sourceLabel}: browser apps may depend only on @tinytinkerer/app-browser or @tinytinkerer/ui (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/edge') {
    const allowed = new Set(['@tinytinkerer/edge', '@tinytinkerer/contracts'])
    if (!allowed.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: edge may import only contracts and edge-local modules (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/agent-core') {
    const allowed = new Set(['@tinytinkerer/agent-core', '@tinytinkerer/contracts'])
    if (!allowed.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: agent-core may import only contracts and agent-core-local modules (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/app-core') {
    const allowed = new Set([
      '@tinytinkerer/app-core',
      '@tinytinkerer/agent-core',
      '@tinytinkerer/contracts'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: app-core may import only agent-core, contracts, and app-core-local modules (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/app-browser') {
    const allowed = new Set([
      '@tinytinkerer/app-browser',
      '@tinytinkerer/app-core',
      '@tinytinkerer/brand-assets',
      '@tinytinkerer/content-core',
      '@tinytinkerer/content-markdown',
      '@tinytinkerer/content-mermaid',
      '@tinytinkerer/content-wireframe',
      '@tinytinkerer/contracts'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: app-browser may import only app-core, brand-assets, contracts, content-core for DTO translation, the outward-facing content packages (content-markdown, content-mermaid, content-wireframe), and app-browser-local modules (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/brand-assets') {
    const allowed = new Set([
      '@tinytinkerer/brand-assets',
      '@tinytinkerer/contracts'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: brand-assets may import only contracts and brand-assets-local modules (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/ui') {
    if (targetPkg.name !== '@tinytinkerer/ui') {
      errors.push(`${sourceLabel}: ui must stay primitive-only (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/content-core') {
    const allowed = new Set([
      '@tinytinkerer/content-core'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: content-core must not depend on other workspace packages (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/content-runtime') {
    const allowed = new Set([
      '@tinytinkerer/content-core',
      '@tinytinkerer/content-runtime'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: content-runtime may import only content-core and local modules (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/content-markdown') {
    const allowed = new Set([
      '@tinytinkerer/content-core',
      '@tinytinkerer/content-react',
      '@tinytinkerer/content-markdown'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: content-markdown may import only content-core, content-react, and local modules (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/content-react') {
    const allowed = new Set([
      '@tinytinkerer/content-core',
      '@tinytinkerer/content-react',
      '@tinytinkerer/content-runtime',
      '@tinytinkerer/ui'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: content-react may import only content-core, content-runtime, ui, and local modules (${targetPkg.name})`
      )
    }
  }

  if (
    sourcePkg.name === '@tinytinkerer/content-mermaid' ||
    sourcePkg.name === '@tinytinkerer/content-wireframe'
  ) {
    const allowed = new Set([
      sourcePkg.name,
      '@tinytinkerer/content-react'
    ])
    if (!allowed.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: specialized content packages may import only content-react and local modules (${targetPkg.name})`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/contracts' && targetPkg.name !== '@tinytinkerer/contracts') {
    errors.push(`${sourceLabel}: contracts must not depend on other workspace packages (${targetPkg.name})`)
  }
}

function validateSourceConstraints(pkg, filePath, source) {
  const sourceLabel = relative(rootDir, filePath)
  const rules = sourceRules.get(pkg.name)

  for (const rule of rules ?? []) {
    if (rule.pattern.test(source)) {
      errors.push(`${sourceLabel}: ${pkg.name} must not use ${rule.label}`)
    }
  }
}

function isBrowserAppDependencyAllowed(targetPkg) {
  return (
    targetPkg.name === '@tinytinkerer/app-browser' ||
    targetPkg.name === '@tinytinkerer/ui'
  )
}

function detectCycles() {
  const visited = new Set()
  const stack = []
  const inStack = new Set()

  const visit = (pkgName) => {
    if (inStack.has(pkgName)) {
      const cycleStart = stack.indexOf(pkgName)
      const cycle = [...stack.slice(cycleStart), pkgName].join(' -> ')
      errors.push(`Package cycle detected: ${cycle}`)
      return
    }

    if (visited.has(pkgName)) {
      return
    }

    visited.add(pkgName)
    stack.push(pkgName)
    inStack.add(pkgName)

    for (const dependency of graph.get(pkgName) ?? []) {
      visit(dependency)
    }

    stack.pop()
    inStack.delete(pkgName)
  }

  for (const pkgName of graph.keys()) {
    visit(pkgName)
  }
}

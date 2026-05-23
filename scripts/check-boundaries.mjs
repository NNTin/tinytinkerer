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

for (const pkg of workspacePackages) {
  const files = await collectSourceFiles(pkg.dir)

  for (const file of files) {
    const imports = await parseImports(file)
    for (const specifier of imports) {
      const target = resolveTarget(pkg, file, specifier)
      if (!target) {
        continue
      }

      if (target.name !== pkg.name) {
        graph.get(pkg.name)?.add(target.name)
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
          slug: entry.name
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
  const srcDir = join(dir, 'src')
  const stack = [srcDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    const entries = await readdir(current, { withFileTypes: true })
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

async function parseImports(filePath) {
  const source = await readFile(filePath, 'utf8')
  const specifiers = []
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier) {
      specifiers.push(specifier)
    }
  }
  return specifiers
}

function resolveTarget(sourcePkg, filePath, specifier) {
  if (specifier.startsWith('@tinytinkerer/')) {
    const [scope, name, subpath] = specifier.split('/')
    const packageName = subpath ? `${scope}/${name}` : specifier
    return workspaceByName.get(packageName)
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

  return target
}

function validateBoundary(sourcePkg, targetPkg, filePath) {
  const sourceLabel = relative(rootDir, filePath)

  if (sourcePkg.kind === 'app' && targetPkg.kind === 'app' && sourcePkg.name !== targetPkg.name) {
    errors.push(`${sourceLabel}: app-to-app imports are forbidden (${sourcePkg.name} -> ${targetPkg.name})`)
  }

  if (sourcePkg.name === '@tinytinkerer/web' || sourcePkg.name === '@tinytinkerer/widget') {
    const forbidden = new Set([
      '@tinytinkerer/contracts',
      '@tinytinkerer/app-core',
      '@tinytinkerer/agent-core'
    ])
    if (forbidden.has(targetPkg.name)) {
      errors.push(
        `${sourceLabel}: browser apps must depend on @tinytinkerer/app-browser instead of ${targetPkg.name}`
      )
    }
  }

  if (sourcePkg.name === '@tinytinkerer/edge') {
    const allowed = new Set(['@tinytinkerer/edge', '@tinytinkerer/contracts'])
    if (!allowed.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: edge may import only contracts and edge-local modules (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/ui') {
    const forbiddenPrefixes = [
      '@tinytinkerer/app-core',
      '@tinytinkerer/app-browser',
      '@tinytinkerer/agent-core',
      '@tinytinkerer/web',
      '@tinytinkerer/widget',
      '@tinytinkerer/edge'
    ]
    if (forbiddenPrefixes.includes(targetPkg.name)) {
      errors.push(`${sourceLabel}: ui must stay primitive-only (${targetPkg.name})`)
    }
  }

  if (sourcePkg.slug.startsWith('feature-')) {
    const forbidden = new Set([
      '@tinytinkerer/app-browser',
      '@tinytinkerer/app-core',
      '@tinytinkerer/agent-core',
      '@tinytinkerer/web',
      '@tinytinkerer/widget',
      '@tinytinkerer/edge'
    ])
    if (forbidden.has(targetPkg.name)) {
      errors.push(`${sourceLabel}: feature packages must depend downward only (${targetPkg.name})`)
    }
  }

  if (sourcePkg.name === '@tinytinkerer/contracts' && targetPkg.name !== '@tinytinkerer/contracts') {
    errors.push(`${sourceLabel}: contracts must not depend on other workspace packages (${targetPkg.name})`)
  }
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

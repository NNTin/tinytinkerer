/**
 * Emits the package's `.d.ts` tree into `dist/types/` (issue #510, T1).
 *
 * Why not a plain `tsc --declaration`: the workspace packages this bundle
 * compiles in are private (`@tinytinkerer/*`, never published), and their types
 * reach third-party packages the host will not have installed — zustand stores
 * on `BrowserApp`, Zod schemas on `Tool`, and so on. A declaration file that
 * says `import ... from '@tinytinkerer/app-core'` or `from 'zustand'` resolves
 * to nothing in a host and silently degrades to `any` under `skipLibCheck`.
 *
 * So this script:
 *
 * 1. runs the TypeScript compiler over `src/index.ts` with declaration emit,
 *    capturing every emitted `.d.ts` in memory;
 * 2. walks the import closure from the entry's declaration — ONLY files the
 *    public types actually reach are published;
 * 3. resolves each specifier exactly as the compiler did, then
 *    - a workspace module maps to its own emitted declaration,
 *    - a third-party declaration file is VENDORED into `dist/types/vendor/`,
 *    - `react` / `react-dom` (the peers) stay bare;
 * 4. rewrites every specifier to a relative `.js` path, so the result resolves
 *    under `bundler`, `node16` and `nodenext` alike.
 *
 * Any specifier it cannot place fails the build rather than shipping a hole.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDir, '../../..')
const typesDir = join(packageDir, 'dist/types')
const entry = join(packageDir, 'src/index.ts')
// Ambient build-time constants the bundled sources read; never published.
const ambient = join(packageDir, 'src/env.d.ts')

/** Packages the host provides; their specifiers are left untouched. */
const PEER_PACKAGES = new Set(['react', 'react-dom'])
/** Type-reference directives a declaration may carry that a host must not need. */
const DROPPED_TYPE_REFERENCES = new Set(['vite/client'])

// Type libraries (`types: ["vite/client"]`) resolve from the current
// directory, which must be this package's, wherever the script is run from.
process.chdir(packageDir)

const toPosix = (path) => path.split(sep).join('/')

const parsedConfig = (() => {
  const configPath = join(packageDir, 'tsconfig.json')
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  }
  return ts.parseJsonConfigFileContent(config, ts.sys, packageDir)
})()

/**
 * `@tinytinkerer/*` → source, for every workspace package and export.
 *
 * Without this the compiler reaches workspace packages through their
 * `node_modules` symlinks, classifies them as external libraries, and emits
 * declarations for none of them. Mapping each `exports` entry straight to its
 * `types` source makes them ordinary project sources, which are emitted.
 */
const workspacePaths = (() => {
  const paths = {}
  const visit = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const child = join(dir, entry.name)
      const manifestPath = join(child, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (!manifest.name?.startsWith('@tinytinkerer/')) continue
        for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
          const types = typeof target === 'string' ? target : target.types
          if (typeof types !== 'string' || !/\.tsx?$/.test(types)) continue
          paths[`${manifest.name}${subpath.slice(1)}`] = [join(child, types)]
        }
      } else if (depth > 0) {
        visit(child, depth - 1)
      }
    }
  }
  visit(join(repoRoot, 'packages'), 3)
  return paths
})()

const compilerOptions = {
  ...parsedConfig.options,
  paths: workspacePaths,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  rootDir: repoRoot,
  // A virtual directory: nothing is written there, `writeFile` below captures
  // every output. It only fixes the shape of emitted paths.
  outDir: join(repoRoot, '__embed_types__')
}
const emitRoot = compilerOptions.outDir

const program = ts.createProgram({ rootNames: [entry, ambient], options: compilerOptions })
const emitted = new Map()
const emitResult = program.emit(undefined, (fileName, text) => {
  emitted.set(resolve(fileName), text)
})

const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics].filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
)
if (diagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n'
    })
  )
  process.exit(1)
}

/** Where a workspace source file's emitted declaration lives in memory. */
const emittedDeclarationFor = (sourcePath) =>
  join(emitRoot, relative(repoRoot, sourcePath)).replace(/\.(tsx?|mts|cts)$/, (ext) =>
    ext === '.mts' ? '.d.mts' : ext === '.cts' ? '.d.cts' : '.d.ts'
  )

const packageOf = (nodeModulesPath) => {
  const tail = nodeModulesPath.slice(nodeModulesPath.lastIndexOf(`${sep}node_modules${sep}`) + 14)
  const parts = tail.split(sep)
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  const root =
    nodeModulesPath.slice(0, nodeModulesPath.length - tail.length) + name.split('/').join(sep)
  return { name, root }
}

const specifierPackage = (specifier) => {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

const isDeclaration = (path) => /\.d\.[cm]?ts$/.test(path)
const runtimeExtension = (path) =>
  path
    .replace(/\.d\.ts$/, '.js')
    .replace(/\.d\.mts$/, '.mjs')
    .replace(/\.d\.cts$/, '.cjs')

/**
 * One file in the published tree. `origin` is the path the compiler resolves
 * the file's own imports from: the workspace SOURCE for an emitted declaration,
 * the real node_modules path for a vendored one.
 */
const files = new Map()

const place = (resolvedFileName) => {
  const path = resolve(resolvedFileName)
  if (path.includes(`${sep}node_modules${sep}`)) {
    const pkg = packageOf(path)
    if (!isDeclaration(path)) {
      throw new Error(`${pkg.name} resolved to a non-declaration file (${path})`)
    }
    return {
      key: path,
      origin: path,
      out: join(typesDir, 'vendor', pkg.name, relative(pkg.root, path)),
      read: () => readFileSync(path, 'utf8')
    }
  }
  if (!path.startsWith(repoRoot + sep)) {
    throw new Error(`resolved outside the repository: ${path}`)
  }
  if (isDeclaration(path)) {
    return {
      key: path,
      origin: path,
      out: join(typesDir, relative(repoRoot, path)),
      read: () => readFileSync(path, 'utf8')
    }
  }
  const declaration = emittedDeclarationFor(path)
  const text = emitted.get(declaration)
  if (text === undefined) {
    throw new Error(`no declaration was emitted for ${relative(repoRoot, path)}`)
  }
  return {
    key: path,
    origin: path,
    out: join(typesDir, relative(emitRoot, declaration)),
    read: () => text
  }
}

const relativeSpecifier = (fromOut, toOut) => {
  const spec = toPosix(relative(dirname(fromOut), runtimeExtension(toOut)))
  return spec.startsWith('.') ? spec : `./${spec}`
}

/**
 * The exact span of a `/// <reference>` directive's value, located and
 * verified rather than trusted from `ts.preProcessFile`'s offsets.
 */
const spanOf = (text, ref) => {
  const start = text.startsWith(ref.fileName, ref.pos) ? ref.pos : ref.pos + 1
  if (!text.startsWith(ref.fileName, start)) {
    throw new Error(`could not locate "${ref.fileName}" at offset ${ref.pos}`)
  }
  return { pos: start, end: start + ref.fileName.length }
}

/**
 * Every module specifier in a declaration file, from its syntax tree:
 * `import`/`export … from`, `export * as ns from` (which the compiler's
 * `preProcessFile` does not report — zod's own declarations use it), and
 * `import('…')` types. Positions are those of the specifier text, inside the
 * quotes.
 */
const moduleSpecifiersOf = (fileName, text) => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  const found = []
  const add = (literal) => {
    if (literal && ts.isStringLiteralLike(literal)) {
      const start = literal.getStart(source) + 1
      found.push({ fileName: literal.text, pos: start, end: start + literal.text.length })
    }
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const queue = [place(entry)]
while (queue.length > 0) {
  const file = queue.shift()
  if (files.has(file.key)) {
    continue
  }
  const text = file.read()
  const info = ts.preProcessFile(text, true, true)
  /** @type {Array<{ pos: number, end: number, value: string }>} */
  const edits = []

  for (const ref of moduleSpecifiersOf(file.out, text)) {
    const specifier = ref.fileName
    if (PEER_PACKAGES.has(specifierPackage(specifier)) && !specifier.startsWith('.')) {
      continue
    }
    const { resolvedModule } = ts.resolveModuleName(specifier, file.origin, compilerOptions, ts.sys)
    if (!resolvedModule) {
      throw new Error(`cannot resolve "${specifier}" from ${file.origin}`)
    }
    const target = place(resolvedModule.resolvedFileName)
    queue.push(target)
    edits.push({ pos: ref.pos, end: ref.end, value: relativeSpecifier(file.out, target.out) })
  }

  for (const ref of info.typeReferenceDirectives) {
    if (DROPPED_TYPE_REFERENCES.has(ref.fileName)) {
      edits.push({ ...spanOf(text, ref), value: '' })
      continue
    }
    if (PEER_PACKAGES.has(ref.fileName) || ref.fileName === 'react/jsx-runtime') {
      continue
    }
    throw new Error(
      `${file.origin} carries /// <reference types="${ref.fileName}" />, which a host cannot be assumed to have`
    )
  }

  for (const ref of info.referencedFiles) {
    const target = place(resolve(dirname(file.origin), ref.fileName))
    queue.push(target)
    edits.push({ ...spanOf(text, ref), value: toPosix(relative(dirname(file.out), target.out)) })
  }

  let rewritten = text
  for (const edit of edits.sort((a, b) => b.pos - a.pos)) {
    rewritten = rewritten.slice(0, edit.pos) + edit.value + rewritten.slice(edit.end)
  }
  // A dropped reference leaves `/// <reference types="" />`; remove the line.
  rewritten = rewritten.replace(/^\/\/\/ <reference types="" \/>\r?\n/gm, '')
  files.set(file.key, { out: file.out, text: rewritten })
}

rmSync(typesDir, { recursive: true, force: true })
const vendored = new Set()
for (const { out, text } of files.values()) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
  const rel = toPosix(relative(typesDir, out))
  if (rel.startsWith('vendor/')) {
    vendored.add(specifierPackage(rel.slice('vendor/'.length)))
  }
}

const entryOut = files.get(resolve(entry)).out
writeFileSync(
  join(packageDir, 'dist/index.d.ts'),
  `export * from '${relativeSpecifier(join(packageDir, 'dist/index.d.ts'), entryOut)}'\n`
)

// The package is published under the repository's licence; ship the text.
copyFileSync(join(repoRoot, 'LICENSE'), join(packageDir, 'LICENSE'))

console.log(
  `[embed] wrote ${files.size} declaration files` +
    (vendored.size > 0 ? `; vendored types of ${[...vendored].sort().join(', ')}` : '')
)

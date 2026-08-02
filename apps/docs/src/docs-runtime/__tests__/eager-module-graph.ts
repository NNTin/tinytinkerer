/**
 * Walks the VALUE-import graph reachable from the documentation's eager roots
 * (issue #482).
 *
 * ## Why a walk and not a list
 *
 * `__tests__/static-safety.test.ts` used to assert its rule against a
 * hand-maintained array of file names. That array is a claim about the module
 * graph, and nothing checked the claim: by the time #482 audited it, it had
 * drifted in both directions at once — `AssistantPageRegion.tsx` and
 * `LatchedErrorBoundary.tsx` were reachable from `@theme/Root` and absent from
 * it, while `assistant-disclosure.ts` had been on it after becoming unreachable
 * (removed in `6ef3e5a`, for exactly that reason). A list that can be wrong in
 * either direction proves nothing in either.
 *
 * So the roots are declared and everything else is derived. Adding a module to
 * the eager path now brings it under the rule automatically, and a module that
 * stops being eager stops being asserted about — neither needs anybody to
 * remember.
 *
 * ## What counts as an edge
 *
 * A **value** edge: anything that survives to runtime and therefore creates a
 * chunk dependency.
 *
 * - `import type` / `export type`, and per-specifier `type` markers, are erased
 *   by the compiler and are not followed. That is what lets the light index
 *   re-export the session's TYPES while its values stay one module over.
 * - a bare `import './x.css'` IS an edge: it has no bindings, but it does have a
 *   runtime effect.
 * - `import('...')` — a dynamic import — is where the walk STOPS. It is the lazy
 *   boundary itself, and following it would report the whole product runtime as
 *   eager.
 *
 * Parsed with the TypeScript AST rather than matched with a regex, because every
 * distinction above is syntactic and a regex gets each of them wrong in a
 * different way (`export type {}` blocks, per-specifier `type` markers inside a
 * named clause, an `import(` inside a comment or a string).
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

/** A module the walk reached, with the edge that got it there. */
export type EagerModule = {
  /** Absolute path on disk. */
  readonly path: string
  /** Path relative to `apps/docs`, for readable failure messages. */
  readonly label: string
  /** The importing module's label, or `null` for a declared root. */
  readonly importedBy: string | null
}

export type EagerGraph = {
  /** Every first-party module reachable through value edges, roots included. */
  readonly modules: readonly EagerModule[]
  /**
   * Bare specifiers the graph reaches, mapped to the labels that import them.
   * A package subpath keeps its subpath (`@tinytinkerer/app-browser/styles.css`),
   * because "which entry point" is the whole question for that package.
   */
  readonly packages: ReadonlyMap<string, readonly string[]>
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']
const INDEXES = EXTENSIONS.map((extension) => `/index${extension}`)

/** A readable FILE — a directory that shares the name is not a resolution. */
const isFile = (candidate: string): boolean =>
  statSync(candidate, { throwIfNoEntry: false })?.isFile() === true

/**
 * Resolve a relative specifier the way the bundler does — extensionless first,
 * then a directory index.
 *
 * A CSS import resolves to itself and is recorded, but never parsed: it has no
 * imports of its own that this rule is about, and TypeScript cannot read it.
 */
const resolveRelative = (fromDirectory: string, specifier: string): string | null => {
  const base = resolve(fromDirectory, specifier)
  if (/\.(css|json|svg|png|jpe?g|webp)$/.test(specifier)) return isFile(base) ? base : null
  if (isFile(base) && /\.[a-z]+$/.test(base)) return base
  for (const extension of EXTENSIONS) {
    if (isFile(`${base}${extension}`)) return `${base}${extension}`
  }
  for (const index of INDEXES) {
    if (isFile(`${base}${index}`)) return `${base}${index}`
  }
  return null
}

/**
 * True when a declaration contributes nothing at runtime.
 *
 * Three shapes, and all three matter here: the whole declaration marked `type`,
 * every named specifier individually marked `type`, and — the one a regex
 * reliably misses — a named clause that is empty after the type-only specifiers
 * are removed.
 */
const isTypeOnly = (node: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    if (clause && ts.isNamedExports(clause)) {
      return clause.elements.every((element) => element.isTypeOnly)
    }
    return false
  }

  const clause = node.importClause
  // `import './x.css'` — no clause at all, and a real runtime effect.
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const bindings = clause.namedBindings
  if (!bindings) return false
  if (ts.isNamespaceImport(bindings)) return false
  return bindings.elements.every((element) => element.isTypeOnly)
}

/** Every value specifier a module declares, in source order. */
const valueSpecifiers = (path: string, source: string): string[] => {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const specifiers: string[] = []

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const moduleSpecifier = statement.moduleSpecifier
    // `export { x }` with no `from` re-exports a local binding: no new edge.
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue
    if (isTypeOnly(statement)) continue
    specifiers.push(moduleSpecifier.text)
  }

  // Deliberately NOT collecting `import(...)` call expressions: a dynamic import
  // is the lazy boundary this whole rule exists to protect, so the walk stops
  // there rather than reporting the runtime it guards as eager.
  return specifiers
}

/**
 * @param roots Absolute paths to the modules that are loaded without any
 * activation — `@theme/Root` for every documentation page, and anything an MDX
 * page imports eagerly.
 * @param appRoot Absolute path to `apps/docs`, used only to build labels.
 */
export const collectEagerModuleGraph = (roots: readonly string[], appRoot: string): EagerGraph => {
  const label = (path: string): string => path.slice(appRoot.length + 1)
  const modules = new Map<string, EagerModule>()
  const packages = new Map<string, string[]>()
  const queue: EagerModule[] = roots.map((path) => ({
    path,
    label: label(path),
    importedBy: null
  }))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || modules.has(current.path)) continue
    modules.set(current.path, current)
    // A stylesheet is a leaf: recorded as reached, never parsed.
    if (/\.css$/.test(current.path)) continue

    const source = readFileSync(current.path, 'utf8')
    for (const specifier of valueSpecifiers(current.path, source)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(dirname(current.path), specifier)
        // An unresolvable relative specifier is a bug in this walk, not
        // something to skip quietly: it would silently shrink the graph the
        // rule is asserted over.
        if (!resolved) {
          throw new Error(
            `Could not resolve "${specifier}" from ${current.label}. ` +
              'The eager-graph walk must reach every value import, so a miss here ' +
              'would make the bundle-boundary rule weaker without saying so.'
          )
        }
        queue.push({ path: resolved, label: label(resolved), importedBy: current.label })
        continue
      }
      packages.set(specifier, [...(packages.get(specifier) ?? []), current.label])
    }
  }

  return { modules: [...modules.values()], packages }
}

// @vitest-environment node
/**
 * The walker behind the bundle-boundary rule, tested on its own (issue #482,
 * review finding 5).
 *
 * `static-safety.test.ts` asserts a property of this repository *through* this
 * module, which means a walker that quietly stopped early would make that suite
 * pass by seeing less. So the edge kinds it must follow — and the one it must
 * not — are pinned here against fixtures, where the expected answer is written
 * down rather than derived from the same code under test.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectEagerModuleGraph, valueImportsOf } from './eager-module-graph'

let root: string

const write = (relativePath: string, source: string): string => {
  const path = join(root, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source, 'utf8')
  return path
}

const labelsFrom = (entry: string): string[] =>
  collectEagerModuleGraph([join(root, entry)], root).modules.map((module) => module.label)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eager-graph-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('edges the walk follows', () => {
  it('follows a relative import, and a directory index', () => {
    write('src/leaf.ts', 'export const leaf = 1\n')
    write('src/nested/index.ts', "export { leaf } from '../leaf'\n")
    write('src/entry.ts', "import { leaf } from './nested'\nexport const used = leaf\n")

    expect(labelsFrom('src/entry.ts')).toEqual(
      expect.arrayContaining(['src/entry.ts', 'src/nested/index.ts', 'src/leaf.ts'])
    )
  })

  it('follows a `@site/` alias, which is a documented import path here', () => {
    // The gap the first revision had: `@site/…` looked like a package, so a
    // module could reach the product runtime through one unwalked.
    write('src/deep.ts', 'export const deep = 1\n')
    write('src/entry.ts', "import { deep } from '@site/src/deep'\nexport const used = deep\n")

    expect(labelsFrom('src/entry.ts')).toContain('src/deep.ts')
  })

  it('follows a re-export, which is as much a runtime edge as an import', () => {
    write('src/re-exported.ts', 'export const value = 1\n')
    write('src/entry.ts', "export { value } from './re-exported'\n")

    expect(labelsFrom('src/entry.ts')).toContain('src/re-exported.ts')
  })

  it('follows a bare side-effect import, which binds nothing and runs everything', () => {
    write('src/effect.ts', 'globalThis.marker = true\n')
    write('src/entry.ts', "import './effect'\nexport const value = 1\n")

    expect(labelsFrom('src/entry.ts')).toContain('src/effect.ts')
  })

  it('records a stylesheet as reached without trying to parse it', () => {
    write('src/styles.css', '.a { color: red }\n')
    write('src/entry.ts', "import './styles.css'\nexport const value = 1\n")

    expect(labelsFrom('src/entry.ts')).toContain('src/styles.css')
  })
})

describe('edges the walk must NOT follow', () => {
  it('does not follow a type-only import, which the compiler erases', () => {
    write('src/types.ts', 'export type Thing = { a: number }\n')
    write('src/entry.ts', "import type { Thing } from './types'\nexport type Alias = Thing\n")

    expect(labelsFrom('src/entry.ts')).not.toContain('src/types.ts')
  })

  it('does not follow a per-specifier type marker, nor a type-only re-export', () => {
    write('src/types.ts', 'export type Thing = { a: number }\n')
    write('src/more.ts', 'export type Other = string\n')
    write(
      'src/entry.ts',
      "import { type Thing } from './types'\nexport type { Other } from './more'\nexport type A = Thing\n"
    )

    const labels = labelsFrom('src/entry.ts')
    expect(labels).not.toContain('src/types.ts')
    expect(labels).not.toContain('src/more.ts')
  })

  it('follows a MIXED clause, where only some specifiers are types', () => {
    // The inverse of the case above, and the one an over-eager rule gets wrong:
    // `import { value, type Thing }` still pulls the module at runtime.
    write('src/mixed.ts', 'export const value = 1\nexport type Thing = number\n')
    write(
      'src/entry.ts',
      "import { value, type Thing } from './mixed'\nexport const used = value\n"
    )

    expect(labelsFrom('src/entry.ts')).toContain('src/mixed.ts')
  })

  it('stops at a dynamic import — the lazy boundary the whole rule protects', () => {
    write('src/runtime.ts', 'export const heavy = 1\n')
    write('src/entry.ts', "export const load = () => import('./runtime')\nexport const value = 1\n")

    expect(labelsFrom('src/entry.ts')).not.toContain('src/runtime.ts')
  })
})

describe('specifiers it refuses to guess about', () => {
  it('throws on an unresolvable first-party specifier rather than seeing less', () => {
    write('src/entry.ts', "import { gone } from './missing'\nexport const used = gone\n")

    expect(() => labelsFrom('src/entry.ts')).toThrow(/Could not resolve/)
  })

  it('throws on a first-party-looking alias it has not been taught', () => {
    write('src/entry.ts', "import { x } from '@docs/some/deep/path'\nexport const used = x\n")

    expect(() => labelsFrom('src/entry.ts')).toThrow(/Unrecognised first-party-looking specifier/)
  })

  it('leaves ordinary packages and Docusaurus aliases alone', () => {
    write(
      'src/entry.ts',
      "import { useMemo } from 'react'\nimport Root from '@theme-original/Root'\n" +
        "import { x } from '@tinytinkerer/app-browser/chat-presentation'\n" +
        'export const used = [useMemo, Root, x]\n'
    )

    const graph = collectEagerModuleGraph([join(root, 'src/entry.ts')], root)
    expect([...graph.packages.keys()]).toEqual(
      expect.arrayContaining([
        'react',
        '@theme-original/Root',
        '@tinytinkerer/app-browser/chat-presentation'
      ])
    )
  })
})

describe('valueImportsOf', () => {
  it('reports side-effect imports, which a `from`-shaped regex cannot see', () => {
    const path = write(
      'src/facade.ts',
      "import './runtime'\nimport type { T } from './types'\nexport { a } from './a'\n"
    )

    expect(valueImportsOf(path)).toEqual(['./runtime', './a'])
  })
})

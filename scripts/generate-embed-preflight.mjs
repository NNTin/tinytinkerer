// Generates the SCOPED copy of Tailwind's preflight that a TinyTinkerer surface
// embedded in a themed host needs (issue #480 re-review, finding 3).
//
// ## Why a copy exists at all
//
// Every deployable TinyTinkerer app imports `tailwindcss`, whose preflight resets
// `button`/`input`/`ul`/heading defaults to nothing so the utility classes the
// shared components render with are the ONLY thing styling them. A host with its
// own theme — the Docusaurus documentation site, whose Infima stylesheet styles
// those same elements — cannot import that preflight globally without wrecking
// its own pages. So it gets the same rules, confined to a region.
//
// ## Why it is GENERATED rather than written
//
// It used to be hand-maintained: a selected subset of preflight, transcribed,
// with a comment asking the next person to keep it in step and an end-to-end test
// sampling two elements to notice if they had not. That is a fork with a parity
// promise, and a Tailwind upgrade that changed what preflight does would have
// sailed straight past it. This reads the PINNED `tailwindcss/preflight.css` and
// rewrites it, so an upgrade changes this script's output, the freshness check
// (`--check`) fails, and a person looks at the diff.
//
// ## The transform
//
// Everything below is a total, deterministic rule. Anything the script does not
// recognise THROWS rather than being passed through, because silently emitting a
// construct this scoping model cannot express is the one failure mode that would
// reintroduce the original bug.
//
//   1. Every selector is prefixed with `:where(.tt-app-embed) `. `:where()`
//      contributes ZERO specificity, so each rule weighs exactly what the bare
//      selector preflight uses weighs. That is load-bearing in both directions:
//      it BEATS the host's own element rules (Infima's `ul`, `p`, `button`, also
//      (0,0,1) but declared earlier), and it LOSES to every Tailwind utility
//      (0,1,0) — which is precisely how preflight relates to utilities inside a
//      product build. A host-authored `.some-scope button {}` would be (0,1,1)
//      and beat the utilities instead, which is the bug this file ends.
//
//   2. A bare `*` is ALSO expanded over an explicit element list, because
//      `:where(.x) *` is (0,0,0) and would lose to every one of the host's
//      element rules. Both forms are emitted: the `*` covers properties nothing
//      else sets, and the enumeration covers the elements a theme styles.
//
//   3. `html` and `:host` rules are DROPPED. They set page-level typography and
//      tap behaviour on the document root, which belongs to the host — an embed
//      that restyled it would be reaching outside its own region.
//
//   4. `--theme(--x, fallback…)` becomes `var(--x, fallback…)`. Tailwind resolves
//      `--theme()` at build time against an `@theme` block this stylesheet is not
//      compiled with; `var()` performs the same lookup-with-fallback at runtime,
//      which is the correct behaviour for a host that may or may not declare the
//      theme variable.
//
// Run `pnpm generate:embed-preflight`; `--check` verifies the committed file
// matches without writing.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const rootDir = process.cwd()

const OUTPUT_PATH = join(rootDir, 'packages/app/app-browser/src/embed-preflight.generated.css')

/** The class marking a region these rules apply to. */
const SCOPE = '.tt-app-embed'

/**
 * The elements a bare `*` is expanded over (see transform rule 2).
 *
 * Deliberately generous: this is preflight's own reset, so applying it to an
 * element the surfaces do not currently render costs nothing, while OMITTING one
 * they start rendering is the failure that made a suggestion button render as
 * bulleted plain text. Void and metadata elements are left out because they have
 * no box to reset.
 */
const RESET_ELEMENTS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'audio',
  'b',
  'blockquote',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'menu',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  's',
  'samp',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'video'
]

/** Selectors that address the document root, and are therefore the host's. */
const HOST_OWNED_SELECTORS = new Set(['html', ':host'])

/** At-rules this transform knows how to descend into. Anything else throws. */
const SUPPORTED_AT_RULES = new Set(['@supports', '@media'])

/** Split a selector list on top-level commas (a `:is(a, b)` must stay intact). */
const splitSelectors = (list) => {
  const parts = []
  let depth = 0
  let current = ''
  for (const character of list) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const scopeSelector = (selector) => {
  if (HOST_OWNED_SELECTORS.has(selector)) return []
  if (selector === '*') {
    // The region itself, the cheap universal form, and the enumeration that
    // actually outranks a host theme. See transform rule 2.
    return [
      `:where(${SCOPE})`,
      `:where(${SCOPE}) *`,
      ...RESET_ELEMENTS.map((element) => `:where(${SCOPE}) ${element}`)
    ]
  }
  return [`:where(${SCOPE}) ${selector}`]
}

/**
 * Rewrite a declaration block and re-indent it to one level.
 *
 * Declarations are re-indented rather than trimmed line by line because
 * preflight wraps long values (the mono font stack) across several lines, and
 * flattening those to column 2 produces valid but unreadable CSS.
 */
const rewriteDeclarations = (block) => {
  const lines = block.replaceAll('--theme(', 'var(').split('\n')
  const meaningful = lines.filter((line) => line.trim())
  const common = Math.min(...meaningful.map((line) => line.length - line.trimStart().length))
  return meaningful.map((line) => `  ${line.slice(common)}`).join('\n')
}

/**
 * Walk a stylesheet body, emitting the transformed text.
 *
 * Hand-written rather than delegated to a CSS parser on purpose: preflight is a
 * flat sheet of comments, rules and one `@supports`, and a walker that throws on
 * anything else gives a stronger guarantee than a permissive parser that would
 * quietly pass an unrecognised construct through unscoped.
 */
export const transform = (source) => {
  const output = []
  let index = 0
  let pendingComment = null

  const emit = (text) => {
    if (pendingComment !== null) {
      output.push(pendingComment)
      pendingComment = null
    }
    output.push(text)
  }

  const readBalancedBlock = (start) => {
    let depth = 0
    for (let cursor = start; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1
      if (source[cursor] === '}') {
        depth -= 1
        if (depth === 0) return cursor
      }
    }
    throw new Error('Unbalanced block in tailwindcss/preflight.css')
  }

  while (index < source.length) {
    // Whitespace between constructs is discarded; the emitter re-adds it.
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }

    // Comments are kept verbatim: they are why each rule exists. Held back one
    // step, so a comment introducing a rule this transform DROPS is dropped with
    // it rather than left explaining something that is no longer there.
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index)
      if (end === -1) throw new Error('Unterminated comment in tailwindcss/preflight.css')
      pendingComment = source.slice(index, end + 2)
      index = end + 2
      continue
    }

    const braceAt = source.indexOf('{', index)
    if (braceAt === -1) {
      const trailing = source.slice(index).trim()
      if (trailing) throw new Error(`Unhandled trailing content: ${trailing}`)
      break
    }

    const prelude = source.slice(index, braceAt).trim()
    const blockEnd = readBalancedBlock(braceAt)
    const body = source.slice(braceAt + 1, blockEnd)

    if (prelude.startsWith('@')) {
      const name = prelude.split(/[\s(]/, 1)[0]
      if (!SUPPORTED_AT_RULES.has(name)) {
        throw new Error(
          `Unsupported at-rule "${name}" in tailwindcss/preflight.css. ` +
            'Teach scripts/generate-embed-preflight.mjs how to scope it before regenerating.'
        )
      }
      const inner = transform(body)
      emit(`${prelude} {\n${inner.replace(/^(?=.)/gm, '  ').trimEnd()}\n}`)
      index = blockEnd + 1
      continue
    }

    const selectors = splitSelectors(prelude).flatMap(scopeSelector)
    if (selectors.length > 0) {
      emit(`${selectors.join(',\n')} {\n${rewriteDeclarations(body)}\n}`)
    } else {
      // The whole rule was host-owned; its comment goes with it.
      pendingComment = null
    }
    index = blockEnd + 1
  }

  if (pendingComment !== null) output.push(pendingComment)
  return output.join('\n\n')
}

const HEADER = `/*
 * GENERATED FILE — do not edit.
 *
 * Tailwind's preflight, scoped to \`${SCOPE}\`, produced from the pinned
 * \`tailwindcss/preflight.css\` by scripts/generate-embed-preflight.mjs. Run
 * \`pnpm generate:embed-preflight\` to refresh it; \`pnpm check:embed-preflight\`
 * fails CI when it is stale.
 *
 * Read that script for the scoping model and why each transform rule exists.
 * Host-specific additions this file deliberately does NOT contain live beside it
 * in embed.css.
 */
`

const main = async () => {
  const preflightPath = require.resolve('tailwindcss/preflight.css', {
    paths: [join(rootDir, 'apps/docs')]
  })
  const source = await readFile(preflightPath, 'utf8')
  const generated = `${HEADER}\n${transform(source)}\n`

  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (current !== generated) {
      console.error(
        `${OUTPUT_PATH} is stale.\n` +
          'Tailwind’s preflight (or the scoping transform) has changed. Run ' +
          '`pnpm generate:embed-preflight`, then review the diff: it is a change to what every ' +
          'embedded TinyTinkerer surface resets.'
      )
      process.exitCode = 1
      return
    }
    console.log('Scoped embed preflight is up to date.')
    return
  }

  await writeFile(OUTPUT_PATH, generated)
  console.log(`Generated scoped embed preflight at ${OUTPUT_PATH}`)
}

// Only when run as a command. The transform above is imported directly by
// scripts/generate-embed-preflight.test.mjs, which pins each rewriting rule
// against a fixture rather than against whatever Tailwind currently ships.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}

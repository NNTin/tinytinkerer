/**
 * Keeping the published stylesheets off the host page (issue #518, F1).
 *
 * The workspace's stylesheets are written for deployable apps, which own their
 * document: tokens.css puts the base palette and `color-scheme` on `:root`,
 * token-graph.css declares the derived graph for `:root` as well as the embed
 * scope, Tailwind's theme lands on `:root, :host`, and neutral-palette.css keys
 * shell-only rules on attributes of `<html>`. Shipped as they are, those blocks
 * recolour a host page the moment it loads the sheet — CanFactory's `--accent`
 * and `--muted` turned amber page-wide.
 *
 * The deployable apps keep all of that unchanged. Only THIS build rewrites its
 * output, in two steps, both used by vite.config.ts and re-checked by
 * scripts/check-package.mjs:
 *
 * 1. **Scope** ({@link scopeStylesheet}). Every document-level selector moves
 *    onto the embed scope. The base values (tokens.css's palette, Tailwind's
 *    theme) go on the OUTERMOST `.tt-app-embed` only, so a host that themes its
 *    wrapper is not reset by the stage element `ChatApp` also marks with the
 *    class. The derived graph stays on every scope, which is what makes its
 *    formulas resolve against the bases in force there (token-graph.css
 *    explains why). Shell-only `:root[…]` rules are dropped. Anything else on
 *    `:root` or `:host` fails the build, so a new global block is a decision
 *    rather than a leak.
 * 2. **Namespace** ({@link namespaceTokens}). The palette tokens are renamed
 *    `--tt-*` — in the CSS here, and in the workspace's own modules by a
 *    transform in vite.config.ts, so Tailwind's arbitrary-value class names
 *    (`bg-[var(--panel)]`) and the selectors generated for them stay in step.
 *    A host's own `--accent` therefore never collides with the surface's, and a
 *    `ShellThemeTokens` value may be `var(--accent)`: it is written to
 *    `--tt-accent`, so it refers to the HOST's token instead of to itself.
 */
import postcss from 'postcss'

/** Every palette token tokens.css and token-graph.css declare. */
export const PALETTE_TOKENS = [
  'bg',
  'panel',
  'muted',
  'border',
  'text',
  'accent',
  'link',
  'accent-strong',
  'text-strong',
  'panel-hover',
  'accent-ring',
  'accent-soft',
  'user-bubble',
  'border-strong',
  'widget-bg',
  'widget-panel',
  'widget-border',
  'widget-text',
  'widget-muted'
]

export const TOKEN_PREFIX = 'tt-'

// Whole names only: `--text` but not Tailwind's `--text-xs`, `--border` but not
// `--border-strong` (which is matched on its own, longest first).
const tokenPattern = new RegExp(
  `(?<![\\w-])--(${[...PALETTE_TOKENS].sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`,
  'g'
)

/** Renames every palette token in `text` to its `--tt-*` name. */
export const namespaceTokens = (text) => text.replace(tokenPattern, `--${TOKEN_PREFIX}$1`)

/** The palette tokens `text` still names WITHOUT the prefix. */
export const unprefixedTokens = (text) => [
  ...new Set([...text.matchAll(tokenPattern)].map((match) => `--${match[1]}`))
]

const SCOPE = ':where(.tt-app-embed)'
// The outermost scope: a `.tt-app-embed` with no `.tt-app-embed` ancestor. All
// inside `:where()`, so it adds no specificity and any host rule outranks it.
const OUTERMOST_SCOPE = ':where(.tt-app-embed:not(.tt-app-embed *))'
// The scope element and everything in it — for Tailwind's `*, ::before, …`
// fallback block, which would otherwise reset `--tw-*` on every host element.
const SCOPE_AND_DESCENDANTS = ':where(.tt-app-embed, .tt-app-embed *)'

const DOCUMENT_SELECTOR = /:root|:host/
const isKeyframe = (rule) => rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)

const scopeSelectors = (selectors) => {
  const list = selectors.map((selector) => selector.trim())
  const has = (selector) => list.includes(selector)

  // tokens.css's base block (`:root`) and Tailwind's theme (`:root, :host`).
  if (list.every((selector) => selector === ':root' || selector === ':host')) {
    return [OUTERMOST_SCOPE]
  }
  // token-graph.css: already declared for the scope as well.
  if (has(SCOPE) && list.every((selector) => selector === ':root' || selector === SCOPE)) {
    return [SCOPE]
  }
  return list.flatMap((selector) => {
    // neutral-palette.css: attributes the deployable shells set on <html>.
    if (/^:root\[[^\]]+\]/.test(selector)) {
      return []
    }
    if (DOCUMENT_SELECTOR.test(selector)) {
      throw new Error(`no embed scope is defined for the document-level selector "${selector}"`)
    }
    const universal = /^(\*|::?[a-z-]+)$/.exec(selector)
    if (universal) {
      return [selector === '*' ? SCOPE_AND_DESCENDANTS : `${SCOPE_AND_DESCENDANTS}${selector}`]
    }
    return [selector]
  })
}

/** Moves every document-level rule of a stylesheet onto the embed scope. */
export const scopeStylesheet = (css) => {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    if (isKeyframe(rule)) {
      return
    }
    const selectors = scopeSelectors(rule.selectors)
    if (selectors.length === 0) {
      rule.remove()
    } else {
      rule.selectors = selectors
    }
  })
  // A rule dropped above can leave an empty at-rule behind.
  root.walkAtRules((atRule) => {
    if (atRule.nodes?.length === 0) {
      atRule.remove()
    }
  })
  return root.toString()
}

/**
 * Every selector in `css` that could match outside a TinyTinkerer surface: one
 * naming `:root` or `:host`, or one with no class in it at all (a bare `*`,
 * `body`, `[data-x]`). Comments are not selectors, so prose about `:root` in a
 * shipped comment is fine.
 */
export const hostLeakingSelectors = (css) => {
  const leaks = []
  postcss.parse(css).walkRules((rule) => {
    if (isKeyframe(rule)) {
      return
    }
    for (const selector of rule.selectors) {
      if (DOCUMENT_SELECTOR.test(selector) || !/\.[\w\\-]/.test(selector)) {
        leaks.push(selector)
      }
    }
  })
  return leaks
}

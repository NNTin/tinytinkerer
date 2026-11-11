import { describe, expect, it } from 'vitest'
import {
  hostLeakingSelectors,
  namespaceTokens,
  scopeStylesheet,
  unprefixedTokens
} from './host-isolation.mjs'

describe('namespaceTokens (issue #518, F1)', () => {
  it('renames whole palette names only', () => {
    expect(namespaceTokens('color: var(--text); font-size: var(--text-xs)')).toBe(
      'color: var(--tt-text); font-size: var(--text-xs)'
    )
    expect(namespaceTokens('--border: 1px; --border-strong: 2px')).toBe(
      '--tt-border: 1px; --tt-border-strong: 2px'
    )
  })

  it('renames Tailwind arbitrary-value classes and their escaped selectors alike', () => {
    expect(namespaceTokens('bg-[var(--panel)] bg-(--accent)')).toBe(
      'bg-[var(--tt-panel)] bg-(--tt-accent)'
    )
    expect(namespaceTokens('.bg-\\[var\\(--panel\\)\\]')).toBe('.bg-\\[var\\(--tt-panel\\)\\]')
  })

  it('leaves non-palette and already-prefixed names alone', () => {
    const css = '--tw-shadow: 0; --spacing: 1px; --tt-accent: red; --accent-foreground: x'
    expect(namespaceTokens(css)).toBe(css)
    expect(unprefixedTokens(css)).toEqual([])
  })
})

describe('scopeStylesheet (issue #518, F1)', () => {
  it('puts base blocks on the outermost scope and the graph on every scope', () => {
    const out = scopeStylesheet(
      ':root { --bg: #fff } :root, :host { --spacing: 1px } :root, :where(.tt-app-embed) { --a: 1 }'
    )
    expect(out).toContain(':where(.tt-app-embed:not(.tt-app-embed *)) { --bg: #fff }')
    expect(out).toContain(':where(.tt-app-embed:not(.tt-app-embed *)) { --spacing: 1px }')
    expect(out).toContain(':where(.tt-app-embed) { --a: 1 }')
    expect(hostLeakingSelectors(out)).toEqual([])
  })

  it('drops shell-only :root[…] rules and the at-rules they leave empty', () => {
    const out = scopeStylesheet(
      '@media (min-width: 1px) { :root[data-shell="widget"] body { margin: 0 } } .a { color: red }'
    )
    expect(out).not.toContain('data-shell')
    expect(out).not.toContain('@media')
    expect(out).toContain('.a { color: red }')
  })

  it('scopes the universal fallback block and keeps keyframes untouched', () => {
    const out = scopeStylesheet(
      '*, :before, ::backdrop { --tw-x: 0 } @keyframes k { from { opacity: 0 } to { opacity: 1 } }'
    )
    expect(out).toContain(':where(.tt-app-embed, .tt-app-embed *)::backdrop')
    expect(out).toContain('from { opacity: 0 }')
    expect(hostLeakingSelectors(out)).toEqual([])
  })

  it('fails on a document-level selector it has no rule for', () => {
    expect(() => scopeStylesheet(':root body { margin: 0 }')).toThrow(/:root body/)
  })
})

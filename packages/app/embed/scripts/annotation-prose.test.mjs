import { describe, expect, it } from 'vitest'
import { disarmAnnotationProse } from './annotation-prose.mjs'

describe('disarmAnnotationProse (issue #518, F13)', () => {
  it('keeps real annotations, spaced or not, even when they open a line', () => {
    for (const code of [
      'const x =\n  /* @__PURE__ */ foo();',
      'const x =\n/*#__PURE__*/ foo();',
      'const x = /* @__PURE__ */ new Map();',
      '/* @__NO_SIDE_EFFECTS__ */\nfunction f() {}',
      '/*\t#__PURE__\t*/ foo();'
    ]) {
      expect(disarmAnnotationProse(code)).toBe(code)
    }
  })

  it('disarms a marker mentioned in a line-leading doc comment', () => {
    const zod = [
      '/** Anchors a pattern source. esbuild will not drop a `@__PURE__` call',
      ' * whose own argument interpolates a variable. */',
      'function anchor(source) {}'
    ].join('\n')
    const disarmed = disarmAnnotationProse(zod)
    expect(disarmed).toContain('a `__PURE__` call')
    expect(disarmed).not.toMatch(/[#@]__PURE__/)
  })

  it('leaves comment-like text inside a string alone', () => {
    const code = 'const s = "/* mentions @__PURE__ */";'
    expect(disarmAnnotationProse(code)).toBe(code)
  })
})

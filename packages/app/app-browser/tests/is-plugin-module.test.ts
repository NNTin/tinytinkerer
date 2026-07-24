import { describe, expect, it } from 'vitest'
import { isPluginModule as canonicalIsPluginModule } from '@tinytinkerer/app-core'
import { isPluginModule } from '../src/plugins/is-plugin-module.js'

// Guards the intentional duplication in src/plugins/is-plugin-module.ts
// (issue #441): that copy exists so registry.ts never statically imports a
// VALUE from @tinytinkerer/app-core (which would drag the whole merged
// app-core/agent-core/contracts chunk onto the entry's static graph). This
// test file is not part of the shipped bundle, so it's free to import both
// implementations and assert they agree on every case.
const cases: [string, unknown][] = [
  ['non-object', 'not-a-module'],
  ['null', null],
  ['missing createPlugin', { manifest: { id: 'a', label: 'A', description: 'a' } }],
  [
    'non-function createPlugin',
    { manifest: { id: 'a', label: 'A', description: 'a' }, createPlugin: 'nope' }
  ],
  ['missing manifest', { createPlugin: () => ({}) }],
  ['null manifest', { manifest: null, createPlugin: () => ({}) }],
  ['manifest missing id', { manifest: { label: 'A', description: 'a' }, createPlugin: () => ({}) }],
  ['manifest missing label', { manifest: { id: 'a', description: 'a' }, createPlugin: () => ({}) }],
  ['manifest missing description', { manifest: { id: 'a', label: 'A' }, createPlugin: () => ({}) }],
  [
    'valid module',
    { manifest: { id: 'a', label: 'A', description: 'a' }, createPlugin: () => ({}) }
  ]
]

describe('is-plugin-module entry-safe duplicate', () => {
  for (const [label, value] of cases) {
    it(`agrees with @tinytinkerer/app-core's isPluginModule for: ${label}`, () => {
      expect(isPluginModule(value)).toBe(canonicalIsPluginModule(value))
    })
  }
})

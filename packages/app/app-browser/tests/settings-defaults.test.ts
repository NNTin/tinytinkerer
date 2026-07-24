import { describe, expect, it } from 'vitest'
import {
  SETTINGS_KEYS as canonicalSettingsKeys,
  defaultSettingsState as canonicalDefaultSettingsState
} from '@tinytinkerer/app-core'
import { SETTINGS_KEYS, defaultSettingsState } from '../src/stores/settings-defaults.js'

// Guards the intentional duplication in src/stores/settings-defaults.ts (issue
// #441): that copy exists so settings-store.ts never statically imports a
// VALUE from @tinytinkerer/app-core (which would drag the whole merged
// app-core/agent-core/contracts chunk onto the entry's static graph). This
// test file is not part of the shipped bundle, so it's free to import both
// implementations and assert they agree.
describe('settings-defaults entry-safe duplicate', () => {
  it('matches @tinytinkerer/app-core SETTINGS_KEYS', () => {
    expect(SETTINGS_KEYS).toEqual(canonicalSettingsKeys)
  })

  it('matches @tinytinkerer/app-core defaultSettingsState()', () => {
    expect(defaultSettingsState()).toEqual(canonicalDefaultSettingsState())
  })
})

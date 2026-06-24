import { describe, expect, it } from 'vitest'
import { deriveStarterPrompts } from '../src/conversation-empty-state.js'

const baseFillers = [
  'Explain a concept in simple terms.',
  'Brainstorm ideas with me.',
  'Help me draft a message.',
  'Summarize some text I paste.'
]

describe('deriveStarterPrompts (B3)', () => {
  it('returns only the neutral fillers when nothing is enabled', () => {
    expect(
      deriveStarterPrompts({ manifests: [], pluginActivation: {}, hasEnabledMcpServer: false })
    ).toEqual(baseFillers)
  })

  it('puts an enabled plugin starter prompt first, never advertising disabled plugins', () => {
    const manifests = [
      { id: 'search', defaultEnabled: true, starterPrompt: 'Research a topic for me.' },
      { id: 'code', defaultEnabled: false, starterPrompt: 'Help me debug this code.' }
    ]
    const prompts = deriveStarterPrompts({
      manifests,
      pluginActivation: {},
      hasEnabledMcpServer: false
    })
    expect(prompts[0]).toBe('Research a topic for me.')
    // code is off by default and has no explicit activation → not advertised.
    expect(prompts).not.toContain('Help me debug this code.')
  })

  it('honors an explicit activation override over defaultEnabled', () => {
    const manifests = [
      { id: 'code', defaultEnabled: false, starterPrompt: 'Help me debug this code.' }
    ]
    const prompts = deriveStarterPrompts({
      manifests,
      pluginActivation: { code: true },
      hasEnabledMcpServer: false
    })
    expect(prompts).toContain('Help me debug this code.')
  })

  it('adds the MCP automation prompt when a server is enabled', () => {
    const prompts = deriveStarterPrompts({
      manifests: [],
      pluginActivation: {},
      hasEnabledMcpServer: true
    })
    expect(prompts).toContain('Help me automate a workflow.')
  })

  it('deduplicates while keeping first occurrence order', () => {
    const manifests = [
      { id: 'a', defaultEnabled: true, starterPrompt: 'Brainstorm ideas with me.' }
    ]
    const prompts = deriveStarterPrompts({
      manifests,
      pluginActivation: {},
      hasEnabledMcpServer: false
    })
    expect(prompts.filter((p) => p === 'Brainstorm ideas with me.')).toHaveLength(1)
    expect(prompts[0]).toBe('Brainstorm ideas with me.')
  })
})

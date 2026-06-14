import {
  isPluginModule,
  runChatEventHooks,
  type AgentHookContribution,
  type PluginHost
} from '@tinytinkerer/agent-core'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as eventLoggerModule from '../src/index'
import {
  EVENT_LOGGER_PLUGIN_ID,
  eventLoggerPlugin,
  eventLoggerPluginManifest
} from '../src/index'

// A representative chat event. Every ChatEvent shares { id, timestamp, type,
// payload } (see eventBaseSchema in @tinytinkerer/contracts).
const sampleEvent: ChatEvent = {
  id: 'evt-1',
  timestamp: '2026-06-14T00:00:00.000Z',
  type: 'user.message',
  payload: { text: 'hello world' }
}

describe('eventLoggerPlugin', () => {
  let info: ReturnType<typeof vi.spyOn>
  let debug: ReturnType<typeof vi.spyOn>
  let groupCollapsed: ReturnType<typeof vi.spyOn>
  let groupEnd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    groupCollapsed = vi
      .spyOn(console, 'groupCollapsed')
      .mockImplementation(() => {})
    groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('contributes a single chat.event observer hook and no tools', () => {
    const host: PluginHost = { capture: vi.fn() }
    const plugin = eventLoggerPlugin()
    expect(plugin.createTools).toBeUndefined()
    const hooks = plugin.createHooks?.(host) ?? []
    expect(hooks).toHaveLength(1)
    expect(hooks[0]!.event).toBe('chat.event')
  })

  it('logs verbose event detail to the console when fed a chat event', () => {
    const host: PluginHost = { capture: vi.fn() }
    const [hook] = eventLoggerPlugin().createHooks?.(host) ?? []
    expect(hook!.event).toBe('chat.event')

    // Narrow to the observer variant so handler accepts a ChatEventHookContext.
    if (hook!.event !== 'chat.event') {
      throw new Error('expected a chat.event hook')
    }
    hook!.handler({ event: sampleEvent })

    // One-line breadcrumb on console.info carrying the event type + plugin id.
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]![0]).toContain(EVENT_LOGGER_PLUGIN_ID)
    expect(info.mock.calls[0]![0]).toContain('user.message')

    // Verbose detail grouped under a collapsed group.
    expect(groupCollapsed).toHaveBeenCalledTimes(1)
    expect(groupEnd).toHaveBeenCalledTimes(1)

    // The full payload and timestamp are emitted via console.debug.
    const debugArgs = debug.mock.calls as unknown[][]
    expect(debugArgs).toContainEqual(['plugin', EVENT_LOGGER_PLUGIN_ID])
    expect(debugArgs).toContainEqual(['type', 'user.message'])
    expect(debugArgs).toContainEqual(['event timestamp', sampleEvent.timestamp])
    expect(debugArgs).toContainEqual(['payload', sampleEvent.payload])
  })

  it('logs when driven through the runtime runChatEventHooks helper', async () => {
    const host: PluginHost = { capture: vi.fn() }
    const hooks = (eventLoggerPlugin().createHooks?.(host) ??
      []) as readonly AgentHookContribution[]

    await runChatEventHooks(hooks, { event: sampleEvent })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]![0]).toContain('user.message')
  })

  it('manifest id matches the plugin id and advertises the hooks capability', () => {
    expect(eventLoggerPluginManifest.id).toBe(EVENT_LOGGER_PLUGIN_ID)
    expect(eventLoggerPlugin().id).toBe(EVENT_LOGGER_PLUGIN_ID)
    expect(eventLoggerPluginManifest.capabilities).toEqual(['hooks'])
    expect(eventLoggerPluginManifest.toolDescriptors).toBeUndefined()
  })

  it('satisfies the PluginModule contract for dynamic discovery', () => {
    // The host loads this module dynamically and validates it with isPluginModule,
    // so the package must export a contract-shaped `manifest` + `createPlugin`.
    expect(isPluginModule(eventLoggerModule)).toBe(true)
    expect(eventLoggerModule.manifest.id).toBe(EVENT_LOGGER_PLUGIN_ID)
    expect(eventLoggerModule.createPlugin().id).toBe(EVENT_LOGGER_PLUGIN_ID)
  })
})

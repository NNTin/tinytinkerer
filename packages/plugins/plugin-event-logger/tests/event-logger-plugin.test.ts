import {
  isPluginModule,
  type ChatEvent,
  type PluginHost
} from '@tinytinkerer/contracts'
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
  let log: ReturnType<typeof vi.spyOn>
  let groupCollapsed: ReturnType<typeof vi.spyOn>
  let groupEnd: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
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

    // The full payload and timestamp are emitted via console.log (NOT
    // console.debug, which devtools hides at the default "Verbose" filter).
    const logArgs = log.mock.calls as unknown[][]
    expect(logArgs).toContainEqual(['plugin', EVENT_LOGGER_PLUGIN_ID])
    expect(logArgs).toContainEqual(['type', 'user.message'])
    expect(logArgs).toContainEqual(['event timestamp', sampleEvent.timestamp])
    expect(logArgs).toContainEqual(['payload', sampleEvent.payload])
    expect(logArgs).toContainEqual(['event', sampleEvent])
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

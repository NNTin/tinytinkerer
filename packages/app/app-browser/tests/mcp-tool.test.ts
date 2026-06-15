import { describe, expect, it } from 'vitest'
import { isMcpToolId, summarizeMcpActivity } from '../src/runtime/mcp-tool'

describe('isMcpToolId', () => {
  it('recognizes the mcp:<server>:<tool> id pattern', () => {
    expect(isMcpToolId('mcp:server-1:list_files')).toBe(true)
    expect(isMcpToolId('mcp:s:t:with:colons')).toBe(true)
  })

  it('rejects non-MCP tool ids', () => {
    expect(isMcpToolId('web-search')).toBe(false)
    expect(isMcpToolId('run_javascript')).toBe(false)
    expect(isMcpToolId('mcp:')).toBe(false)
  })
})

describe('summarizeMcpActivity', () => {
  it('maps text output to an ok view with an Output section, titled by the host label', () => {
    const view = summarizeMcpActivity('[Docs] search', { text: 'found 3 files', isError: false })
    expect(view).toEqual({
      title: '[Docs] search',
      status: 'ok',
      sections: [{ label: 'Output', value: 'found 3 files' }]
    })
  })

  it('maps an error result to an error view with an Error section', () => {
    const view = summarizeMcpActivity('[Docs] search', { text: 'boom', isError: true })
    expect(view.status).toBe('error')
    expect(view.sections).toEqual([{ label: 'Error', value: 'boom' }])
  })

  it('emits no sections when there is no text (never assumes a shape)', () => {
    expect(summarizeMcpActivity('tool', {}).sections).toEqual([])
    expect(summarizeMcpActivity('tool', undefined).sections).toEqual([])
    expect(summarizeMcpActivity('tool', { text: 42 }).sections).toEqual([])
  })
})

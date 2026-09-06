import { describe, expect, it } from 'vitest'
import { collectSseChatCompletion } from './collect-sse-chat-completion.js'

const sseBody = (lines: Array<Record<string, unknown> | '[DONE]'>): string =>
  lines.map((line) => `data: ${line === '[DONE]' ? '[DONE]' : JSON.stringify(line)}`).join('\n\n')

describe('collectSseChatCompletion', () => {
  it('reassembles content deltas into a single message', () => {
    const raw = sseBody([
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' } }] },
      { choices: [{ index: 0, delta: { content: 'lo' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      '[DONE]'
    ])

    expect(collectSseChatCompletion(raw)).toEqual({
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }]
    })
  })

  it('omits finish_reason rather than defaulting it to null when no chunk sets it', () => {
    const raw = sseBody([{ choices: [{ index: 0, delta: { content: 'hi' } }] }, '[DONE]'])

    const result = collectSseChatCompletion(raw)
    expect(result.choices[0]?.finish_reason).toBeUndefined()
    expect(Object.hasOwn(result.choices[0] ?? {}, 'finish_reason')).toBe(false)
  })

  it('reassembles a native tool call split across multiple deltas', () => {
    const raw = sseBody([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'run_' } }]
            }
          }
        ]
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'javascript' } }] } }
        ]
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"code":' } }] }
          }
        ]
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"1"}' } }] } }
        ]
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]'
    ])

    expect(collectSseChatCompletion(raw)).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'run_javascript', arguments: '{"code":"1"}' }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ]
    })
  })

  it('carries a terminal usage chunk when the upstream includes one', () => {
    const raw = sseBody([
      { choices: [{ index: 0, delta: { content: 'ok' } }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } },
      '[DONE]'
    ])

    expect(collectSseChatCompletion(raw).usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 3,
      total_tokens: 15
    })
  })

  it('returns no choices for a body with no data lines (e.g. an HTML error page)', () => {
    expect(collectSseChatCompletion('<html>502 Bad Gateway</html>')).toEqual({ choices: [] })
  })

  it('drops a malformed data line instead of throwing', () => {
    const raw = ['data: not json', 'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}'].join(
      '\n\n'
    )

    expect(collectSseChatCompletion(raw)).toEqual({
      choices: [{ message: { role: 'assistant', content: 'ok' } }]
    })
  })
})

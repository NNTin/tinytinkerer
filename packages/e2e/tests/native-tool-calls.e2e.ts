import { test, expect } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  runSnippetViaChat,
  type LiteLLMMock
} from '../fixtures/mock-litellm'
import * as snippets from '../fixtures/snippets'

// End-to-end proof of the native tool-call context shape (GitHub issue #276).
// A run_javascript tool call is driven through the real edge worker (only LiteLLM
// is mocked); the mock's `requestBodies()` captures the EXACT payload the edge
// forwarded. We assert that both model-call paths — react.decide AND models.chat
// (synthesize) — replay the tool I/O as native OpenAI `assistant.tool_calls` +
// `tool` result messages, that the tools are advertised, and that NONE of the
// retired "Research notes:/Tool results:" prose survives.

type ForwardedToolCall = { id: string; type: string; function: { name: string; arguments: string } }
type ForwardedMessage = {
  role: string
  content?: string | null
  tool_calls?: ForwardedToolCall[]
  tool_call_id?: string
}
type ForwardedBody = {
  messages: ForwardedMessage[]
  tools?: Array<{ type: string; function: { name: string } }>
  tool_choice?: string
}

const forwardedChatBodies = (mock: LiteLLMMock): ForwardedBody[] =>
  mock
    .requestBodies()
    .map((raw) => JSON.parse(raw) as ForwardedBody)
    // Only chat-completion bodies carry a messages array (key-management bodies don't).
    .filter((body) => Array.isArray(body.messages))

test.describe('native tool-call context shape (#276)', () => {
  test('decide and synthesize replay tool I/O as native tool_calls / tool messages — no prose', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, snippets.NO_EGRESS)
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await runSnippetViaChat(page, mock)

    // The synthesize call runs last; wait until it has been forwarded so the
    // tool-result turn is present in a later body.
    await expect
      .poll(
        () =>
          forwardedChatBodies(mock).filter((b) => b.messages.some((m) => m.role === 'tool')).length
      )
      .toBeGreaterThan(0)

    const bodies = forwardedChatBodies(mock)

    // Every forwarded chat body that carries replayed tool I/O uses the native
    // shape and never the retired prose notes.
    const bodiesWithToolResult = bodies.filter((b) => b.messages.some((m) => m.role === 'tool'))
    expect(bodiesWithToolResult.length).toBeGreaterThan(0)

    for (const body of bodiesWithToolResult) {
      const serialized = JSON.stringify(body.messages)
      expect(serialized).not.toContain('Research notes')
      expect(serialized).not.toContain('Tool results:')

      // An assistant tool_calls turn issued the run_javascript call...
      const assistantCall = body.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
      )
      expect(assistantCall, 'an assistant tool_calls turn should be present').toBeDefined()
      const toolCall = assistantCall?.tool_calls?.[0]
      expect(toolCall?.function.name).toBe('run_javascript')
      // arguments is a JSON-encoded string per the OpenAI wire format.
      const parsedArgs = JSON.parse(toolCall?.function.arguments ?? 'null') as unknown
      expect(parsedArgs).toMatchObject({ code: expect.any(String) })

      // ...answered by a matching tool result turn keyed by the same id.
      const toolResult = body.messages.find((m) => m.role === 'tool')
      expect(toolResult?.tool_call_id).toBe(toolCall?.id)
      expect(typeof toolResult?.content).toBe('string')
    }

    // The decide call advertised the tool natively (tools array), not in prose.
    const decideBody = bodies.find((b) => Array.isArray(b.tools) && b.tools.length > 0)
    expect(decideBody, 'a decide call should advertise tools').toBeDefined()
    expect(decideBody?.tools?.some((t) => t.function.name === 'run_javascript')).toBe(true)
  })
})

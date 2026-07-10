import { type Page } from '@playwright/test'
import { CANVAS_URL, waitForCanvasReady } from './canvas'
import { dismissFirstLoad } from './first-load'
import { installScriptedToolMock, type LiteLLMMock, type ToolCall } from './mock-litellm'

// Chat-enabled canvas bootstrap. Companion to fixtures/canvas.ts's `openCanvas`,
// which deliberately blocks `**/api/**` (the whiteboard degrades gracefully with
// no chat backend) and is documented as never importing mock-litellm. Proving
// the full loop — model tool_call → agent runtime → tool registry → app-bridge →
// sandboxed Excalidraw iframe → media handling → UI — needs a real chat turn to
// drive the canvas verbs through the model tool-call path, so this fixture
// installs the SCRIPTED LiteLLM mock instead (edge routes piped through the real
// worker, exactly like openCanvas's sibling fixtures for /web/; only the LiteLLM
// upstream is mocked) before navigating to the canvas origin, then waits through
// the same first-load/ready gates openCanvas uses. Scene state is seeded with
// fixtures/canvas.ts's `drawViaVerb` (the real bridge — nothing mocked there
// either), never through the chat turn itself.

export const openCanvasWithChat = async (
  page: Page,
  script: ToolCall[],
  answer?: string
): Promise<LiteLLMMock> => {
  const mock = await installScriptedToolMock(page, script, answer)
  await page.goto(CANVAS_URL)
  await dismissFirstLoad(page)
  await waitForCanvasReady(page)
  return mock
}

// Sends a prompt through the canvas composer. Located by role/accessible name,
// NOT the placeholder text: the canvas composer is the floating chat widget
// (packages/app/app-browser/src/chat-shell/floating-chat-surface.tsx), whose
// placeholder ("Ask something current, compare options, or continue the
// thread.") differs from the /web/ shell's docked composer ("Ask anything…") —
// but both textareas share the accessible name "Message" and both send buttons
// share the accessible name "Send", so this fixture stays robust to either
// composer's placeholder copy changing independently.
export const sendCanvasMessage = async (page: Page, prompt: string): Promise<void> => {
  await page.getByRole('textbox', { name: 'Message' }).fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
}

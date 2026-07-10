import { type Page } from '@playwright/test'
import { CANVAS_URL, waitForCanvasReady } from './canvas'
import { dismissFirstLoad } from './first-load'
import {
  installReplayMock,
  loadCapture,
  loadScenario,
  type CapturedFixture,
  type LiteLLMMock,
  type Scenario
} from './mock-litellm'

// Chat-enabled canvas bootstrap. Companion to fixtures/canvas.ts's `openCanvas`,
// which deliberately blocks `**/api/**` (the whiteboard degrades gracefully with
// no chat backend) and is documented as never importing mock-litellm. Proving
// the full loop — model tool_call → agent runtime → tool registry → app-bridge →
// sandboxed Excalidraw iframe → media handling → UI — needs a real chat turn to
// drive the canvas verbs through the model tool-call path, so this fixture loads
// a CAPTURED fixture (real inference, recorded against a live PR preview — see
// .agent/skills/e2e-testing/SKILL.md) and installs the REPLAY LiteLLM mock
// (edge routes piped through the real worker, exactly like openCanvas's sibling
// fixtures for /web/; only the LiteLLM upstream is mocked) before navigating to
// the canvas origin, then waits through the same first-load/ready gates
// openCanvas uses. The model drives every scene mutation for real, through the
// real bridge — nothing here seeds the scene directly.

export type CanvasChatRun = {
  mock: LiteLLMMock
  fixture: CapturedFixture
  scenario: Scenario
}

// Loads `fixtureName`'s capture + scenario, installs the replay mock, and opens
// the canvas. `fixtureName` is both the capture's filename (captures/<name>.json)
// and its scenario's (captures/scenarios/<name>.json) — the two are always
// written together (see the workflow doc), so one name locates both.
export const openCanvasWithChat = async (
  page: Page,
  fixtureName: string
): Promise<CanvasChatRun> => {
  const fixture = loadCapture(fixtureName)
  const scenario = loadScenario(fixtureName)
  const mock = await installReplayMock(page, fixture)
  await page.goto(CANVAS_URL)
  await dismissFirstLoad(page)
  await waitForCanvasReady(page)
  return { mock, fixture, scenario }
}

// Sends a prompt through the canvas composer. Located by role/accessible name,
// NOT the placeholder text: the canvas composer is the floating chat widget
// (packages/app/app-browser/src/chat-shell/floating-chat-surface.tsx), whose
// placeholder ("Ask something current, compare options, or continue the
// thread.") differs from the /web/ shell's docked composer ("Ask anything…") —
// but both textareas share the accessible name "Message" and both send buttons
// share the accessible name "Send", so this fixture stays robust to either
// composer's placeholder copy changing independently. A prior interaction (e.g.
// a scenario's `clickCanvas` step, which minimizes the floating widget first if
// it overlays the canvas — mirroring capture-llm-stream.mjs's own
// minimizeChatIfOverlaying) may have left the widget minimized, hiding the
// composer entirely; restore it first in that case, exactly as the capture
// tool does before every prompt step.
export const sendCanvasMessage = async (page: Page, prompt: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: 'Message' })
  if (!(await composer.isVisible().catch(() => false))) {
    const restore = page.getByRole('button', { name: 'Restore widget' })
    if (await restore.isVisible().catch(() => false)) {
      await restore.click()
    }
  }
  await composer.fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
}

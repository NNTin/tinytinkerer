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
// which deliberately blocks `**/api/**`. Proving the full loop from model tool call
// through the runtime, controller, Excalidraw API, media handling, and UI needs a real
// chat turn, so this fixture loads
// a CAPTURED fixture (real inference, recorded against a live PR preview — see
// .agent/skills/e2e-testing/SKILL.md) and installs the REPLAY LiteLLM mock
// (edge routes piped through the real worker, exactly like openCanvas's sibling
// fixtures for /web/; only the LiteLLM upstream is mocked) before navigating to
// the shared host origin, then waits through the same first-load/ready gates. The
// model drives every scene mutation through the in-process controller; nothing here
// seeds the scene directly.

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

// Send a prompt through the integrated assistant composer. Accessible roles keep the
// fixture independent from placeholder copy.
export const sendCanvasMessage = async (page: Page, prompt: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill(prompt)
  await page
    .getByRole('region', { name: 'Assistant' })
    .getByRole('button', { name: 'Send', exact: true })
    .click()
}

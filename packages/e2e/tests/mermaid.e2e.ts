import { test, expect, type Page } from '@playwright/test'
import { installChatMock, dismissTelemetryDialog, GATE_SENTINEL } from '../fixtures/mock-litellm'

// Real-browser verification of the Mermaid content renderer (GitHub issue #248).
// The content-mermaid renderer turns a ```mermaid fenced block into an actual SVG
// by loading the mermaid library at runtime, calling mermaid.render, sanitizing the
// SVG, and mounting it in div[aria-label="Mermaid diagram"]. jsdom unit tests MOCK
// mermaid.render, so the real library producing a real <svg> is uncovered — this
// spec closes that gap in a real browser, and proves the streaming-incremental path
// never renders a broken SVG from an incomplete (mid-stream, unclosed-fence) block.
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker, and the
// answer streams as small SSE deltas. mermaid is a content renderer wired into every
// assistant turn (assistant-content.tsx), so no plugin toggle is needed. The agent
// answers directly (no tool), so this uses the no-tool chat mock with a per-test
// answer. See packages/e2e/README.md.

const MERMAID_DIAGRAM = 'div[aria-label="Mermaid diagram"]'

// A valid flowchart. GATE_SENTINEL splits a node label ("Mid|dle"), so the part of
// the stream delivered before the gate releases leaves an UNCLOSED fence whose code
// (`B[Mid`) is unparseable — the renderer must withhold the SVG until the rest
// arrives and closes the block. The sentinel itself is dropped from the rendered
// text (see GATE_SENTINEL), so the completed code reads `B[Middle]`.
const MERMAID_VALID = [
  'Here is the diagram:',
  '',
  '```mermaid',
  'flowchart TD',
  `  A[Start] --> B[Mid${GATE_SENTINEL}dle]`,
  '  B[Middle] --> C[End]',
  '```',
  '',
  'That is the flow.'
].join('\n')

// A complete (closed-fence) but syntactically INVALID mermaid block. The renderer
// must fall back to a plain code block (no SVG) rather than crashing the turn.
const MERMAID_INVALID = [
  'Here is a broken diagram:',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start --> B]   %% mismatched brackets',
  '  )))not valid mermaid(((',
  '```',
  '',
  'End of message.'
].join('\n')

// Clears the first-load dialogs so the composer is usable, without touching any
// Settings toggle (mermaid needs no plugin enabled).
const dismissFirstLoad = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

// Page-side stream re-pacer. `route.fulfill` is atomic (the browser receives the
// whole SSE body at once), so the frontend never lingers in a mid-stream state long
// enough to observe. This wraps window.fetch IN THE PAGE: it takes the real edge SSE
// response and, when it carries the gate marker, replays it as a controllable stream
// — flush part 1 (the unclosed fence), wait for window.__ttGate.release(), then flush
// the rest. It mocks nothing in the app or edge (the bytes come from the real worker);
// it only paces byte delivery, exactly as a slow network would. Other (non-marked)
// SSE responses — e.g. the ReAct decision — are replayed unchanged.
const installStreamGate = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    let releaseGate = (): void => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    ;(window as unknown as { __ttGate: { release: () => void } }).__ttGate = {
      release: () => releaseGate()
    }

    const GATE_MARKER = '\n: tt-gate\n\n'
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(input, init)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        return response
      }

      const text = await response.text()
      const markerIndex = text.indexOf(GATE_MARKER)
      if (markerIndex === -1) {
        // No gate in this stream (e.g. the ReAct decision) — replay it as-is.
        return new Response(text, { status: response.status, headers: response.headers })
      }

      const head = `${text.slice(0, markerIndex)}\n`
      const tail = text.slice(markerIndex + GATE_MARKER.length)
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(head))
          await gate
          controller.enqueue(encoder.encode(tail))
          controller.close()
        }
      })
      return new Response(stream, { status: response.status, headers: response.headers })
    }
  })
}

const releaseStreamGate = (page: Page): Promise<void> =>
  page.evaluate(() => {
    ;(window as unknown as { __ttGate: { release: () => void } }).__ttGate.release()
  })

const sendMessage = async (page: Page, prompt: string): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
}

test.describe('mermaid diagram rendering (#248)', () => {
  test('valid: a streamed mermaid block renders a real SVG, with no broken SVG mid-stream', async ({
    page
  }) => {
    await installChatMock(page, MERMAID_VALID)
    await installStreamGate(page)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Draw a flowchart.')

    // Mid-stream: only part 1 has arrived, so the fence is still open and the code
    // (`B[Mid`) is incomplete. The partial source is on screen (streaming reached the
    // renderer), but NO diagram SVG is mounted — the renderer withholds it until the
    // block is complete, exactly as required. The gate holds the stream here.
    await expect(page.getByText('flowchart TD')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`${MERMAID_DIAGRAM} svg`)).toHaveCount(0)
    // Hold and re-check: the absence is durable, not a transient pre-render gap. The
    // complete block renders its SVG in well under a second (see the post-release
    // assertion below), so a clear window with no SVG proves the incomplete source
    // genuinely produced none — i.e. the assertion is not vacuously true.
    await page.waitForTimeout(1500)
    await expect(page.locator(`${MERMAID_DIAGRAM} svg`)).toHaveCount(0)

    // Release part 2 (the closing fence). The now-complete block parses and renders.
    await releaseStreamGate(page)

    const svg = page.locator(`${MERMAID_DIAGRAM} svg`)
    await expect(svg).toBeVisible({ timeout: 30_000 })
    // Real SVG nodes from the mermaid library actually running — not an empty or
    // placeholder element (this is the coverage jsdom's mocked render cannot give).
    expect(await svg.locator('*').count()).toBeGreaterThan(0)
  })

  test('error fallback: an invalid mermaid block degrades to a code block without crashing', async ({
    page
  }) => {
    await installChatMock(page, MERMAID_INVALID)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Draw a broken diagram.')

    // The trailing prose renders, proving the turn completed and did not crash.
    await expect(page.getByText('End of message.')).toBeVisible({ timeout: 30_000 })
    // The invalid block degrades to a plain code block — no diagram SVG is mounted.
    await expect(page.locator(`${MERMAID_DIAGRAM} svg`)).toHaveCount(0)
    // The mermaid source is still shown (as code), so the block fell back visibly
    // rather than silently vanishing.
    await expect(page.getByText('flowchart TD')).toBeVisible()
  })
})

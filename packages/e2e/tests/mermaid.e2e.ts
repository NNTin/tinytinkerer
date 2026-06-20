import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  dismissTelemetryDialog,
  GATE_SENTINEL,
  installStreamGate,
  releaseStreamGate,
  sendMessage
} from '../fixtures/mock-litellm'

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

// Three diagram TYPES in one answer (flowchart, sequence, class). Each renders into
// its own diagram frame. The flowchart and class nodes carry text labels that
// mermaid renders via `foreignObject` — those must survive DOMPurify sanitization
// (issue #227, mermaid items 2 & 3).
const MERMAID_MULTIPLE = [
  'Three diagrams:',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Flow Start] --> B[Flow Finish]',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  Alice->>Bob: Sequence Hello',
  '  Bob-->>Alice: Sequence Reply',
  '```',
  '',
  '```mermaid',
  'classDiagram',
  '  class ClassLabel {',
  '    +field: number',
  '    +method()',
  '  }',
  '```',
  '',
  'End of diagrams.'
].join('\n')

// A single valid flowchart used for the Preview/Code toggle spec (issue #227, item 4).
const MERMAID_TOGGLE = [
  'A toggleable diagram:',
  '',
  '```mermaid',
  'flowchart LR',
  '  Toggle[Toggle Node] --> Done[Done Node]',
  '```',
  '',
  'End of toggle.'
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

  test('multiple types: flowchart, sequence, and class each render, with node labels preserved', async ({
    page
  }) => {
    await installChatMock(page, MERMAID_MULTIPLE)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Draw three diagrams.')

    await expect(page.getByText('End of diagrams.')).toBeVisible({ timeout: 30_000 })

    // All three diagram types rendered a real SVG (one frame each).
    const diagrams = page.locator(MERMAID_DIAGRAM)
    await expect(diagrams).toHaveCount(3, { timeout: 30_000 })
    for (let i = 0; i < 3; i += 1) {
      await expect(diagrams.nth(i).locator('svg')).toBeVisible({ timeout: 30_000 })
    }

    // Node/label text rendered via foreignObject survives sanitization — DOMPurify
    // must not strip the HTML children of foreignObject (issue #227, item 3).
    // `exact` so a label does not also match a mermaid-generated <style> rule that
    // references the same class name.
    await expect(
      page.locator(MERMAID_DIAGRAM).getByText('Flow Start', { exact: true })
    ).toBeVisible()
    await expect(
      page.locator(MERMAID_DIAGRAM).getByText('Flow Finish', { exact: true })
    ).toBeVisible()
    await expect(
      page.locator(MERMAID_DIAGRAM).getByText('Sequence Hello', { exact: true })
    ).toBeVisible()
    await expect(
      page.locator(MERMAID_DIAGRAM).getByText('ClassLabel', { exact: true })
    ).toBeVisible()
  })

  test('preview/code toggle: switching to Code shows the source, back to Preview shows the diagram', async ({
    page
  }) => {
    await installChatMock(page, MERMAID_TOGGLE)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Draw a toggleable diagram.')

    // The diagram renders first (Preview is the default view).
    const diagram = page.locator(MERMAID_DIAGRAM)
    await expect(diagram.locator('svg')).toBeVisible({ timeout: 30_000 })

    // Switch to Code: the raw mermaid source shows and the diagram SVG is gone.
    await page.getByRole('button', { name: 'Code' }).first().click()
    await expect(page.locator('pre code.language-mermaid')).toContainText('flowchart LR')
    await expect(diagram.locator('svg')).toHaveCount(0)

    // Switch back to Preview: the diagram SVG returns.
    await page.getByRole('button', { name: 'Preview' }).first().click()
    await expect(diagram.locator('svg')).toBeVisible()
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
    // The mermaid source is still shown in the code fallback, not as loose prose,
    // so the invalid block fell back visibly rather than silently vanishing.
    const fallback = page.locator('pre code.language-mermaid')
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('flowchart TD')
  })
})

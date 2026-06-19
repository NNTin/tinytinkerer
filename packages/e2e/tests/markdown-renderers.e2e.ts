import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  dismissTelemetryDialog,
  sendMessage,
  installStreamGate,
  releaseStreamGate,
  GATE_SENTINEL
} from '../fixtures/mock-litellm'

// Real-browser coverage of the markdown rendering capabilities jsdom cannot exercise
// (GitHub issue #249): sticky table headers + CSV download, the image lightbox,
// CodeMirror highlighting, sandboxed wireframe iframes, callouts, and link cards. The
// capabilities are authored exactly as SYSTEM_STYLE_PROMPT describes them.
//
// Every answer is streamed as small SSE deltas (see sseStream), so the frontend's
// INCREMENTAL markdown parsing is exercised — not just the final string: a final
// assertion only passes if streaming never crashed the turn. The table spec also
// gates the stream mid-table to assert graceful partial handling explicitly. mermaid
// has its own spec (#248). These are content renderers wired into every assistant
// turn (assistant-content.tsx), so no plugin toggle is needed; the agent answers
// directly (no tool), so this uses the no-tool chat mock with a per-test answer. Only
// LiteLLM is mocked; the run is anonymous through the real edge worker. See
// packages/e2e/README.md.

// A 1x1 transparent PNG as a base64 data URI — renders with no network access.
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Clears the first-load dialogs so the composer is usable, without touching any
// Settings toggle (these renderers need no plugin enabled).
const dismissFirstLoad = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

test.describe('markdown renderers (#249)', () => {
  test('tables: sticky header, CSV download, and graceful mid-stream partial', async ({ page }) => {
    // GATE_SENTINEL splits the stream after the first body row, so the held part 1
    // delivers only the header + one row — a valid partial table — and part 2 adds
    // the rest. The sentinel itself is dropped from the rendered text.
    const answer = [
      'Here is a table:',
      '',
      '| Name | Role | City |',
      '| --- | --- | --- |',
      '| Ada | Engineer | London |',
      `${GATE_SENTINEL}| Grace | Admiral | New York |`,
      '| Linus | Maintainer | Portland |',
      '',
      'End table.'
    ].join('\n')

    await installChatMock(page, answer)
    await installStreamGate(page)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me a table.')

    // Mid-stream: only the first row has arrived. The partial content is on screen
    // (incremental parse reached the renderer) and the turn has not crashed, but the
    // not-yet-streamed rows are absent — no broken/duplicated output from the partial.
    // (`getByRole('cell')` matches only the desktop table's <td>/<th>, not the mobile
    // card layout that mirrors the same values.)
    await expect(page.getByRole('cell', { name: 'Ada' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('cell', { name: 'Grace' })).toHaveCount(0)

    // Release the rest of the stream; the completed table renders.
    await releaseStreamGate(page)

    const table = page.locator('[data-tt-table]')
    await expect(table).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('cell', { name: 'Grace' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Linus' })).toBeVisible()
    // The header is sticky (a real-browser concern jsdom cannot cover).
    await expect(table.locator('thead')).toHaveClass(/sticky/)
    await expect(table.getByRole('button', { name: 'Copy MD' })).toBeVisible()

    // Clicking CSV triggers a real file download.
    const csvButton = table.getByRole('button', { name: 'Download as CSV' })
    const [download] = await Promise.all([page.waitForEvent('download'), csvButton.click()])
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('images: lazy figure opens a lightbox that Escape closes', async ({ page }) => {
    const answer = [
      'Here is an image:',
      '',
      `![A tiny dot](${PNG_DATA_URI} "Tiny Dot")`,
      '',
      'After the image.'
    ].join('\n')

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me an image.')

    const figure = page.locator('figure[data-tt-image]')
    await expect(figure).toBeVisible({ timeout: 30_000 })
    await expect(figure.locator('img[loading="lazy"]')).toBeVisible()

    // Clicking the figure opens the lightbox.
    await figure.getByRole('button').first().click()
    const lightbox = page.locator('[data-tt-image-lightbox]')
    await expect(lightbox).toBeVisible()

    // Escape closes it.
    await page.keyboard.press('Escape')
    await expect(lightbox).toBeHidden()
  })

  test('code blocks: CodeMirror highlighting and a working Copy control', async ({ page }) => {
    const answer = [
      'Here is some JavaScript:',
      '',
      '```javascript',
      'function greet(name) {',
      '  const message = `Hello, ${name}!`',
      '  console.log(message)',
      '  return message',
      '}',
      '```',
      '',
      'Done.'
    ].join('\n')

    await installChatMock(page, answer)
    await page.context().grantPermissions(['clipboard-write'])
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me some code.')

    const codeBlock = page.locator('[data-tt-code-block]')
    await expect(codeBlock).toBeVisible({ timeout: 30_000 })
    // CodeMirror mounted (lazy-loaded) and the language label routed correctly.
    await expect(codeBlock.locator('.cm-editor')).toBeVisible({ timeout: 30_000 })
    await expect(codeBlock.getByText('javascript')).toBeVisible()
    // Real syntax highlighting: tokens are emitted as styled spans inside the lines
    // (plain, unhighlighted text would have none).
    await expect
      .poll(() => codeBlock.locator('.cm-line span').count(), {
        timeout: 30_000,
        message: 'expected CodeMirror to emit highlighted token spans'
      })
      .toBeGreaterThan(0)

    // The Copy control works (clipboard permission granted above).
    await codeBlock.getByRole('button', { name: 'Copy' }).click()
    await expect(codeBlock.getByText('Copied!')).toBeVisible()
  })

  test('wireframe: renders inside a scriptless sandboxed iframe', async ({ page }) => {
    const answer = [
      'Here is a wireframe:',
      '',
      '```wireframe',
      '<div style="padding:24px;font-family:sans-serif">',
      '  <h1 id="wf-heading">Wireframe Heading</h1>',
      '  <p>Mock body text.</p>',
      '</div>',
      '```',
      '',
      'End of wireframe.'
    ].join('\n')

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me a wireframe.')

    const frame = page.locator('iframe[title="Wireframe preview"]')
    await expect(frame).toBeVisible({ timeout: 30_000 })
    // Empty sandbox: no scripts, no same-origin — the strongest mitigation for
    // LLM-authored HTML (a real-browser guarantee jsdom cannot assert).
    await expect(frame).toHaveAttribute('sandbox', '')
    // The inner HTML/CSS actually renders in the framed document.
    await expect(
      page.frameLocator('iframe[title="Wireframe preview"]').locator('#wf-heading')
    ).toHaveText('Wireframe Heading')
  })

  test('language highlighting: diff / json / yaml / sql / bash / http each get a code block', async ({
    page
  }) => {
    const block = (lang: string, body: string): string => ['```' + lang, body, '```', ''].join('\n')
    const answer = [
      'Several languages:',
      '',
      block('diff', '- old line\n+ new line'),
      block('json', '{ "name": "tinytinkerer", "ok": true }'),
      block('yaml', 'name: tinytinkerer\nok: true'),
      block('sql', 'select id, name from users where id = 1;'),
      block('bash', 'echo "hello" && ls -la'),
      block('http', 'GET /api/health HTTP/1.1\nHost: example.com'),
      'Done.'
    ].join('\n')

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me several languages.')

    // Each fenced language routes to the code-block renderer and mounts a CodeMirror
    // editor with its language label.
    const blocks = page.locator('[data-tt-code-block]')
    await expect(blocks).toHaveCount(6, { timeout: 30_000 })
    for (const lang of ['diff', 'json', 'yaml', 'sql', 'bash', 'http']) {
      const codeBlock = page.locator('[data-tt-code-block]', { hasText: lang })
      await expect(codeBlock.locator('.cm-editor')).toBeVisible({ timeout: 30_000 })
    }
    // Spot-check real highlighting on the JSON block (tokens as styled spans).
    const jsonBlock = page.locator('[data-tt-code-block]', { hasText: 'json' })
    await expect
      .poll(() => jsonBlock.locator('.cm-line span').count(), {
        timeout: 30_000,
        message: 'expected highlighted token spans in the JSON block'
      })
      .toBeGreaterThan(0)
  })

  test('callouts: each blockquote kind renders a styled aside', async ({ page }) => {
    const callout = (kind: string, text: string): string =>
      [`> [!${kind.toUpperCase()}]`, `> ${text}`, ''].join('\n')
    const answer = [
      'Callouts:',
      '',
      callout('note', 'A note callout.'),
      callout('tip', 'A tip callout.'),
      callout('warning', 'A warning callout.'),
      callout('important', 'An important callout.'),
      callout('caution', 'A caution callout.'),
      'Done.'
    ].join('\n')

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me callouts.')

    for (const kind of ['note', 'tip', 'warning', 'important', 'caution']) {
      await expect(
        page.locator(`aside[data-tt-callout][data-tt-callout-kind="${kind}"]`)
      ).toBeVisible({ timeout: 30_000 })
    }
  })

  test('link cards: a URL-only paragraph renders a link card', async ({ page }) => {
    const answer = ['Here is a reference:', '', 'https://example.com/article', '', 'Done.'].join(
      '\n'
    )

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me a link card.')

    const card = page.locator('a[data-tt-link-card]')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('href', 'https://example.com/article')
  })
})

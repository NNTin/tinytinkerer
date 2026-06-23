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

// The raw PNG bytes behind PNG_DATA_URI, used to fulfil the https/http <img> route
// stubs with a real image so naturalWidth > 0 without touching the network.
const PNG_BYTES = Buffer.from(PNG_DATA_URI.split(',')[1] ?? '', 'base64')

// A 20x20 SVG square in each of the three SVG data-URI forms. Each carries explicit
// dimensions so the <img> rows report a non-zero naturalWidth once loaded.
const SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'
const SVG_BASE64_URI = `data:image/svg+xml;base64,${Buffer.from(SVG_MARKUP).toString('base64')}`
const SVG_PERCENT_URI = `data:image/svg+xml,${encodeURIComponent(SVG_MARKUP)}`
// Issue #289 regression: model-generated SVGs often encode markup-significant
// characters (`<>#`) but leave attribute-separating spaces literal. CommonMark
// treats those spaces as the end of an unwrapped image destination, so this must be
// rescued before parsing and rendered through the sanitized inline-SVG path.
const SVG_PARTIAL_PERCENT_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='80' viewBox='0 0 160 80'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1'%3E%3Cstop stop-color='%23ff7a59'/%3E%3Cstop offset='1' stop-color='%2300a6fb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='160' height='80' rx='16' fill='url(%23g)'/%3E%3Ccircle cx='40' cy='40' r='18' fill='white' fill-opacity='.85'/%3E%3C/svg%3E"
// The RAW form embeds an onload handler and a <script>; both must be stripped by the
// shared DOMPurify pass before the inline SVG reaches the DOM.
const SVG_RAW_URI =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" onload="window.__ttXss = 1"><script>window.__ttXss = 2</script><rect width="20" height="20" fill="green"/></svg>'

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

  test('images: src-format support matrix renders / drops each row per the docs', async ({
    page
  }) => {
    // Each row of the documented support matrix as a standalone markdown image, with
    // a unique alt so it can be located independently.
    const answer = [
      'Image formats:',
      '',
      `![https image](https://images.example.test/a.png)`,
      '',
      `![http image](http://images.example.test/b.png)`,
      '',
      `![png base64](${PNG_DATA_URI})`,
      '',
      `![svg base64](${SVG_BASE64_URI})`,
      '',
      `![svg percent](${SVG_PERCENT_URI})`,
      '',
      `![partial percent svg](${SVG_PARTIAL_PERCENT_URI})`,
      '',
      `![raw svg](${SVG_RAW_URI})`,
      '',
      `![relative image](/local/c.png)`,
      '',
      `![protocol relative](//images.example.test/d.png)`,
      '',
      `![other scheme](ftp://images.example.test/e.png)`,
      '',
      'End of formats.'
    ].join('\n')

    await installChatMock(page, answer)
    // Offline stub for the absolute-URL rows: fulfil any http/https image request to
    // the test host with real PNG bytes, so the <img> actually loads (naturalWidth > 0)
    // without any real network access.
    await page.route('**/images.example.test/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: PNG_BYTES })
    )
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Show me image formats.')

    await expect(page.getByText('End of formats.')).toBeVisible({ timeout: 30_000 })

    // ✅ rows that ride in an <img>: present AND actually loaded (naturalWidth > 0).
    for (const alt of ['https image', 'http image', 'png base64', 'svg base64', 'svg percent']) {
      const img = page.locator(`img[alt="${alt}"]`)
      await expect(img).toBeVisible()
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
          timeout: 15_000,
          message: `expected the "${alt}" image to load (naturalWidth > 0)`
        })
        .toBeGreaterThan(0)
    }

    // ✅ raw SVG row: rendered as sanitized INLINE <svg> (not an <img>), with the
    // script/onload payload stripped.
    const rawFigure = page.locator('figure[data-tt-image]', { hasText: 'raw svg' })
    await expect(rawFigure).toBeVisible()
    const inlineSvg = rawFigure.locator('[data-tt-inline-svg] svg')
    await expect(inlineSvg).toBeVisible()
    await expect(inlineSvg.locator('rect')).toHaveCount(1)
    await expect(inlineSvg.locator('script')).toHaveCount(0)
    expect(await inlineSvg.getAttribute('onload')).toBeNull()

    // ✅ partially percent-encoded SVG row: rendered as sanitized INLINE <svg>, not
    // loose fallback text. This catches issue #289's literal-space destination bug.
    const partialFigure = page.locator('figure[data-tt-image]', { hasText: 'partial percent svg' })
    await expect(partialFigure).toBeVisible()
    await expect(partialFigure.locator('img')).toHaveCount(0)
    const partialSvg = partialFigure.locator('[data-tt-inline-svg] svg')
    await expect(partialSvg).toBeVisible()
    await expect(partialSvg.locator('linearGradient#g')).toHaveCount(1)
    await expect(partialSvg.locator('rect[fill="url(#g)"]')).toHaveCount(1)
    await expect(partialSvg.locator('circle')).toHaveCount(1)
    await expect(page.getByText(/%3Csvg xmlns=/)).toHaveCount(0)

    // The strongest oracle: neither the onload handler nor the inline <script> ran.
    expect(await page.evaluate(() => (window as unknown as { __ttXss?: number }).__ttXss)).toBe(
      undefined
    )

    // ❌ rows: relative, protocol-relative, and other schemes drop to an empty src
    // (React omits the attribute entirely for an empty string), so nothing loads.
    for (const alt of ['relative image', 'protocol relative', 'other scheme']) {
      const img = page.locator(`img[alt="${alt}"]`)
      await expect(img).toBeVisible()
      expect((await img.getAttribute('src')) ?? '').toBe('')
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(0)
    }
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
      await expect
        .poll(() => codeBlock.locator('.cm-line span').count(), {
          timeout: 30_000,
          message: `expected highlighted token spans in the ${lang} block`
        })
        .toBeGreaterThan(0)
    }
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

  test('link cards: a bare "Then:" paragraph stays plain text (no false card)', async ({
    page
  }) => {
    // Regression for the reported repro: `new URL('Then:')` parses as a custom-scheme
    // URL (protocol `then:`, empty host), so a standalone "Then:" between two inline
    // code lines was wrongly rendered as a link card. It must render as plain text.
    const answer = [
      '`56412 * 45644 = 2574869328`',
      '',
      'Then:',
      '',
      '`2574869328 * 123131 = 317046235225968`'
    ].join('\n')

    await installChatMock(page, answer)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    await sendMessage(page, 'Multiply these.')

    // The final code line confirms the whole turn rendered.
    await expect(page.getByText('2574869328 * 123131 = 317046235225968')).toBeVisible({
      timeout: 30_000
    })
    // "Then:" is plain text, not a clickable card.
    await expect(page.getByText('Then:', { exact: true })).toBeVisible()
    await expect(page.locator('a[data-tt-link-card]')).toHaveCount(0)
    await expect(page.locator('a[href="Then:"]')).toHaveCount(0)
  })
})

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { HumanPromptHost } from '../src/human-prompt-host.js'
import { requestHumanInput, resetAllHumanPrompts } from '../src/human-prompt-bridge.js'

const forwardPluginReport = vi.hoisted(() => vi.fn())
vi.mock('../src/telemetry/plugin-report', () => ({ forwardPluginReport }))

// The modal resolves presentation from the settings store (per-plugin). With no stored
// config every view defaults to `modal`, so these views (no `source`) render here.
vi.mock('../src/app.js', () => ({
  useSettingsStore: (
    selector: (state: { pluginConfig: Record<string, Record<string, string | boolean>> }) => unknown
  ) => selector({ pluginConfig: {} })
}))

afterEach(() => {
  resetAllHumanPrompts()
  cleanup()
  forwardPluginReport.mockClear()
})

// The Choice-prompt poll: a `dialog` with options as actions, optional free text, and
// a Skip dismiss affordance.
const dialogView = (overrides: Partial<HumanPromptView> = {}): HumanPromptView => ({
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'The assistant has a question',
  description: 'Pick a colour',
  actions: [
    { id: 'Red', label: 'Red' },
    { id: 'Blue', label: 'Blue' }
  ],
  allowCustom: true,
  dismissLabel: 'Dismiss question',
  dismissAction: { label: 'Skip' },
  ...overrides
})

// The Permissions prompt: an `alertdialog` with Allow/Deny actions and the gated
// tool's input handed over via `inputContext` for host-side body enrichment.
const alertView = (overrides: Partial<HumanPromptView> = {}): HumanPromptView => ({
  role: 'alertdialog',
  ariaLabel: 'Tool permission request',
  title: 'Allow this tool to run?',
  inputContext: { toolId: 'web-search', input: { query: 'cats' } },
  actions: [
    { id: 'deny', label: 'Deny' },
    { id: 'allow', label: 'Allow', tone: 'primary' }
  ],
  dismissLabel: 'Deny tool',
  ...overrides
})

describe('HumanPromptHost', () => {
  it('renders nothing while no prompt is pending', () => {
    render(<HumanPromptHost />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders a dialog poll and resolves the picked option as an action', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(dialogView())

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Pick a colour')

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await expect(answer).resolves.toEqual({ kind: 'action', id: 'Blue' })
  })

  it('resolves a typed custom answer when allowCustom is set', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(dialogView())

    await screen.findByRole('dialog')
    fireEvent.change(screen.getByPlaceholderText('Type an answer…'), { target: { value: 'teal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await expect(answer).resolves.toEqual({ kind: 'custom', text: 'teal' })
  })

  it('hides the custom-answer field when allowCustom is false', async () => {
    render(<HumanPromptHost />)
    void requestHumanInput(dialogView({ allowCustom: false }))

    await screen.findByRole('dialog')
    expect(screen.queryByPlaceholderText('Type an answer…')).not.toBeInTheDocument()
  })

  it('resolves dismissed via the explicit Skip button', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(dialogView())

    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('resolves dismissed when Escape is pressed', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(dialogView())

    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })

    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('renders an alertdialog with the tool input and resolves the picked action', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(alertView())

    const dialog = await screen.findByRole('alertdialog')
    // web-search ships no summarizePermission, so the input falls back to a JSON dump.
    expect(dialog).toHaveTextContent('web-search')
    expect(dialog).toHaveTextContent('cats')

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await expect(answer).resolves.toEqual({ kind: 'action', id: 'allow' })
  })

  it('dismisses an alertdialog via the overlay (named by dismissLabel)', async () => {
    render(<HumanPromptHost />)
    const answer = requestHumanInput(alertView())

    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Deny tool' }))

    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('enriches an inputContext via the gated tool owner summarizer and forwards its report once', async () => {
    const { rerender } = render(<HumanPromptHost />)
    // run_javascript's owner (plugin-code-exec) contributes summarizePermission, which
    // pretty-prints the code in a CodeMirror view and forwards a report. It is
    // discovered dynamically (loadPluginModules), proving the modal needs no static
    // dependency on any concrete plugin.
    const answer = requestHumanInput(
      alertView({
        inputContext: {
          toolId: 'run_javascript',
          input: { code: 'const a=1;const b=2;return {a,b};' }
        }
      })
    )

    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(dialog).toHaveTextContent('const a = 1'))
    expect(dialog.querySelector('.cm-editor')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Code')
    expect(dialog).not.toHaveTextContent('"code"')

    rerender(<HumanPromptHost />)
    // A report is forwarded at most once per pending prompt id/kind.
    expect(forwardPluginReport.mock.calls.length).toBeLessThanOrEqual(1)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await expect(answer).resolves.toEqual({ kind: 'action', id: 'allow' })
  })

  it('resetAllHumanPrompts settles every pending prompt as dismissed', async () => {
    const answer = requestHumanInput(dialogView())
    resetAllHumanPrompts()
    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('advances to the next pending prompt after the first is answered', async () => {
    render(<HumanPromptHost />)
    const first = requestHumanInput(dialogView())
    const second = requestHumanInput(dialogView({ description: 'Second question' }))

    await screen.findByText('Pick a colour')
    fireEvent.click(screen.getByRole('button', { name: 'Red' }))
    await expect(first).resolves.toEqual({ kind: 'action', id: 'Red' })

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Second question'))
    void second
  })
})

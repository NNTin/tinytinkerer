// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { HumanPromptComposerDock } from '../src/human-prompt-composer-dock.js'
import { requestHumanInput, resetAllHumanPrompts } from '../src/human-prompt-bridge.js'

// The dock resolves presentation from the settings store. Map the choice-prompt source
// to the `composer` presentation so a poll stamped with that source docks here.
vi.mock('../src/app.js', () => ({
  useSettingsStore: (
    selector: (state: { pluginConfig: Record<string, Record<string, string | boolean>> }) => unknown
  ) => selector({ pluginConfig: { 'choice-prompt': { presentation: 'composer' } } })
}))

afterEach(() => {
  resetAllHumanPrompts()
  cleanup()
})

const composerView = (overrides: Partial<HumanPromptView> = {}): HumanPromptView => ({
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
  source: 'choice-prompt',
  ...overrides
})

describe('HumanPromptComposerDock', () => {
  it('renders nothing when no prompt is pending', () => {
    render(<HumanPromptComposerDock />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('docks a composer-presentation poll and resolves the picked option', async () => {
    render(<HumanPromptComposerDock />)
    const answer = requestHumanInput(composerView())

    const panel = await screen.findByRole('dialog', { name: 'Assistant question' })
    expect(panel).toHaveTextContent('Pick a colour')
    // Docked, not modal: there is no overlay dismiss affordance.
    expect(screen.queryByRole('button', { name: 'Dismiss question' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await expect(answer).resolves.toEqual({ kind: 'action', id: 'Blue' })
  })

  it('resolves a typed custom answer and a Skip dismissal', async () => {
    render(<HumanPromptComposerDock />)

    const custom = requestHumanInput(composerView())
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByPlaceholderText('Type an answer…'), { target: { value: 'teal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await expect(custom).resolves.toEqual({ kind: 'custom', text: 'teal' })

    const skipped = requestHumanInput(composerView())
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await expect(skipped).resolves.toEqual({ kind: 'dismissed' })
  })

  it('draws nothing for a prompt whose presentation resolves to modal', async () => {
    render(<HumanPromptComposerDock />)
    // A view with no `source` → presentation defaults to `modal` → the modal draws it,
    // not the dock.
    const modalView: HumanPromptView = {
      role: 'dialog',
      ariaLabel: 'Assistant question',
      title: 'Q',
      actions: [{ id: 'a', label: 'a' }],
      dismissLabel: 'Dismiss question'
    }
    void requestHumanInput(modalView)
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

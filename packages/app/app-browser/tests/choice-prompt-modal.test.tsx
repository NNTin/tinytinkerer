// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChoicePromptModal } from '../src/choice-prompt-modal.js'
import { requestUserChoice, resetChoiceStore } from '../src/choice-service.js'

afterEach(() => {
  resetChoiceStore()
  cleanup()
})

const baseRequest = {
  question: 'Pick a colour',
  options: ['Red', 'Blue'],
  allowCustom: true
}

describe('ChoicePromptModal', () => {
  it('renders nothing while no choice is pending', () => {
    render(<ChoicePromptModal />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the question and options, and resolves the picked option', async () => {
    render(<ChoicePromptModal />)
    const answer = requestUserChoice(baseRequest)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Pick a colour')

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))

    await expect(answer).resolves.toEqual({ kind: 'option', value: 'Blue' })
  })

  it('resolves a typed custom answer when allowCustom is set', async () => {
    render(<ChoicePromptModal />)
    const answer = requestUserChoice(baseRequest)

    await screen.findByRole('dialog')
    fireEvent.change(screen.getByPlaceholderText('Type an answer…'), {
      target: { value: 'teal' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await expect(answer).resolves.toEqual({ kind: 'custom', text: 'teal' })
  })

  it('hides the custom-answer field when allowCustom is false', async () => {
    render(<ChoicePromptModal />)
    void requestUserChoice({ ...baseRequest, allowCustom: false })

    await screen.findByRole('dialog')
    expect(screen.queryByPlaceholderText('Type an answer…')).not.toBeInTheDocument()
  })

  it('resolves dismissed when the overlay is clicked', async () => {
    render(<ChoicePromptModal />)
    const answer = requestUserChoice(baseRequest)

    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss question' }))

    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('resetChoiceStore settles every pending choice as dismissed', async () => {
    const answer = requestUserChoice(baseRequest)
    resetChoiceStore()
    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('advances to the next pending choice after the first is answered', async () => {
    render(<ChoicePromptModal />)
    const first = requestUserChoice(baseRequest)
    const second = requestUserChoice({ ...baseRequest, question: 'Second question' })

    await screen.findByText('Pick a colour')
    fireEvent.click(screen.getByRole('button', { name: 'Red' }))
    await expect(first).resolves.toEqual({ kind: 'option', value: 'Red' })

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Second question'))
    void second
  })
})

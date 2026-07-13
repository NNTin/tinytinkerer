// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockablePanelLayout } from '../src/dockable-panel-layout'

const panels = [
  { id: 'editor', title: 'Editor', content: <div>editor body</div> },
  { id: 'preview', title: 'Preview', content: <div>preview body</div> },
  { id: 'assistant', title: 'Assistant', content: <div>assistant body</div> }
] as const

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('DockablePanelLayout', () => {
  it('renders the supplied workspace title and defaults when omitted', () => {
    const { rerender } = render(
      <DockablePanelLayout panels={[...panels]} storageKey="dock-test" title="Mermaid workspace" />
    )
    expect(screen.getByText('Mermaid workspace')).toBeInTheDocument()
    rerender(<DockablePanelLayout panels={[...panels]} storageKey="dock-test" />)
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('switches presets and resizes splitters from the keyboard', () => {
    const { container } = render(
      <DockablePanelLayout panels={[...panels]} storageKey="dock-test" />
    )
    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'c' } })
    expect(container.querySelector('.app-dock-canvas')).toHaveAttribute('data-layout', 'c')
    const separator = screen.getByRole('separator', { name: 'Resize workspace 1' })
    expect(separator).toHaveAttribute('aria-valuenow', '32')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '34')
    expect(screen.getByLabelText('Layout')).toHaveValue('custom')
  })

  it('moves a panel with the accessible position selector', () => {
    render(<DockablePanelLayout panels={[...panels]} storageKey="dock-test" />)
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Preview',
      'Editor',
      'Assistant'
    ])
    const movePreview = screen.getByLabelText('Move Preview')
    fireEvent.change(movePreview, { target: { value: 'editor' } })
    expect(screen.getByLabelText('Layout')).toHaveValue('custom')
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Editor',
      'Preview',
      'Assistant'
    ])
  })

  it('swaps panels when a header is dropped anywhere on another panel', () => {
    render(<DockablePanelLayout panels={[...panels]} storageKey="dock-test" />)
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    }
    fireEvent.dragStart(document.querySelector('[data-panel-drag-handle="preview"]')!, {
      dataTransfer
    })
    fireEvent.dragOver(screen.getByRole('region', { name: 'Assistant' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: 'Assistant' }), { dataTransfer })

    expect(screen.getByLabelText('Layout')).toHaveValue('custom')
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Assistant',
      'Editor',
      'Preview'
    ])
  })

  it('does not pass an internal panel drop to the target panel content', () => {
    const contentDrop = vi.fn()
    render(
      <DockablePanelLayout
        panels={[
          { id: 'editor', title: 'Editor', content: <div onDrop={contentDrop}>editor body</div> },
          panels[1],
          panels[2]
        ]}
        storageKey="dock-test"
      />
    )
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    }
    fireEvent.dragStart(document.querySelector('[data-panel-drag-handle="preview"]')!, {
      dataTransfer
    })
    fireEvent.drop(screen.getByText('editor body'), { dataTransfer })

    expect(contentDrop).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Layout')).toHaveValue('custom')
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Editor',
      'Preview',
      'Assistant'
    ])
  })

  it('supports a resizable two-panel workspace with app-specific preset labels', () => {
    const twoPanels = [
      { id: 'canvas', title: 'Canvas', content: <div>canvas body</div> },
      { id: 'assistant', title: 'Assistant', content: <div>assistant body</div> }
    ] as const
    const { container } = render(
      <DockablePanelLayout panels={[...twoPanels]} storageKey="dock-test" />
    )

    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Canvas',
      'Assistant'
    ])
    expect(screen.getByRole('separator', { name: 'Resize workspace 1' })).toHaveAttribute(
      'aria-valuenow',
      '70'
    )
    expect(screen.queryByRole('separator', { name: 'Resize workspace 2' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'A · Canvas left' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'D · Assistant top' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'c' } })
    expect(container.querySelector('.app-dock-canvas')).toHaveAttribute('data-layout', 'c')
    expect(screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))).toEqual([
      'Assistant',
      'Canvas'
    ])
    expect(screen.getByRole('separator', { name: 'Resize workspace 1' })).toHaveAttribute(
      'aria-valuenow',
      '30'
    )
  })
})

/**
 * Surface placement (issue #479 review, finding 2), asserted against real
 * renders — the registry's snapshot shape is not the thing that can go wrong.
 *
 * What can go wrong, and did: with `target: null` meaning both "inline surface"
 * and "portal target absent", #472's Office would have REMOUNTED INLINE at the
 * document root every time its sidebar target unmounted, rather than simply
 * waiting for a target.
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

const load = async () => ({
  ...(await import('../assistant-surface')),
  ...(await import('../assistant-surfaces'))
})

const Office = () => <p data-testid="office">office</p>
const Widget = () => <p data-testid="widget">widget</p>
const WidgetV2 = () => <p data-testid="widget">widget v2</p>

describe('surface placement', () => {
  it('renders an inline surface in the host, with no target involved', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface } = await load()
    registerDocsAssistantSurface('widget', Widget, { placement: 'inline' })

    render(<AssistantSurfaces />)

    expect(screen.getByTestId('widget')).toBeInTheDocument()
  })

  it('renders a portal surface nowhere until its target arrives', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } =
      await load()
    const sidebar = document.createElement('div')
    document.body.append(sidebar)

    registerDocsAssistantSurface('office', Office, { placement: 'portal' })
    const { container } = render(<AssistantSurfaces />)

    // No target yet: nothing anywhere. In particular NOT in the host's own
    // subtree, which is where the defect put it.
    expect(screen.queryByTestId('office')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()

    act(() => {
      setDocsAssistantSurfaceTarget('office', sidebar)
    })
    expect(sidebar).toContainElement(screen.getByTestId('office'))
    expect(container).toBeEmptyDOMElement()
  })

  it('withdraws a portal surface when its target unmounts, and never falls back to inline', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } =
      await load()
    const sidebar = document.createElement('div')
    document.body.append(sidebar)

    registerDocsAssistantSurface('office', Office, { placement: 'portal' })
    const { container } = render(<AssistantSurfaces />)
    act(() => {
      setDocsAssistantSurfaceTarget('office', sidebar)
    })
    expect(screen.getByTestId('office')).toBeInTheDocument()

    // #472's sidebar page unmounts — a search route, a 404, any navigation away.
    act(() => {
      setDocsAssistantSurfaceTarget('office', null)
    })
    expect(screen.queryByTestId('office')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()

    // …and comes back on the next route that renders it.
    const restored = document.createElement('div')
    document.body.append(restored)
    act(() => {
      setDocsAssistantSurfaceTarget('office', restored)
    })
    expect(restored).toContainElement(screen.getByTestId('office'))
  })

  it('accepts a target registered before its component, and after', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } =
      await load()
    const early = document.createElement('div')
    document.body.append(early)

    // #472 may mount its sidebar target before the assistant runtime has loaded
    // #480's registration code, or the other way round; neither order may lose.
    render(<AssistantSurfaces />)
    act(() => {
      setDocsAssistantSurfaceTarget('office', early)
    })
    expect(screen.queryByTestId('office')).not.toBeInTheDocument()

    act(() => {
      registerDocsAssistantSurface('office', Office, { placement: 'portal' })
    })
    expect(early).toContainElement(screen.getByTestId('office'))
  })

  it('ignores a target set on an inline surface', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } =
      await load()
    const stray = document.createElement('div')
    document.body.append(stray)

    registerDocsAssistantSurface('widget', Widget, { placement: 'inline' })
    const { container } = render(<AssistantSurfaces />)
    act(() => {
      setDocsAssistantSurfaceTarget('widget', stray)
    })

    expect(container).toContainElement(screen.getByTestId('widget'))
    expect(stray).toBeEmptyDOMElement()
  })

  it('registers, replaces, and withdraws a surface', async () => {
    const { AssistantSurfaces, registerDocsAssistantSurface } = await load()
    let unregister = () => {}
    render(<AssistantSurfaces />)

    act(() => {
      unregister = registerDocsAssistantSurface('widget', Widget, { placement: 'inline' })
    })
    expect(screen.getByTestId('widget')).toBeInTheDocument()

    // A re-registration under the same id replaces rather than duplicates, and
    // the previous owner's cleanup must not tear the new one down.
    let replaced = () => {}
    act(() => {
      replaced = registerDocsAssistantSurface('widget', WidgetV2, { placement: 'inline' })
      unregister()
    })
    expect(screen.getAllByTestId('widget')).toHaveLength(1)
    expect(screen.getByTestId('widget')).toHaveTextContent('widget v2')

    act(() => {
      replaced()
    })
    expect(screen.queryByTestId('widget')).not.toBeInTheDocument()
  })

  it('keeps snapshot identity stable so a subscriber never loops', async () => {
    const {
      readDocsAssistantSurfaces,
      registerDocsAssistantSurface,
      setDocsAssistantSurfaceTarget
    } = await load()
    const target = document.createElement('div')
    registerDocsAssistantSurface('office', Office, { placement: 'portal' })
    setDocsAssistantSurfaceTarget('office', target)

    const snapshot = readDocsAssistantSurfaces()
    expect(readDocsAssistantSurfaces()).toBe(snapshot)

    // A no-op write is not a change, so it must not invalidate the snapshot —
    // useSyncExternalStore compares by identity and would re-render forever.
    setDocsAssistantSurfaceTarget('office', target)
    expect(readDocsAssistantSurfaces()).toBe(snapshot)
  })
})

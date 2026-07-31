/**
 * Activation and the surface registry (issue #479) — the two light modules a
 * launcher (#480) or a sidebar page (#472) may import without pulling the
 * product runtime into its own chunk.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'

beforeEach(() => {
  vi.resetModules()
})

describe('assistant runtime activation', () => {
  it('starts idle, so opening a documentation page fetches no runtime', async () => {
    const { readDocsAssistantRuntimeStatus } = await import('../assistant-activation')
    expect(readDocsAssistantRuntimeStatus()).toBe('idle')
  })

  it('moves to starting on request and notifies subscribers', async () => {
    const { requestDocsAssistantRuntime, useDocsAssistantRuntime } =
      await import('../assistant-activation')
    const { result } = renderHook(() => useDocsAssistantRuntime())

    expect(result.current.status).toBe('idle')
    act(() => {
      result.current.activate()
    })
    expect(result.current.status).toBe('starting')

    // Idempotent: a second click while it boots must not restart anything.
    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(result.current.status).toBe('starting')
  })

  it('does not fall back to starting once the session is ready', async () => {
    const {
      publishDocsAssistantRuntimeStatus,
      requestDocsAssistantRuntime,
      readDocsAssistantRuntimeStatus
    } = await import('../assistant-activation')

    requestDocsAssistantRuntime()
    publishDocsAssistantRuntimeStatus('ready')
    requestDocsAssistantRuntime()

    expect(readDocsAssistantRuntimeStatus()).toBe('ready')
  })

  it('can be retried after a failure', async () => {
    const {
      publishDocsAssistantRuntimeStatus,
      requestDocsAssistantRuntime,
      readDocsAssistantRuntimeStatus
    } = await import('../assistant-activation')

    requestDocsAssistantRuntime()
    publishDocsAssistantRuntimeStatus('error')
    expect(readDocsAssistantRuntimeStatus()).toBe('error')

    // A status that advertises a retry must have one — the #476 lesson.
    requestDocsAssistantRuntime()
    expect(readDocsAssistantRuntimeStatus()).toBe('starting')
  })
})

describe('assistant surface registry', () => {
  const Surfaces = ({
    subscribe,
    read
  }: {
    subscribe: (listener: () => void) => () => void
    read: () => readonly { id: string }[]
  }) => {
    const surfaces = useSyncExternalStore(subscribe, read, read)
    return <span data-testid="ids">{surfaces.map((surface) => surface.id).join(',')}</span>
  }

  it('is empty until something registers, which is all #479 ships', async () => {
    const { readDocsAssistantSurfaces } = await import('../assistant-surface')
    expect(readDocsAssistantSurfaces()).toEqual([])
  })

  it('registers, replaces, and withdraws a surface', async () => {
    const {
      readDocsAssistantSurfaces,
      registerDocsAssistantSurface,
      subscribeDocsAssistantSurfaces
    } = await import('../assistant-surface')

    render(<Surfaces subscribe={subscribeDocsAssistantSurfaces} read={readDocsAssistantSurfaces} />)
    expect(screen.getByTestId('ids')).toHaveTextContent('')

    let unregister = () => {}
    act(() => {
      unregister = registerDocsAssistantSurface('widget', () => <p>widget</p>)
    })
    expect(screen.getByTestId('ids')).toHaveTextContent('widget')

    // A re-registration under the same id replaces rather than duplicates, and
    // the previous owner's cleanup must not tear the new one down.
    let replaced = () => {}
    act(() => {
      replaced = registerDocsAssistantSurface('widget', () => <p>widget v2</p>)
    })
    act(() => {
      unregister()
    })
    expect(screen.getByTestId('ids')).toHaveTextContent('widget')

    act(() => {
      replaced()
    })
    expect(screen.getByTestId('ids')).toHaveTextContent('')
  })

  it('remembers the DOM target a surface should be portaled into', async () => {
    const {
      readDocsAssistantSurfaces,
      registerDocsAssistantSurface,
      setDocsAssistantSurfaceTarget
    } = await import('../assistant-surface')
    const target = document.createElement('div')

    registerDocsAssistantSurface('office', () => null)
    setDocsAssistantSurfaceTarget('office', target)
    expect(readDocsAssistantSurfaces()[0]?.target).toBe(target)

    // #472's sidebar page unmounts on navigation; the surface stays registered
    // and simply stops being portaled.
    setDocsAssistantSurfaceTarget('office', null)
    expect(readDocsAssistantSurfaces()[0]?.target).toBeNull()
  })

  it('keeps snapshot identity stable so a subscriber never loops', async () => {
    const {
      readDocsAssistantSurfaces,
      registerDocsAssistantSurface,
      setDocsAssistantSurfaceTarget
    } = await import('../assistant-surface')
    const target = document.createElement('div')
    registerDocsAssistantSurface('widget', () => null)
    setDocsAssistantSurfaceTarget('widget', target)

    const snapshot = readDocsAssistantSurfaces()
    expect(readDocsAssistantSurfaces()).toBe(snapshot)

    // A no-op write is not a change, so it must not invalidate the snapshot —
    // useSyncExternalStore compares by identity and would re-render forever.
    setDocsAssistantSurfaceTarget('widget', target)
    expect(readDocsAssistantSurfaces()).toBe(snapshot)
  })
})

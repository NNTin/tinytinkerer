import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

// Shared pointer-drag lifecycle for the chat shell's draggable chrome (the floating
// window's move grip and resize handle, the docked sidebar's divider). It owns the
// begin-capture step and the window-level move/up/cancel listeners, and carries the
// #336 abort policy in one place: pointerup completes the gesture (onEnd commits),
// pointercancel — a browser-aborted gesture (touch takeover, pointer reclaim) —
// hands the start state to onCancel so the caller reverts to it. onCancel is
// required: every new draggable must state its revert.

export type PointerDragHandlers<T> = {
  // Every pointermove while the gesture is active.
  onMove: (start: T, event: PointerEvent) => void
  // pointerup: the gesture completed normally; commit side effects here.
  onEnd?: (start: T, event: PointerEvent) => void
  // pointercancel: revert to the pre-gesture state — never commit (#336).
  onCancel: (start: T) => void
}

export const usePointerDrag = <T>(
  enabled: boolean,
  handlers: PointerDragHandlers<T>
): { begin: (event: ReactPointerEvent<Element>, start: T) => void } => {
  const stateRef = useRef<T | null>(null)
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!enabled) return

    const handlePointerMove = (event: PointerEvent) => {
      const start = stateRef.current
      if (start === null) return
      handlersRef.current.onMove(start, event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const start = stateRef.current
      stateRef.current = null
      if (start === null) return
      handlersRef.current.onEnd?.(start, event)
    }

    const handlePointerCancel = () => {
      const start = stateRef.current
      stateRef.current = null
      if (start === null) return
      handlersRef.current.onCancel(start)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      stateRef.current = null
    }
  }, [enabled])

  const begin = useCallback((event: ReactPointerEvent<Element>, start: T) => {
    stateRef.current = start
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // jsdom / unsupported: the window listeners still receive the events.
    }
  }, [])

  return { begin }
}

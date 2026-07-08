import { useEffect, useRef, type RefObject } from 'react'

// Shared keyboard/focus managers for the shell's aria-modal dialogs (the settings
// modal and the human-prompt modal). aria-modal only tells assistive tech the rest
// of the page is inert — it does not move focus or handle keys. useDialogFocus
// covers the WCAG 2.4.3/2.1.2 obligations: initial focus into the dialog when it
// opens, a Tab/Shift+Tab trap at the dialog boundaries, and restoration of focus
// to the previously focused element on close. useDialogEscape is its sibling for
// the dialog-dismiss key, so both dialogs encode the Escape decision once (#374).

const getFocusable = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)

// Prefer an explicit [data-autofocus] target, else the first focusable, else the
// dialog container itself (callers give the dialog tabIndex={-1} for this).
const focusInitial = (container: HTMLElement) => {
  const preferred = container.querySelector<HTMLElement>('[data-autofocus]')
  if (preferred) {
    preferred.focus()
    return
  }
  const first = getFocusable(container)[0]
  if (first) {
    first.focus()
    return
  }
  container.focus()
}

export const useDialogFocus = (
  active: boolean,
  options: { focusKey?: unknown } = {}
): RefObject<HTMLDivElement | null> => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) {
      return
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    if (container) {
      focusInitial(container)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !container) {
        return
      }
      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const current = document.activeElement
      const inside = current instanceof HTMLElement && container.contains(current)
      // Wrap only at the boundaries; middle positions are left to the browser.
      if (event.shiftKey && (current === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }
    container?.addEventListener('keydown', onKeyDown)
    return () => {
      container?.removeEventListener('keydown', onKeyDown)
      if (previous && previous.isConnected) {
        previous.focus()
      }
    }
  }, [active])

  // Re-enter the dialog when a queued prompt replaces the answered one: the old
  // button is gone and focus fell to body, but the restore target must not be
  // re-captured (it still points at the element focused before the dialog opened).
  useEffect(() => {
    if (!active) {
      return
    }
    const container = containerRef.current
    if (container && !container.contains(document.activeElement)) {
      focusInitial(container)
    }
  }, [active, options.focusKey])

  return containerRef
}

// Escape-to-dismiss for a dialog. Listens on window while `active` (matching the
// dialogs' original per-dialog listeners) so dismissal works wherever focus sits.
// If a dialog ever stacks on another, both instances will fire on one Escape —
// the scoping/stopPropagation fix would then be made here, once.
export const useDialogEscape = (active: boolean, onDismiss: () => void): void => {
  // Latest-callback ref so callers may pass inline closures without rebinding the
  // window listener every render.
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])
}

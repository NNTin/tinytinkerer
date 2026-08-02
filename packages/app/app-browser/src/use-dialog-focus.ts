import { useEffect, useRef, type RefObject } from 'react'

// Shared keyboard/focus managers for the shell's aria-modal dialogs (the settings
// modal, the human-prompt modal, the pre-send disclosure, the privacy policy).
// aria-modal only tells assistive tech the rest of the page is inert — it does not
// move focus or handle keys. useDialogFocus covers the WCAG 2.4.3/2.1.2
// obligations: initial focus into the dialog when it opens, a Tab/Shift+Tab trap at
// the dialog boundaries, and restoration of focus to the previously focused element
// on close. useDialogEscape is its sibling for the dialog-dismiss key, so both
// dialogs encode the Escape decision once (#374).
//
// STACKING (issue #481 review, finding 2). Dialogs really do open over each other —
// the pre-send disclosure's "Read the privacy policy" is exactly that — and the
// naive version handled it badly in three ways at once: both Escape handlers fired
// on one key, so the underlying dialog closed too; the underlying dialog kept its
// Tab trap, so focus could not reach the one on top; and two `aria-modal` dialogs
// claimed the document simultaneously.
//
// So openness is now a STACK. Only the topmost dialog traps focus and answers
// Escape; everything beneath it is marked `inert`, which removes it from the
// pointer, the tab order, and the accessibility tree in one attribute. Closing the
// top dialog re-engages the one below and returns focus into it — not to whatever
// was focused before the whole stack opened, which is what a naive restore would
// have done.

type DialogToken = { id: number }

/**
 * One ordered stack per concern, not one shared stack.
 *
 * A single dialog usually calls BOTH hooks, so one shared stack would have it
 * pushing two entries and then deciding it was standing on top of itself — the
 * focus half would go `inert` because its own Escape half was above it. Keeping
 * "who traps focus" and "who answers Escape" in separate stacks means each hook
 * compares itself only against the same hook in other dialogs, which is the
 * question each is actually asking.
 */
const createDialogStack = () => {
  let stack: DialogToken[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    push: (token: DialogToken): void => {
      stack = [...stack, token]
      notify()
    },
    remove: (token: DialogToken): void => {
      stack = stack.filter((entry) => entry !== token)
      notify()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isTopmost: (token: DialogToken | null): boolean =>
      token !== null && stack[stack.length - 1] === token
  }
}

const focusStack = createDialogStack()
const escapeStack = createDialogStack()

let nextDialogId = 1
const mintToken = (): DialogToken => {
  const token = { id: nextDialogId }
  nextDialogId += 1
  return token
}

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
  const tokenRef = useRef<DialogToken | null>(null)
  // Bumped whenever engagement changes, purely so the re-entry effect below
  // re-runs. Engagement itself is never rendered state — see the effect.
  const engagementRef = useRef<(() => void) | null>(null)

  // Membership in the stack, and the ONE focus restoration, both keyed to the
  // dialog being open at all — deliberately separate from the engagement effect
  // below, which comes and goes as dialogs open above this one. Merging them
  // would restore focus to the pre-stack element every time a nested dialog
  // opened, yanking the reader out of the dialog they just asked for.
  useEffect(() => {
    if (!active) {
      return
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const token = mintToken()
    tokenRef.current = token
    focusStack.push(token)
    return () => {
      focusStack.remove(token)
      tokenRef.current = null
      if (previous && previous.isConnected) {
        previous.focus()
      }
    }
  }, [active])

  // Engagement is read from the stack AT EFFECT TIME and kept current by
  // subscribing, never derived from a rendered boolean.
  //
  // The rendered version had a real ordering hazard: this component's token is
  // pushed by the effect above, so during the render that first turns `active`
  // true the token is not in the stack yet and "am I on top?" answers no. The
  // dialog would mark itself `inert` and then depend on a re-render arriving to
  // undo it. Reading at effect time removes the question — this effect is
  // declared after the push, so the token is always already there.
  useEffect(() => {
    const container = containerRef.current
    if (!active || !container) {
      return
    }
    const disengage = () => {
      engagementRef.current?.()
      engagementRef.current = null
    }
    const engage = () => {
      container.removeAttribute('inert')
      focusInitial(container)
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab') {
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
      container.addEventListener('keydown', onKeyDown)
      engagementRef.current = () => container.removeEventListener('keydown', onKeyDown)
    }
    const sync = () => {
      const topmost = focusStack.isTopmost(tokenRef.current)
      if (topmost && !engagementRef.current) {
        engage()
        return
      }
      if (!topmost && engagementRef.current) {
        disengage()
        // Step aside completely rather than merely dropping the trap: `inert`
        // also takes this subtree out of the pointer and the accessibility
        // tree, so the dialog on top is genuinely the only modal a reader can
        // reach.
        container.setAttribute('inert', '')
      }
    }
    const unsubscribe = focusStack.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      disengage()
      container.removeAttribute('inert')
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
    if (
      container &&
      focusStack.isTopmost(tokenRef.current) &&
      !container.contains(document.activeElement)
    ) {
      focusInitial(container)
    }
  }, [active, options.focusKey])

  return containerRef
}

/**
 * Escape-to-dismiss for a dialog.
 *
 * Only the TOPMOST dialog answers, so a policy opened over a disclosure closes
 * itself and leaves the disclosure standing. Before the stack existed, both
 * listeners fired on the one key and the reader lost the message they were about
 * to send.
 *
 * A dialog that manages no focus container (`human-prompt-controls`, whose
 * presentation is inline) still registers here, so it participates in the same
 * ordering rather than answering out of turn.
 */
export const useDialogEscape = (active: boolean, onDismiss: () => void): void => {
  // Latest-callback ref so callers may pass inline closures without rebinding the
  // window listener every render.
  const onDismissRef = useRef(onDismiss)
  const tokenRef = useRef<DialogToken | null>(null)

  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!active) {
      return
    }
    const token = mintToken()
    tokenRef.current = token
    escapeStack.push(token)
    return () => {
      escapeStack.remove(token)
      tokenRef.current = null
    }
  }, [active])

  // Bound once while active; the topmost check happens when the key is pressed,
  // so a dialog opening or closing above this one needs no re-subscription.
  useEffect(() => {
    if (!active) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !escapeStack.isTopmost(tokenRef.current)) {
        return
      }
      onDismissRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])
}

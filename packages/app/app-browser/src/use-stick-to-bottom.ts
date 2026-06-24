import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

// How close to the bottom (in px) still counts as "pinned". A small slack keeps
// the conversation stuck to the latest message through sub-pixel rounding and
// the growth of a streaming answer, while a deliberate scroll up of more than a
// line unpins it.
const NEAR_BOTTOM_THRESHOLD_PX = 80

export type StickToBottom<T extends HTMLElement = HTMLDivElement> = {
  // Attach to the scrollable conversation container.
  scrollRef: RefObject<T | null>
  // True while the view is following the latest message.
  isPinned: boolean
  // True when the user has scrolled up AND new content has arrived since — the
  // signal to show the "Jump to latest" pill.
  showJumpButton: boolean
  // Scroll to the newest message and re-enable sticky following.
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

/**
 * Smart auto-scroll for a streaming conversation, shared by every shell so the
 * behavior never forks (web/mobile/widget all consume this hook).
 *
 * - While the user is near the bottom, new content keeps the view pinned.
 * - Once the user scrolls up to read, new content no longer yanks them down;
 *   instead {@link StickToBottom.showJumpButton} flips true so the shell can
 *   render a "↓ New messages" pill. Clicking it calls {@link
 *   StickToBottom.scrollToBottom}, which re-pins.
 *
 * Pass the value that changes when new content arrives (the live `events`
 * array) as `dependency`.
 */
export const useStickToBottom = <T extends HTMLElement = HTMLDivElement>(
  dependency: unknown
): StickToBottom<T> => {
  const scrollRef = useRef<T | null>(null)
  // The source of truth for "is following" lives in a ref so the scroll handler
  // and the content effect read a synchronous value; the state mirror only
  // drives re-renders (the pill).
  const pinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  const isNearBottom = useCallback(
    (el: T): boolean =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX,
    []
  )

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior })
    pinnedRef.current = true
    setIsPinned(true)
    setShowJumpButton(false)
  }, [])

  // Track manual scrolling so the pinned state reflects where the user is.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const onScroll = () => {
      const near = isNearBottom(el)
      pinnedRef.current = near
      setIsPinned(near)
      if (near) {
        setShowJumpButton(false)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isNearBottom])

  // On new content: follow when pinned, otherwise surface the jump pill.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      setShowJumpButton(false)
    } else {
      setShowJumpButton(true)
    }
  }, [dependency])

  return { scrollRef, isPinned, showJumpButton, scrollToBottom }
}

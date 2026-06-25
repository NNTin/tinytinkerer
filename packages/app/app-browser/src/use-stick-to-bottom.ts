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
 *
 * State updates are gated behind refs (see {@link setPinned}/{@link setJump}) so
 * they fire only on a genuine transition. A streamed answer is delivered as many
 * `events` appends in quick succession; if the content effect called setState on
 * every one, React would count them as nested updates and, past its depth limit,
 * throw "Maximum update depth exceeded" (#185) — tearing down the turn mid-stream
 * so the tail of the message never renders. The ref gate keeps the steady-state
 * (pinned, following) path setState-free.
 */
export const useStickToBottom = <T extends HTMLElement = HTMLDivElement>(
  dependency: unknown
): StickToBottom<T> => {
  const scrollRef = useRef<T | null>(null)
  // The source of truth for "is following" lives in a ref so the scroll handler
  // and the content effect read a synchronous value; the state mirror only
  // drives re-renders (the pill / any pinned-aware UI).
  const pinnedRef = useRef(true)
  const showJumpRef = useRef(false)
  const [isPinned, setIsPinned] = useState(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  // Commit a new pinned/jump value only when it actually changes, keeping the
  // ref (synchronous source of truth) and the state mirror in lockstep without
  // emitting redundant updates on every streamed delta.
  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) {
      return
    }
    pinnedRef.current = next
    setIsPinned(next)
  }, [])
  const setJump = useCallback((next: boolean) => {
    if (showJumpRef.current === next) {
      return
    }
    showJumpRef.current = next
    setShowJumpButton(next)
  }, [])

  const isNearBottom = useCallback(
    (el: T): boolean =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX,
    []
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current
      if (!el) {
        return
      }
      el.scrollTo({ top: el.scrollHeight, behavior })
      setPinned(true)
      setJump(false)
    },
    [setPinned, setJump]
  )

  // Track manual scrolling so the pinned state reflects where the user is.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const onScroll = () => {
      const near = isNearBottom(el)
      setPinned(near)
      if (near) {
        setJump(false)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isNearBottom, setPinned, setJump])

  // On new content: follow when pinned, otherwise surface the jump pill. The
  // setState calls are no-ops while the state is already correct (the common
  // pinned-and-following case), so a burst of streamed deltas does not schedule
  // an update per delta.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      setJump(false)
    } else {
      setJump(true)
    }
  }, [dependency, setJump])

  return { scrollRef, isPinned, showJumpButton, scrollToBottom }
}

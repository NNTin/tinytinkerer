/**
 * The control a reader sees on a cold documentation page (issue #480).
 *
 * This exists because the assistant runtime is lazy: `app-browser`'s own
 * minimized launcher lives inside the chunk that has not been downloaded yet, and
 * `scripts/check-docs-performance-budget.mjs` fails the build if any page
 * references that chunk. So the launcher on `/docs/` has to be a light control of
 * the documentation's own — no `@tinytinkerer/app-browser` import anywhere on the
 * path from `@theme/Root` to here.
 *
 * It is the ONLY interactive launcher while the runtime is `idle`, `starting` or
 * in `error`, and it disappears entirely at `ready`, where `ChatApp`'s own
 * launcher takes over. Two launchers are never on screen at once — one that opens
 * a panel and one that does nothing would be indistinguishable to a reader.
 *
 * It also renders during static rendering, so the launcher is in the built HTML of
 * every documentation route rather than appearing after hydration.
 *
 * Its CHROME is `tt-embed-launcher` from `@tinytinkerer/app-browser/embed.css` —
 * a CSS-only entry, so borrowing the product's own size, radius and elevation
 * costs no JavaScript and cannot drift from the launcher it hands off to (issue
 * #480 re-review, finding 1). Only position is the documentation's own.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import useBaseUrl from '@docusaurus/useBaseUrl'
import type { DocsAssistantRuntimeStatus } from './assistant-activation'

const LABEL: Record<DocsAssistantRuntimeStatus, string> = {
  idle: 'Open the documentation assistant',
  starting: 'Starting the documentation assistant',
  // Says what happened AND what the button now does. #476's lesson: a state that
  // advertises a retry must actually have one, and #490 made this retry real by
  // re-importing the runtime rather than replaying a memoised rejection.
  error: 'The documentation assistant failed to start. Try again',
  ready: 'Open the documentation assistant'
}

export type AssistantLauncherProps = {
  status: DocsAssistantRuntimeStatus
  onActivate: () => void
}

export const AssistantLauncher = ({ status, onActivate }: AssistantLauncherProps): ReactNode => {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const previousStatusRef = useRef<DocsAssistantRuntimeStatus>(status)
  const isStarting = status === 'starting'
  const label = LABEL[status]
  // The site's own brand icon, from the generated brand assets Docusaurus serves
  // as static files — the same image the navbar logo uses, so the launcher reads
  // as part of this site rather than as an injected third-party bubble.
  const iconUrl = useBaseUrl('/icon-192.png')

  // A failed start returns focus here (C1, issue #480). The reader pressed this
  // button, the panel they were promised never arrived, and the retry is on this
  // same control — leaving focus on `<body>` would drop a keyboard user back at
  // the top of the page with no idea the attempt had ended.
  useEffect(() => {
    const previous = previousStatusRef.current
    previousStatusRef.current = status
    if (status === 'error' && previous === 'starting') {
      buttonRef.current?.focus()
    }
  }, [status])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tt-embed-launcher docs-assistant-launcher"
        data-status={status}
        aria-label={label}
        title={label}
        // Not `disabled`: a disabled button drops out of the tab order and stops
        // being announced, so a keyboard reader who pressed it would lose the
        // element mid-flow and never hear the outcome. It reports itself busy and
        // ignores further presses instead.
        aria-busy={isStarting}
        onClick={() => {
          if (!isStarting) onActivate()
        }}
      >
        <img src={iconUrl} alt="" className="tt-embed-launcher__icon" />
      </button>
      {/* Announced rather than drawn: the visual cue is the button's own busy
          styling, and a floating text label would cover the page. */}
      <span role="status" aria-live="polite" className="docs-assistant-sr-only">
        {isStarting ? 'Starting the documentation assistant…' : ''}
      </span>
    </>
  )
}

import { useEffect, useId, useState, type ReactNode } from 'react'
import { setDocsHostOverlay } from '../docs-runtime'

export type LabStatus = 'loading' | 'ready' | 'warning' | 'error'

export interface LabContainerProps {
  title: string
  status?: LabStatus
  warningMessage?: string
  errorMessage?: string
  onRetry?: () => void
  allowFullscreen?: boolean
  children?: ReactNode
}

const STATUS_LABEL: Record<LabStatus, string> = {
  loading: 'Loading',
  ready: 'Ready',
  warning: 'Warning',
  error: 'Error'
}

// Presentational shell for the interactive labs tracked by the MDX live-lab
// framework issue: it owns the responsive/loading/warning/error/fullscreen
// chrome so every lab looks and behaves the same, but renders no lab behavior
// itself (`status="ready"` just renders `children` as-is).
export const LabContainer = ({
  title,
  status = 'ready',
  warningMessage,
  errorMessage,
  onRetry,
  allowFullscreen = true,
  children
}: LabContainerProps): React.JSX.Element => {
  const [fullscreen, setFullscreen] = useState(false)
  const headingId = useId()
  const overlayId = `lab-fullscreen:${headingId}`

  // Tell the assistant overlay to stand down while this lab owns the viewport
  // (issue #480). Declared rather than sniffed for: this component knows the
  // answer exactly, and a fullscreen lab is a `role="dialog" aria-modal` surface
  // that a floating widget must not sit on top of. Keyed per instance so two
  // labs could never cancel each other's claim.
  useEffect(() => {
    if (!fullscreen) return undefined
    setDocsHostOverlay(overlayId, true)
    return () => {
      setDocsHostOverlay(overlayId, false)
    }
  }, [fullscreen, overlayId])

  useEffect(() => {
    if (!fullscreen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setFullscreen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  return (
    <section
      className={`lab-container${fullscreen ? ' lab-container--fullscreen' : ''}`}
      aria-labelledby={headingId}
      {...(fullscreen ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <header className="lab-container__header">
        <span id={headingId} className="lab-container__title">
          {title}
        </span>
        <div className="lab-container__header-actions">
          <span className="lab-container__status">{STATUS_LABEL[status]}</span>
          {allowFullscreen ? (
            <button
              type="button"
              className="lab-container__fullscreen-toggle"
              aria-pressed={fullscreen}
              onClick={() => setFullscreen((value) => !value)}
            >
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          ) : null}
        </div>
      </header>
      <div className="lab-container__body">
        {status === 'loading' ? (
          <div className="lab-container__loading" role="status" aria-live="polite">
            <span className="lab-container__spinner" aria-hidden="true" />
            <span>Loading {title}…</span>
          </div>
        ) : null}
        {status === 'warning' ? (
          <div className="lab-container__banner lab-container__banner--warning" role="status">
            <span className="lab-container__banner-icon" aria-hidden="true">
              !
            </span>
            <span>{warningMessage ?? 'This lab may not behave as expected.'}</span>
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="lab-container__banner lab-container__banner--error" role="alert">
            <div>
              <span className="lab-container__banner-icon" aria-hidden="true">
                ✕
              </span>{' '}
              <span>{errorMessage ?? 'This lab failed to load.'}</span>
              {onRetry ? (
                <div>
                  <button type="button" className="lab-container__retry" onClick={onRetry}>
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {status === 'ready' ? children : null}
      </div>
    </section>
  )
}

export default LabContainer

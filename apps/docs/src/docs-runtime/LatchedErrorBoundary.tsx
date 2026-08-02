/**
 * The assistant's one error boundary (issue #480 re-review, finding 6).
 *
 * It renders nothing once its subtree has thrown, and reports the failure. Both
 * of those are deliberate and are what makes one component serve two containment
 * levels: the host's boundary around the lazy runtime chunk, and the shell's
 * boundary around the assistant's surfaces. Neither may draw a fallback — the
 * assistant lives beside a documentation page it must never deface — and both
 * turn the failure into the same activation status a launcher can retry from.
 *
 * `failed` LATCHES: React re-renders the boundary after a catch, and a boundary
 * that reset itself would remount the same throwing subtree forever. A caller
 * that wants a retry mounts a fresh boundary instead, by `key`ing this on its
 * attempt number.
 *
 * Light by construction — React and nothing else — so the module is safe on the
 * `@theme/Root` path as well as inside the runtime chunk.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

export type LatchedErrorBoundaryProps = {
  children: ReactNode
  /**
   * What went wrong, for the caller to report. Runs from `componentDidCatch`,
   * which React calls BEFORE the surviving effects of that commit flush — so a
   * status published here cannot be overwritten by an effect in the subtree that
   * was about to claim success.
   */
  onError: (error: Error, info: ErrorInfo) => void
}

type LatchedErrorBoundaryState = { failed: boolean }

export class LatchedErrorBoundary extends Component<
  LatchedErrorBoundaryProps,
  LatchedErrorBoundaryState
> {
  state: LatchedErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): LatchedErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

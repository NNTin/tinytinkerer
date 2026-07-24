import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginReport } from '@tinytinkerer/app-core'
import { forwardPluginReport } from './telemetry/plugin-report'

type ReportableView = {
  report?: PluginReport
}

type ResolvedState<TView> = {
  key: string
  view: TView
  pending: boolean
}

export type PluginViewResolution = 'resolved' | 'threw' | 'rejected'

type ProducedView<TView> =
  | { kind: 'resolved'; view: TView }
  | { kind: 'pending'; promise: Promise<TView> }
  | { kind: 'threw' }

const isPromiseLike = <TView>(value: TView | Promise<TView>): value is Promise<TView> =>
  typeof (value as { then?: unknown }).then === 'function'

const reportKey = (viewKey: string, report: PluginReport): string =>
  `${viewKey}:${report.pluginId}:${report.kind}`

// Resolves a plugin-owned view model for a stable surface identity. The caller owns
// the key and must keep raw input/output object references out of it; this hook then
// resolves only when that key changes and forwards a view report once per key/kind.
export const useResolvedPluginView = <TView extends ReportableView>({
  viewKey,
  fallback,
  resolveView,
  onSettled
}: {
  viewKey: string
  fallback: TView
  resolveView: () => TView | Promise<TView>
  // Called only after the owner resolution SETTLES. In particular, an async
  // mapper's temporary fallback is not settled and must not be mistaken for a
  // real `unknown` activity outcome.
  onSettled?: (view: TView, resolution: PluginViewResolution) => void
}): { view: TView; pending: boolean } => {
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  const produced = useMemo<ProducedView<TView>>(() => {
    try {
      const value = resolveView()
      return isPromiseLike(value)
        ? { kind: 'pending', promise: value }
        : { kind: 'resolved', view: value }
    } catch {
      return { kind: 'threw' }
    }
  }, [viewKey])

  const immediateView = produced.kind === 'resolved' ? produced.view : fallback
  const [state, setState] = useState<ResolvedState<TView>>(() => ({
    key: viewKey,
    view: immediateView,
    pending: produced.kind === 'pending'
  }))
  const forwardedReports = useRef<Set<string>>(new Set())
  const settledViews = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const forwardReportOnce = (view: TView): void => {
      if (!view.report) {
        return
      }
      const key = reportKey(viewKey, view.report)
      if (forwardedReports.current.has(key)) {
        return
      }
      forwardedReports.current.add(key)
      forwardPluginReport(view.report)
    }
    const settleOnce = (view: TView, resolution: PluginViewResolution): void => {
      const key = `${viewKey}:${resolution}`
      if (settledViews.current.has(key)) {
        return
      }
      settledViews.current.add(key)
      onSettledRef.current?.(view, resolution)
    }

    if (produced.kind === 'resolved') {
      setState({ key: viewKey, view: produced.view, pending: false })
      forwardReportOnce(produced.view)
      settleOnce(produced.view, 'resolved')
      return
    }

    if (produced.kind === 'threw') {
      setState({ key: viewKey, view: fallbackRef.current, pending: false })
      settleOnce(fallbackRef.current, 'threw')
      return
    }

    setState({ key: viewKey, view: fallbackRef.current, pending: true })
    void produced.promise
      .then((resolved) => {
        if (cancelled) {
          return
        }
        setState({ key: viewKey, view: resolved, pending: false })
        forwardReportOnce(resolved)
        settleOnce(resolved, 'resolved')
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key: viewKey, view: fallbackRef.current, pending: false })
          settleOnce(fallbackRef.current, 'rejected')
        }
      })

    return () => {
      cancelled = true
    }
  }, [produced, viewKey])

  return state.key === viewKey
    ? { view: state.view, pending: state.pending }
    : { view: immediateView, pending: produced.kind === 'pending' }
}

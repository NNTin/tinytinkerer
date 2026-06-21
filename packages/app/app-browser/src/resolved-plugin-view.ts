import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginReport } from '@tinytinkerer/app-core'
import { forwardPluginReport } from './telemetry/plugin-report'

type ReportableView = {
  report?: PluginReport
}

type ResolvedState<TView> = {
  key: string
  view: TView
}

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
  resolveView
}: {
  viewKey: string
  fallback: TView
  resolveView: () => TView | Promise<TView>
}): TView => {
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback

  const produced = useMemo<TView | Promise<TView>>(() => {
    try {
      return resolveView()
    } catch {
      return fallbackRef.current
    }
  }, [viewKey])

  const immediateView = isPromiseLike(produced) ? fallback : produced
  const [state, setState] = useState<ResolvedState<TView>>(() => ({
    key: viewKey,
    view: immediateView
  }))
  const forwardedReports = useRef<Set<string>>(new Set())

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

    if (!isPromiseLike(produced)) {
      setState({ key: viewKey, view: produced })
      forwardReportOnce(produced)
      return
    }

    setState({ key: viewKey, view: fallbackRef.current })
    void produced
      .then((resolved) => {
        if (cancelled) {
          return
        }
        setState({ key: viewKey, view: resolved })
        forwardReportOnce(resolved)
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key: viewKey, view: fallbackRef.current })
        }
      })

    return () => {
      cancelled = true
    }
  }, [produced, viewKey])

  return state.key === viewKey ? state.view : immediateView
}

import { isPluginEnabled } from '@tinytinkerer/app-core'
import type {
  ChatEvent,
  GaugeThreshold,
  GaugeView,
  StatusSummarizer
} from '@tinytinkerer/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore, useSettingsStore } from './app'
import { useModels } from './models'
import { loadPluginModules } from './plugins/registry'

// Most recent reported prompt-token count (the "most-recent turn" semantics for
// percent_context_used). Scans from the end for the latest agent.usage event;
// returns null when none has been observed yet (gauge stays hidden).
const latestPromptTokens = (events: ChatEvent[]): number | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'agent.usage') {
      return event.payload.promptTokens
    }
  }
  return null
}

// Resolve the active status plugin's pure summarizer (first enabled plugin that
// contributes a statusDescriptor wins) and compute the gauge view-model from the
// host's own numbers: the selected model's input context window + the latest
// reported usage. Returns null whenever the gauge should be hidden — no enabled
// status plugin, unknown context window, or no usage seen yet. The plugin owns
// the math/thresholds; the host only supplies data and renders the result.
export const useContextGauge = (): GaugeView | null => {
  const events = useChatStore((state) => state.events)
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const { models, refreshModels } = useModels(selectedModel)

  const [summarizer, setSummarizer] = useState<StatusSummarizer | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadPluginModules().then((modules) => {
      if (cancelled) return
      const active = modules.find(
        (mod) => mod.manifest.statusDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
      )
      setSummarizer(() => active?.manifest.statusDescriptor?.summarizeStatus ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [pluginActivation])

  // Best-effort: when the gauge is active but the selected model carries no
  // limits (the chat surface starts from the built-in fallback list), pull the
  // catalogue ONCE per selected model so context_window becomes available.
  //
  // The single-attempt guard is essential, not just an optimization:
  // `refreshModels` is a forced re-probe whose identity changes every time it
  // updates `models` (see useModels), so an unguarded effect would re-fire on its
  // own state update and hammer /api/models/list forever whenever the selected
  // model never resolves a context window (e.g. a model absent from the catalogue
  // for which includeSelectedModel synthesizes a bare, limit-less entry). The ref
  // bounds us to one fetch per distinct model; if limits still don't arrive the
  // gauge simply stays hidden.
  const selectedHasLimits =
    models.find((model) => model.id === selectedModel)?.limits?.max_input_tokens != null
  const fetchedForModelRef = useRef<string | null>(null)
  useEffect(() => {
    if (!summarizer || selectedHasLimits) return
    if (fetchedForModelRef.current === selectedModel) return
    fetchedForModelRef.current = selectedModel
    void refreshModels()
  }, [summarizer, selectedHasLimits, selectedModel, refreshModels])

  return useMemo(() => {
    if (!summarizer) return null
    const contextWindow =
      models.find((model) => model.id === selectedModel)?.limits?.max_input_tokens ?? null
    return summarizer({ contextWindow, inputTokensUsed: latestPromptTokens(events) })
  }, [summarizer, models, selectedModel, events])
}

const THRESHOLD_COLOR: Record<GaugeThreshold, string> = {
  healthy: '#16a34a',
  warning: '#d97706',
  critical: '#dc2626'
}

const THRESHOLD_LABEL: Record<GaugeThreshold, string> = {
  healthy: 'healthy',
  warning: 'warning',
  critical: 'critical'
}

const formatTokens = (value: number): string => value.toLocaleString('en-US')

export type ContextGaugeProps = {
  view: GaugeView
  className?: string
  // Diameter in px of the ring. Small by default so it sits unobtrusively near
  // the composer.
  size?: number
}

// A small SVG donut gauge. Colour encodes the threshold, but the threshold is
// ALSO conveyed by the numeric percent label and the accessible name, so the
// gauge never relies on colour alone (WCAG 1.4.1). Generic and product-agnostic:
// it renders whatever GaugeView a status plugin produced.
export const ContextGauge = ({ view, className, size = 36 }: ContextGaugeProps) => {
  const color = THRESHOLD_COLOR[view.threshold]
  const strokeWidth = Math.max(3, Math.round(size / 9))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (view.value / 100) * circumference
  const center = size / 2

  const accessibleName = `Context usage: ${view.value}% (${THRESHOLD_LABEL[view.threshold]}). ${formatTokens(
    view.context.input_tokens_used
  )} of ${formatTokens(view.context.context_window)} tokens used.`

  return (
    <span
      className={className}
      role="meter"
      aria-valuemin={view.min}
      aria-valuemax={view.max}
      aria-valuenow={view.value}
      aria-valuetext={accessibleName}
      aria-label={accessibleName}
      title={accessibleName}
      data-testid="context-usage-gauge"
      data-threshold={view.threshold}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color }}>{view.value}%</span>
    </span>
  )
}

// Convenience wrapper: resolve the gauge view-model and render it, or render
// nothing when the gauge should be hidden. Drop this anywhere in a chat surface.
export const ContextGaugeSlot = (props: Omit<ContextGaugeProps, 'view'>) => {
  const view = useContextGauge()
  if (!view) return null
  return <ContextGauge view={view} {...props} />
}

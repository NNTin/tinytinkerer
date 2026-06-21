import { isPluginEnabled } from '@tinytinkerer/app-core'
import type {
  ChatEvent,
  GaugeThreshold,
  GaugeView,
  StatusSummarizer
} from '@tinytinkerer/contracts'
import { useEffect, useMemo, useRef } from 'react'
import { useChatStore, useSettingsStore } from './app'
import { useModels } from './models'
import { usePluginModules } from './plugins/use-plugin-modules'

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

  const pluginModules = usePluginModules()
  const summarizer = useMemo<StatusSummarizer | null>(() => {
    const active = pluginModules.find(
      (mod) => mod.manifest.statusDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
    )
    return active?.manifest.statusDescriptor?.summarizeStatus ?? null
  }, [pluginModules, pluginActivation])

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
  // Diameter in px of the ring. Small by default (icon-sized) so it sits next to
  // the composer buttons.
  size?: number
  // The selected model's name, shown in the tooltip/accessible name. Optional:
  // when omitted the tooltip simply drops the "Model:" segment.
  modelLabel?: string
}

// A small SVG donut gauge. Colour encodes the threshold severity, but it is NOT
// the only visual cue: the arc length conveys magnitude without colour, and at
// warning/critical a monochrome alert badge (outline → filled triangle) encodes
// the severity by SHAPE, so the gauge never relies on colour alone (WCAG 1.4.1).
// The accessible name carries the full text regardless. Generic and
// product-agnostic: it renders whatever GaugeView a status plugin produced.
export const ContextGauge = ({ view, className, size = 16, modelLabel }: ContextGaugeProps) => {
  const color = THRESHOLD_COLOR[view.threshold]
  const strokeWidth = Math.max(3, Math.round(size / 9))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (view.value / 100) * circumference
  const center = size / 2

  const modelSegment = modelLabel ? ` Model: ${modelLabel}.` : ''
  const accessibleName = `Context usage: ${view.value}% (${THRESHOLD_LABEL[view.threshold]}).${modelSegment} ${formatTokens(
    view.context.input_tokens_used
  )} of ${formatTokens(view.context.context_window)} tokens used, ${formatTokens(
    view.context.input_tokens_remaining
  )} remaining.`

  // Non-colour severity cue (WCAG 1.4.1): nothing at healthy, a small outline
  // triangle at warning, a filled one at critical — distinguishable by shape
  // alone. A badge size of ~half the ring keeps it legible at icon scale.
  const badge = size * 0.5

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
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
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
      {view.threshold !== 'healthy' ? (
        <svg
          width={badge}
          height={badge}
          viewBox="0 0 10 10"
          aria-hidden="true"
          style={{ position: 'absolute', top: -badge * 0.25, right: -badge * 0.25 }}
        >
          <path
            d="M5 0.5 L9.5 9 L0.5 9 Z"
            fill={view.threshold === 'critical' ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  )
}

// Convenience wrapper: resolve the gauge view-model and render it, or render
// nothing when the gauge should be hidden. Drop this anywhere in a chat surface.
// The selected model id (its label by convention) is read here and threaded into
// the tooltip — kept in the host, never in the plugin's host-agnostic view.
export const ContextGaugeSlot = (props: Omit<ContextGaugeProps, 'view'>) => {
  const view = useContextGauge()
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  if (!view) return null
  return <ContextGauge view={view} modelLabel={selectedModel} {...props} />
}

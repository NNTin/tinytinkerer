import type {
  GaugeThreshold,
  GaugeView,
  StatusInput,
  StatusSummarizer
} from '@tinytinkerer/contracts'

// Colour/severity thresholds for percent of the context window used (issue #264):
//   healthy  < 70%
//   warning  70%–90% (inclusive)
//   critical > 90%
// The host pairs each bucket with a non-colour signal (the numeric label + ARIA)
// so the gauge never relies on colour alone.
const HEALTHY_BELOW = 70
const WARNING_AT_OR_BELOW = 90

export const thresholdForPercent = (percent: number): GaugeThreshold => {
  if (percent < HEALTHY_BELOW) return 'healthy'
  if (percent <= WARNING_AT_OR_BELOW) return 'warning'
  return 'critical'
}

const isUsableNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// Pure mapper: host-provided context-window numbers → a GaugeView, or null when
// the gauge cannot be shown. Returns null (hide) when the context window is
// unknown/non-positive or no usage has been observed — never throws, never
// touches React/DOM (enforced by scripts/check-boundaries.mjs).
export const computeContextGauge: StatusSummarizer = ({
  contextWindow,
  inputTokensUsed
}: StatusInput): GaugeView | null => {
  if (!isUsableNumber(contextWindow) || contextWindow <= 0) return null
  if (!isUsableNumber(inputTokensUsed) || inputTokensUsed < 0) return null

  const percent = Math.max(0, Math.min(100, Math.round((inputTokensUsed / contextWindow) * 100)))
  const remaining = Math.max(0, contextWindow - inputTokensUsed)

  return {
    gauge_type: 'context_usage',
    value: percent,
    min: 0,
    max: 100,
    unit: 'percent',
    threshold: thresholdForPercent(percent),
    context: {
      context_window: contextWindow,
      input_tokens_used: inputTokensUsed,
      input_tokens_remaining: remaining,
      percent_context_used: percent
    }
  }
}

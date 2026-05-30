import { lazy } from 'react'

export const LazyTelemetryConsentGate = lazy(() =>
  import('./consent-gate').then((module) => ({
    default: module.TelemetryConsentGate
  }))
)

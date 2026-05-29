import { lazy } from 'react'

export const LazyPrivacyPolicyUpdateGate = lazy(() =>
  import('./privacy-update-gate').then((module) => ({
    default: module.PrivacyPolicyUpdateGate
  }))
)

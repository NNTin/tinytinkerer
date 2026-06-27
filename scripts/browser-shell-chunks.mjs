// Shared chunk policy for every chat-bearing browser shell. Bundle budgets rely
// on these names, so keep the classification in one place rather than letting
// web/mobile/widget/harness shells drift independently.
export const browserShellManualChunks = (id) => {
  if (
    id.includes('node_modules/react/') ||
    id.includes('node_modules/react-dom/') ||
    id.includes('node_modules/react-router')
  ) {
    return 'react-vendor'
  }
  if (id.includes('node_modules/zod/')) {
    return 'zod-vendor'
  }
  if (
    id.includes('packages/app/app-core/') ||
    id.includes('packages/app/agent-core/') ||
    id.includes('packages/shared/contracts/')
  ) {
    return 'app-core'
  }
  if (id.includes('node_modules/@sentry/') || id.includes('node_modules/@sentry-internal/')) {
    return 'sentry-vendor'
  }
  if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/codemirror/')) {
    return 'codemirror-vendor'
  }
  if (id.includes('node_modules/prettier/')) {
    return 'prettier-vendor'
  }
}

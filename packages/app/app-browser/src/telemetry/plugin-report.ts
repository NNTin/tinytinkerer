import type { PluginReport } from '@tinytinkerer/app-core'
import { captureTelemetryException, captureTelemetryMessage } from './telemetry'

// Forwards a tool owner's view report (from a PermissionView or an ActivityView) to
// telemetry. Mirrors the plugin capture sink wired in runtime/create-runtime.ts so a
// report raised while rendering a prompt or an activity summary is grouped/levelled
// identically to one raised at runtime. Shared by the permission modal and the turn
// activity panel so both surfaces report the same way.
export const forwardPluginReport = (report: PluginReport): void => {
  const options = {
    level: report.level ?? 'warning',
    tags: { plugin: report.pluginId, plugin_kind: report.kind },
    ...(report.contexts ? { contexts: report.contexts } : {}),
    fingerprint: ['plugin', report.pluginId, report.kind]
  }
  if (report.level === 'info') {
    captureTelemetryMessage(report.message, options)
  } else {
    captureTelemetryException(report.message, options)
  }
}

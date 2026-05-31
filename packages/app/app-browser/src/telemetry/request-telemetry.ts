// The request-telemetry engine now lives in the SDK-agnostic
// @tinytinkerer/sentry-telemetry package (shared with the edge). app-browser
// remains the browser-facing facade, so its call sites keep importing from here.
// See docs/sentry-telemetry.md.
export * from '@tinytinkerer/sentry-telemetry'

## Privacy policy updated

We updated the privacy policy to document Web Speech API voice input, including that speech
recognition depends on your browser or device vendor and may run locally or in the cloud.

We also updated the privacy policy to document browser request-failure telemetry. When
telemetry is enabled, TinyTinkerer may now send sanitized request diagnostics to Sentry for
browser-initiated application requests, including method, URL path without query string,
status code, and failure type. This does not include conversation content, request bodies,
query strings, cookies, authorization headers, or GitHub access tokens.

This change is needed to surface operational failures in the frontend and to support future
rate limit prevention work without expanding the scope of personal or message data collected.

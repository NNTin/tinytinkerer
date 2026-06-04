## Privacy policy updated

We updated the privacy policy to document Web Speech API voice input, including that speech
recognition depends on your browser or device vendor and may run locally or in the cloud.

We also updated the privacy policy to document browser request-failure telemetry. When
telemetry is enabled, TinyTinkerer may now send sanitized request diagnostics to Sentry for
browser-initiated application requests, including method, URL path without query string,
status code, and failure type. This does not include conversation content, request bodies,
query strings, cookies, authorization headers, or GitHub access tokens.

We also added the optional Feedback plugin (`send_feedback`). It is off by default and enabled
in Settings → Plugins. When both the plugin and telemetry are enabled, the feedback text you
submit is sent to Sentry as a telemetry event so the maintainers can read it. This is the only
case in which TinyTinkerer sends content you typed; if the plugin or telemetry is disabled, no
feedback is sent. Note that enabling the plugin adds the `send_feedback` tool to every chat,
which uses a little of the assistant's context and some extra tokens, so the Chat Assistant may
perform slightly worse — leaving it on is a small, voluntary way to support the project and save
the maintainer development time.

This change is needed to surface operational failures in the frontend and to support future
rate limit prevention work without expanding the scope of personal or message data collected.

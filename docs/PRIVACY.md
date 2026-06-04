# Privacy & Telemetry

TinyTinkerer collects limited, optional diagnostic data ("telemetry") to improve the
stability, performance, and security of the application. Telemetry is off by default and
only starts after you explicitly enable it.

## What we collect

When telemetry is enabled, we collect:

- Crash and error reports (error messages and stack traces).
- Request-failure diagnostics for browser-initiated application requests, including
  sanitized method/path/status metadata and failures while parsing or validating
  responses.
- The application version and build hash.
- A random installation ID (a UUID generated on this device).
- When you are signed in, your GitHub account identifier (id/login).
- Your IP address, which is automatically observed by our error-monitoring
  provider (Sentry) and our edge infrastructure (Cloudflare) when reports and
  requests are received. We do not use it to track you across sites.

## What we do NOT collect

- The content of your conversations, prompts, or responses.
- Your GitHub access token, OpenRouter API key, or any credentials.
- Request bodies, query strings, cookies, or authorization headers in telemetry events.

The one exception to "we do not collect your content" is the optional Feedback plugin: if
you enable it and submit feedback, the feedback text you write is sent through telemetry on
purpose. See "Feedback plugin (send_feedback)" below.

## Voice input (Web Speech API)

When you turn on voice input in Settings → Privacy, TinyTinkerer asks the browser for microphone
access only when you start dictation. Speech recognition is provided by the device/browser through
the Web Speech API (`SpeechRecognition`). Depending on the platform, speech processing may happen
locally on your device or be sent by the browser vendor to a cloud speech service. TinyTinkerer
does not run its own speech-to-text model or send audio to its backend for transcription.

## Feedback plugin (send_feedback)

TinyTinkerer ships an optional **Feedback** plugin that exposes a `send_feedback` tool to the
assistant. It is a plugin, off by default, and you enable it in Settings → Plugins.

The plugin has no dedicated backend. When it is enabled **and** telemetry is also enabled, the
feedback text (plus its category, either `bug` or `idea`) is sent to Sentry as a telemetry event
so the maintainers can read it. The feedback can come from you (reporting a bug or suggesting an
improvement) or from the assistant itself, which may send an `idea` when it runs into a limitation
in its environment. Either way this is the deliberate exception to the rule that we do not collect
the content you type.

Enabling the plugin also adds the `send_feedback` tool to every chat. That occupies a small part
of the assistant's context window and spends some extra tokens on each request, so the Chat
Assistant may perform slightly worse while the plugin is on. We mention this so the trade-off is
clear: leaving it enabled is a small, voluntary way to support the project — a bit like buying the
maintainer a coffee — and it saves development time by sending feedback straight through telemetry.

If the plugin is disabled, or telemetry is disabled, no feedback is sent anywhere. As with all
telemetry, feedback is only delivered from deployed builds, not from local development.

## Why we collect it

To detect, reproduce, and fix crashes and errors, and to improve reliability and security.

## Anonymous or linked?

Telemetry is pseudonymous by default: events are associated with a random installation ID,
not your identity. When you are signed in and telemetry is enabled, reports may be linked to
your GitHub account so we can follow up on issues.

## Where it is sent

- Crash and error reports are sent to Sentry (our error-monitoring provider).
- Browser request-failure diagnostics are sent to Sentry with sanitized request metadata
  (method, URL path without query string, status code, and failure type).
- The application version, build hash, installation ID, and (when signed in) GitHub identifier
  are sent as request headers (X-App-Version, X-Build-Hash, X-Install-ID, X-GitHub-ID) to the
  TinyTinkerer edge API. X-App-Version and X-Build-Hash are always sent as non-identifying
  operational metadata; X-Install-ID and X-GitHub-ID are only sent once telemetry has been
  enabled.

## How long we keep it

Diagnostic data is retained only as long as needed to investigate and fix issues,
subject to our error-monitoring provider's default retention period (Sentry retains
events for up to 90 days).

## Your control

Telemetry is opt-in and off by default. You can enable or disable it at any time in
Settings → Privacy → Telemetry. Disabling it stops further reports immediately.

To request access to, or deletion of, diagnostic data associated with your
installation ID or GitHub account, contact the data controller (Tin Nguyen) at:
https://www.linkedin.com/in/tin-nguyen-019299279/

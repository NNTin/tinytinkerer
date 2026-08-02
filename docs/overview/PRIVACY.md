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

- The content of your conversations, prompts, or responses. (Conversation content is
  processed in transit to generate responses — see "Chat content and the model proxy
  (LiteLLM)" below — but it is not collected as telemetry.)
- Your GitHub access token or any credentials.
- Request bodies, query strings, cookies, or authorization headers in telemetry events.

The one exception to "we do not collect your content" is the optional Feedback plugin: if
you enable it and submit feedback, the feedback text you write is sent through telemetry on
purpose. See "Feedback plugin (send_feedback)" below.

## Chat content and the model proxy (LiteLLM)

When you send a chat message, the conversation content (your messages and the model's
responses) is transmitted through the TinyTinkerer edge API to a self-hosted
[LiteLLM](https://docs.litellm.ai/docs/) proxy operated by the maintainer, which forwards
it to the third-party model providers configured by the maintainer to generate responses.
Those providers process the content under their own terms.

Model requests are sent to LiteLLM with a per-user LiteLLM virtual key derived from
your GitHub account id. GitHub sign-in is used to verify that the caller holds a valid
GitHub token and to read the `id` and `login` fields from GitHub's `/user` response.
The edge does not forward your GitHub access token to LiteLLM or model providers.

The proxy does not store conversation content. It records per-request operational
metadata — model name, token counts, cost, timestamps and request duration, the
LiteLLM key alias/user id for your GitHub account, and success/error status (error logs
include the error message) — which the maintainer can view in the LiteLLM dashboard to
monitor usage, cost, reliability, and per-account budgets. Because requests reach the
proxy from the edge infrastructure, the proxy sees the edge's network address, not your
device's IP address.

The LiteLLM instance is self-hosted and sends no telemetry to LiteLLM (the vendor).

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
feedback text (plus its category, either `bug` or `idea`) is sent to Sentry so the maintainers can
read it. The feedback can come from you (reporting a bug or suggesting an improvement) or from the
assistant itself, which may send an `idea` when it runs into a limitation in its environment.
Either way this is the deliberate exception to the rule that we do not collect the content you type.

Enabling the plugin also adds the `send_feedback` tool to every chat. That occupies a small part
of the assistant's context window and spends some extra tokens on each request, so the Chat
Assistant may perform slightly worse while the plugin is on. We mention this so the trade-off is
clear: leaving it enabled is a small, voluntary way to support the project — a bit like buying the
maintainer a coffee — and it saves development time by sending feedback straight through telemetry.

If the plugin is disabled, or telemetry is disabled, no feedback is sent anywhere.

## Browser state plugin (read_dom)

TinyTinkerer ships an optional **Browser state** plugin that exposes a `read_dom` tool to the
assistant. It is a plugin, off by default, and you enable it in Settings → Plugins.

When it is enabled, the assistant can read the page you are currently viewing so it can answer
questions about what is on screen and debug rendering issues. It reads the page through narrow
CSS-selector queries (never the whole page at once), and whatever it reads is sent to the model
provider as part of that chat turn — the same path your conversation already takes (see "Chat
content and the model proxy (LiteLLM)" above). Two things are worth calling out: the tool can
surface content that is on the page but that you have **not yet sent** as a message (for example,
text in an input box), and enabling it adds the `read_dom` tool to every chat, which spends a small
amount of extra context on each request.

To limit what is exposed, the host **redacts editable content before returning** it: the
`value`/`checked` of inputs, the default text of text areas, password values, a drop-down's
currently-selected value, and the text inside rich-text / `contenteditable` editors are all stripped,
so text you have typed but not sent is not included. It also removes inline event handlers and any
`<iframe srcdoc>` from the returned markup. The tool reads only the current page and never reaches
into a sandboxed or cross-origin frame.

If the plugin is disabled, the `read_dom` tool is not available and no page content is read.

## Documentation assistant

Every page under `/docs/` carries a floating **documentation assistant**. It is the same
TinyTinkerer chat assistant, running in its own isolated session, with three extra tools that let
it search and read this documentation.

Before your first message it shows a one-time notice describing exactly what follows, and it will
not send anything until you acknowledge it. You can re-read that summary at any time in the
assistant's Settings → Privacy.

**Reading documentation sends no content to a model.** Merely visiting a `/docs/` page, or opening
the assistant panel, does not send the page, your conversation, or any documentation content to a
model. Some ordinary requests do happen: a documentation page fetches a small index of the
documentation's own structure, opening the assistant downloads its code, and the assistant may ask
the TinyTinkerer edge which models are available. None of those carry conversation or documentation
content, and none of them reaches a model.

**What is sent when you do send a message:**

- Your messages and the assistant's replies, along the exact path described above under "Chat
  content and the model proxy (LiteLLM)" — the same edge API, the same LiteLLM proxy, the same
  model providers.
- **Documentation content**, but only when the assistant actually invokes one of its documentation
  tools. A search returns page titles, headings, and short excerpts; a read returns a page's
  documentation text, in full or as selected sections. Both are derived from the Markdown this
  documentation is written in. If the assistant answers without calling a tool, no documentation
  content is sent at all.

**What it reads, and what it cannot.** The assistant's content all comes from the authored
Markdown/MDX files this documentation is written from, prepared at build time. It does **not** read
the rendered page you are looking at, the contents of form fields or search boxes, a live lab's
conversation or state, your other browser tabs, or anything else on the page. This is a different
mechanism from the optional Browser state (`read_dom`) plugin described above — that plugin cannot
be enabled on the documentation site at all. A single tool response is capped, so a long page is
returned as selected sections rather than in full.

**Unlisted pages.** Pages marked unlisted are excluded from the assistant's search, exactly as they
are excluded from the site's search bar. If you navigate directly to one, the assistant can read
that page when you ask it to, because you are already looking at it.

**Signing in is optional.** Signed out, you share an anonymous, rate-limited quota with every other
visitor. Signing in uses the same GitHub sign-in as the rest of TinyTinkerer and gives you your own
budget and rate limits; it is never required to get an answer.

**Separate storage.** The assistant's conversations, model choice, and tool selections live in
their own browser database, separate from your real TinyTinkerer conversations and separate again
from each live lab's. Its reset control clears only the assistant's active conversation.

## Interactive documentation labs

Pages under `/docs/` may embed a **live lab** — a working, embedded copy of TinyTinkerer used to
demonstrate a real feature (for example, a live agent run or the plugin tool picker). A lab is
clearly marked in its own page and shows a standing notice before it contacts anything. When you
use one:

- It reuses your existing sign-in **read-only**: if you are already signed in to TinyTinkerer in
  this browser, the lab reads that token to act as you; it is never written back, so signing in
  from a lab never creates a separate credential, and signing in from a lab is the same GitHub
  OAuth flow as the rest of the app.
- Chat messages you send inside a lab take the exact same path described above under "Chat
  content and the model proxy (LiteLLM)" — the same edge API, the same LiteLLM proxy, the same
  model providers, and (if self-hosted) your own deployment's instance of each.
- Conversations, plugin/tool selections, and model choice created inside a lab are stored in their
  own isolated browser database, separate from your real TinyTinkerer conversations. Each lab's own
  reset control clears only that isolated data; your real conversations are never read by a lab,
  and a lab is never read by the rest of the app.
- General telemetry (crash reports, request-failure diagnostics) behaves the same inside a lab as
  in the rest of the app, subject to the same opt-in described above.

## Why we collect it

To detect, reproduce, and fix crashes and errors, and to improve reliability and security.

## Anonymous or linked?

Telemetry is pseudonymous by default: events are associated with a random installation ID,
not your identity. When you are signed in and telemetry is enabled, reports may be linked to
your GitHub account so we can follow up on issues.

## Where it is sent

- Chat messages are sent through the TinyTinkerer edge API to the maintainer-operated
  LiteLLM proxy and onward to its configured model providers. LiteLLM receives a
  per-user virtual key tied to your GitHub id/login for budget and rate enforcement.
  See "Chat content and the model proxy (LiteLLM)" above.
- Documentation content selected by the documentation assistant's tools — search excerpts or a
  page it reads — travels the same path, as part of the chat turn that requested it. See
  "Documentation assistant" above.
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

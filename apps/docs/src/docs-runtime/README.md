# The documentation runtime

Where a `BrowserApp` comes from inside `/docs/`, and who owns the document
(issue #479). #480 mounts the widget on top of this; #472 consumes its session.

Two apps live in this document and share nothing but their bootstrap:

|                         | storage namespace             | tools                        | document-global effects |
| ----------------------- | ----------------------------- | ---------------------------- | ----------------------- |
| global assistant        | `tinytinkerer-docs-assistant` | #477's `Documentation` group | all except the head     |
| live labs (one, shared) | `tinytinkerer-docs-lab`       | the tool-picker demo group   | none                    |

The product's own app is a third store again (`tinytinkerer`), untouched by both
and read only for its auth token.

The owner decisions behind every rule below are recorded on
https://github.com/NNTin/tinytinkerer/issues/479.

## Why a separate singleton

`BrowserApp` owns one chat/settings state and one app tool group. Reusing the
live-lab instance would merge conversations and put the documentation tools
inside lab demos; refactoring the runtime into scopes first would have expanded
#471's risk substantially. So the assistant is its own singleton built from the
same `createDocsBrowserApp` bootstrap — same edge config, same read-only product
token, same anonymous shared quota, same sign-in route — and nothing else.

## The shape that follows from one constraint

`BrowserAppShell` renders its boot screen **instead of** its children and wraps
them in `StrictMode` and an error boundary. Hosting the documentation inside it
would blank the page while the assistant booted, double-render the whole site,
and let an assistant error take a docs page down.

So the runtime host is a **sibling** of the page subtree in `@theme/Root`:

```tsx
<DocsPageProvider>
  {children}
  <DocsAssistantRuntimeHost />
</DocsPageProvider>
```

Three consequences worth knowing, because each one is load-bearing:

1. **A page component can never be a React descendant of the provider.** #472's
   Pixel Agents Office therefore becomes one by portal — it registers a
   component and a DOM target through `registerDocsAssistantSurface` /
   `setDocsAssistantSurfaceTarget`, and the host renders it inside the provider,
   portaled into the page. One app, one conversation repository, one query
   client, no remount of anything.
2. **The provider is never added above `children` later.** Doing so would change
   the element tree over the page and remount every documentation page — and any
   live lab running on one — the first time a reader opened the assistant.
3. **The host renders nothing until asked.** `requestDocsAssistantRuntime()`
   moves it from `idle` to `starting`; only then is the runtime chunk fetched.

## Import boundaries

| From                                                  | Import                           | Why                                                |
| ----------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| anywhere, including `@theme/Root` and eager page code | `@site/src/docs-runtime`         | light: no product runtime                          |
| a registered surface only                             | `@site/src/docs-runtime/session` | pulls the runtime, and needs the provider above it |

`useDocsAssistantSession()` throws outside the provider rather than returning an
empty session: a conversation list with nothing behind it is a lie with a
spinner. `ensureDocsAssistantApp` is deliberately not exported from the index —
there is one global assistant store, and no supported way to make a second.

The boundary is enforced twice: at the source, by
`__tests__/static-safety.test.ts`, and in the built output, by
`scripts/check-docs-performance-budget.mjs`, which greps the emitted chunks for a
marker string from `assistant-runtime-client.tsx` and fails if any built page
references that chunk. `@theme/Root` is loaded by every documentation page, so a
static import on the path from it to the runtime would ship app-browser
site-wide — the failure this pair exists to prevent.

## Document ownership

One document, several `BrowserApp`s, and a handful of effects that write to state
there is only one of. Ownership is **structural**, not first-claim and never
transferred: the assistant host exists at `@theme/Root` for the whole
application, so there is no race to win.

The assistant owns the OAuth callback watchdog, telemetry configuration and
install identity, the content-render error reporter, the telemetry-consent
controller, and the consent / privacy-update / Konami hosts. Every live lab
passes `NO_GLOBAL_HOST_CAPABILITIES` and all four `documentGlobals` false.

Neither app touches `document.head`: Docusaurus owns the site's manifest, icons,
and theme colour, and the assistant adds no second managed `theme-color`.

### Telemetry is one setting with one owner

Consent has three writers in app-browser — boot restore, the settings action, and
the Konami preset — and `telemetryEnabled` is persisted **per storage namespace**
while consent itself is module-global. Suppressing `configureTelemetry` alone
would leave a live lab with a stale persisted `true` switching telemetry back on
after the assistant declined it, decided by nothing but boot order.

So a non-owner neither restores nor mutates global consent, and its settings
panel hides the toggle instead of showing a value that no longer controls
anything. This is not a mirror between namespaces: there is one global privacy
setting, and the assistant namespace owns it. A visitor who answered only the old
live-lab prompt may be asked once more under the assistant namespace — an
accepted, privacy-conservative migration cost. Assistant reset preserves consent
precisely so it cannot become a repeating prompt.

`packages/app/app-browser/tests/document-globals-multi-app.test.ts` pins all of
this against the real telemetry module, in both boot orders.

### One consequence to know about

Because the runtime is lazy and ownership is structural, the consent host mounts
when the assistant runtime activates — not when a live lab boots. Telemetry
defaults to off, so "no consent host yet" is the conservative state, but a
visitor who only ever uses a live lab is no longer _offered_ the opt-in on that
page.

### No human-in-the-loop host

`requestHumanInput` is reachable only through the PluginHost, and
`docusaurus.config.ts` aliases plugin discovery to a stub that resolves to no
plugins. No documentation tool requests human input either, so **no HITL prompt
can be raised in the documentation site at all**.

Its queue is module-global with no session identity, so with two apps a prompt
would be drawn using the wrong app's plugin settings and conversation titles.
Mounting a known-misroutable host merely because `BrowserAppShell` used to bundle
it with consent would be the worse answer, so the host is off, and
`__tests__/no-human-prompt.test.ts` fails if either half of the assumption
changes. Session-scoped routing is tracked in #489 and must land before plugin
discovery is ever enabled here.

## Reset

`resetActiveConversation()` cancels that conversation's in-flight work and clears
its transcript. It does not reload the page, delete a database, or touch consent,
authentication input, assistant settings, #480's presentation state, a live lab,
or the product — those live in other stores.

The live labs keep their own reset (`resetDocsLabSession`), which does delete the
lab database and reload: a lab lives inside one page, so restarting that page is
proportionate. A site-wide assistant reloading the documentation out from under a
reader is not. A full "delete all assistant data" would be a separate, explicitly
named operation; `deleteDocsStorageNamespace` is the primitive it would use.

## What is not here

- The floating widget, its overlay, stacking, and route-aware starters (#480).
- The Pixel Agents Office UI (#472) — only the portal it mounts through.
- Any use of the rendered DOM or live-lab state.

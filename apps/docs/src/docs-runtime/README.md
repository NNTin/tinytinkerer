# The documentation runtime

Where a `BrowserApp` comes from inside `/docs/`, who owns the document (issue
#479), and how the floating assistant is mounted on top of it (issue #480). #472
is intended to consume the same session, and has not been built yet — the
contract exists and is tested; nothing imports it.

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

   Placement is **declared**, never inferred from whether a target happens to
   exist: `{ placement: 'portal' }` with no live target renders nothing, and
   `{ placement: 'inline' }` (#480's widget) never consults one. Inferring it
   would have remounted the Office inline at the document root on every route
   that unmounted its sidebar target, losing its state each way. Target state is
   independent of registration, so #472 and #480 may mount in either order.

2. **The provider is never added above `children` later.** Doing so would change
   the element tree over the page and remount every documentation page — and any
   live lab running on one — the first time a reader opened the assistant.
3. **The host renders nothing until asked.** `requestDocsAssistantRuntime()`
   moves it from `idle` to `starting`; only then is the runtime chunk fetched.

## The status says what the session is actually doing

`ready` is published by a component that mounts **inside** `BrowserAppShell`, so
it cannot exist before `initializeBrowserApp` has resolved; a bootstrap rejection
is published as `error` by the boot screen the shell hands it to. Publishing off
the app's _construction_ instead — the first revision — meant a failed auth,
settings or telemetry step left the status saying `ready` with no provider
mounted and no way back, since `activate()` is a no-op from `ready`.

A retry re-imports. `React.lazy` memoises rejection on its payload, so the host
builds a **fresh payload per attempt** (`assistant-runtime-loader.ts` exists so
that import is both replaceable and testable); a single module-level `lazy(...)`
would rethrow the first failure forever while the status advertised a retry.

Post-bootstrap surface failures are caught by an assistant-scoped boundary
**above** the session and below the shell's own `AppErrorBoundary` — near enough
that React reaches it first, so an embedded assistant never renders a full-app
"Something went wrong / Reload page" panel at the root of a documentation page.
The failure becomes `error`, which a launcher can act on.

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

### No human-in-the-loop capability

`requestHumanInput` is reachable only through the PluginHost. Neither
documentation catalogue carries a HITL-capable plugin — choice-prompt and
permissions are excluded deliberately (see `plugin-subsets.ts`) — and no
documentation tool requests human input either, so **no HITL prompt can be raised
in the documentation site at all**.

Both docs apps therefore declare `humanInput: false`. Since #495 that is a
REQUIRED parameter of `createDocsBrowserApp` rather than a value it hardcodes:
the factory builds both documentation apps, so one hardcoded value was a single
switch for both, and there was no way to give the assistant a HITL-capable plugin
without giving every `<LiveLab>` on every page the same capability. That is a single value rather than a pair of
switches (#489 review): the app has no prompt queue, so its runtime advertises no
`requestHumanInput` and no shell mounts a renderer. They cannot be set
inconsistently, which previously would have let a plugin enqueue a prompt that
nothing drew — the run blocking until the ~5-minute human-input budget expired.
`__tests__/no-human-prompt.test.ts` asserts the outcome through the real factory.

The original decision had a second reason — the prompt queue was module-global
with no session identity, so a host here would have drawn a live lab's prompt
using the assistant's plugin settings and conversation titles. #489 fixed that:
the queue is one store per `BrowserApp`, a mounted host can only see its own
app's prompts, and `human-prompt-host-ownership.ts` elects one shell to draw the
modal when an app has several (as the lab app does, one shell per `<LiveLab>`).

Nothing blocks flipping it on any more. #489 made the prompt queue per-app, so a
prompt cannot misroute between the assistant and a lab; #498 — a
`composer`-presented prompt being invisible behind a minimized surface — is fixed,
so a minimized assistant widget is a supported place for a question. Excluding the
HITL plugins is now a scope decision, recorded in `plugin-subsets.ts`, not a
constraint. Enabling one means adding it to that app's catalogue and flipping that
app's `humanInput` — and `__tests__/no-human-prompt.test.ts` fails on both halves
until you do.

## Reset

`resetActiveConversation()` aborts that conversation's in-flight run, discards it,
and creates and selects a fresh one — decision 5's locked semantics, implemented
as one store action (`restartConversationAction`) rather than delete-then-create
at the call site: deleting the ACTIVE conversation already selects the most
recent remaining one, so composing the two would flash somebody else's
conversation between the awaits and could leave two new ones behind.

Other assistant conversations survive. It does not reload the page, delete a
database, or touch consent,
authentication input, assistant settings, #480's presentation state, a live lab,
or the product — those live in other stores.

The live labs keep their own reset (`resetDocsLabSession`), which does delete the
lab database and reload: a lab lives inside one page, so restarting that page is
proportionate. A site-wide assistant reloading the documentation out from under a
reader is not. A full "delete all assistant data" would be a separate, explicitly
named operation; `deleteDocsStorageNamespace` is the primitive it would use.

## The floating widget (#480)

The real `ChatApp` against this session — **morphable** (the default), registered
as an `inline` surface, and therefore a child of the Root-mounted host. Nothing
about that subtree is remounted by a route change, which is the whole mechanism
behind "the conversation, the draft and any in-flight run survive navigation".

Morphable, not pinned: a reader can dock the widget into the same web-mode
sidebar `/ide` and `/canvas` dock, and undock it again. #480 originally locked
`morphable={false}`, and its re-review reversed that — a docs-only, dock-less
variant is a reimplementation rather than a composition. Both layouts are fully
controlled from `assistant-presentation.ts`, and morphing swaps the layout
wrapper only, so a run in flight survives a dock exactly as it does on `/widget`.

### Two launchers, one at a time

The runtime is lazy, so `app-browser`'s own minimized launcher lives inside a
chunk that has not been downloaded yet. The launcher on a cold `/docs/` page is
therefore the documentation's own light control (`AssistantLauncher.tsx`), and
the rule that keeps them from ever both being interactive is simply the status:

| status                        | what is interactive                            |
| ----------------------------- | ---------------------------------------------- |
| `idle` / `starting` / `error` | the light launcher (busy, or offering a retry) |
| `ready`                       | `ChatApp`'s panel and its own launcher         |

It reports `aria-busy` rather than going `disabled` while the chunk loads: a
disabled button leaves the tab order and stops being announced, so a keyboard
reader who pressed it would lose the element mid-flow. A failed start returns
focus to it, because that is where the retry is.

### Presentation state has one owner

`assistant-presentation.ts` — a versioned record in `localStorage`, separate from
the IndexedDB conversations, so resetting one cannot disturb the other.

The RULES are the product's. The mode union, the record's shape and parser, the
transitions and the store all come from
`@tinytinkerer/app-browser/chat-presentation`, which `ChatApp` uses too; this
module supplies the key and one ephemeral `focusPanelOnMount` flag. Before that
split the documentation carried a second, independently-written presentation
state machine — the debt #482 exists to remove, reintroduced.

`ChatApp` and `FloatingLayout` also persist presentation of their own, which
would be a second authority written by components that only exist _after_ the
decision was made. So the widget uses their **controlled** mode (#480 added it,
and its re-review extended it to `mode`): this store owns mode and
open/minimized, the layouts own geometry. A callback-only seam was rejected — the
two desynchronise the moment anything but the launcher opens the assistant, which
is exactly what #472 will do when it activates the runtime while the reader had the
widget minimized.

**A returning reader who left the panel open gets it back**, runtime download
included. "Retains the presentation state" cannot mean "restores everything
except the state the reader actually chose". That gives `/docs/` two load
profiles for #481 to budget separately: new-or-minimized (no runtime chunk, the
shape `check-docs-performance-budget.mjs` enforces) and returning-open.

### The stacking contract

| band | who                                                               |
| ---- | ----------------------------------------------------------------- |
| ~200 | ordinary fixed Docusaurus chrome (sticky navbar, mobile drawer)   |
| ~300 | `.docs-assistant-root` — launcher, panel, consent/privacy dialogs |
| ~400 | overlays that own the viewport, including fullscreen labs         |

One stacking context for the whole assistant, established with `isolation` on
that root. app-browser's dialogs carry `z-index: 60`/`70` of their own, which is
meaningless against Infima's 200-level navbar; contained here they only order
themselves against each other. `isolation` specifically, never `transform`,
`filter`, `contain` or `will-change` — each of those would additionally
re-anchor the `position: fixed` dialogs to the root instead of the viewport.

The root is `position: fixed` and click-through, so it adds no page height and
intercepts nothing outside the launcher and panel. `.widget-stage`'s own
`min-height: 100vh` is overridden for the same reason apps/host and
`@tinytinkerer/app-shell` override it for their compositions.

While a fullscreen lab, the mobile drawer, or the search dropdown is open the
widget is `inert` and hidden — but still **mounted**, with its persisted state
untouched. Detection is by named overlays (`host-overlays.ts`): documentation-owned
ones declare themselves, Docusaurus-owned ones are matched on published contracts
(Infima's `navbar-sidebar--show`, the search combobox's `aria-expanded`) rather
than hashed CSS-module names. A generic "any open `aria-modal`" rule was rejected
because it would hide the assistant when its _own_ consent dialog opened.

### Route-aware starters

The widget reads `useDocsPageContext()` itself. It has to: `Root` has no hooks, so
the host's element keeps its identity across navigation and React bails out of
re-rendering it — only a component that consumes the context sees a route change.

Current-page suggestions appear only where #476 reports an authored document
(including the authored landing page and a direct visit to an unlisted one).
Search, 404, generated category indexes, and any corpus-pending or corpus-failed
state get the route-neutral list, because a "Summarize this page" that
`read_current_doc` would refuse is worse than no suggestion at all. Suggestions
**fill** the composer; they never send, so a reader keeps the chance to edit.

### The current page is pinned to the run

`read_current_doc` executes long after the reader hit send, and it used to resolve
against #476's live snapshot. #476 already pinned the answer to the route a tool
CALL was made on; the widget widened what that leaves open, because a reader can
now ask "summarize this page" and keep reading while the model decides. The run
survived the navigation — and answered about the page they drifted to.

So the `Documentation` group declares ONE catalogue and binds a per-run
implementation for `read_current_doc` alone, through `AppToolGroup.bindRun`
(called once per run, where `createRuntime` already knows the conversation). A
binding may replace a declared tool's body and nothing else, so its id, schemas,
description and summarizer cannot differ from what the reader selected in the
picker — the drift a build-it-twice seam left expressible (#480 re-review,
finding 1).

What the run captures is the ROUTE, not a resolution: a run submitted while the
corpus manifest was still loading has nothing resolved to hold on to, and that
route is then resolved through whatever corpus exists when the tool actually
runs, with all of #476's waiting and retrying.

### What #480 added to `app-browser`

Additive seams, every default preserving every existing surface: controlled
minimization and mode plus their `onChange`s, a dynamic starter-prompt override
and count, a host-provided `signIn`, a `conversationReset` behaviour, an app-level
`toolTreeSummarizer`, and `AppToolGroup.bindRun`. Its re-review added four
product-owned artifacts an embedder shares rather than reimplements: the
`chat-presentation` contract, the generated scoped preflight
(`embed.css`/`scripts/generate-embed-preflight.mjs`), the `tt-embed-launcher`
chrome primitive, and the derived token graph (`token-graph.css`). Preferred over
docs-owned imitations, which is what #482 exists to clean up.

`toolTreeSummarizer` is the one worth knowing about, because forgetting it is
INVISIBLE: `ToolTreeSlot` renders nothing without a summarizer, so an app with a
perfectly good tool group looks exactly like an app with no tools. That is how the
widget first shipped — the three documentation tools registered, selectable in
principle, and unreachable. `createDocsBrowserApp` now sets it for any docs app
that has a tool group, so no docs surface can repeat it.

The last two close real defects rather than adding options. Docs shells run
`authMode: 'host-token'` and can never start OAuth, so the settings panel offered
sign-in above no button at all; the assistant now supplies
`beginDocsProductSignIn`, and a deployment that cannot start one says so instead
of doing nothing. And the widget's reset reached the store's clear-in-place
action, which keeps the conversation's id and title — not the semantics #479
locked and this session documents.

## The release gates (#481)

### No content reaches a model before the reader is told what a send does

The assistant declares a `preSendDisclosure` on its `BrowserApp`, and every
prompt send passes one coordinator, `requestOutboundSendApproval`.

Scope, stated precisely because the first revision overstated it: this gates
conversation and tool content on its way to a **model**. It is not a network
kill switch. A documentation page still fetches the corpus manifest, activating
the assistant still downloads its chunk, and the shell may still ask the edge
which models exist — none of which carry content, and none of which reach a
model.

**The gate is in `chat-store`'s `sendPrompt`**, not in the composer. That
distinction is the whole correctness of it: "the composer checks the gate" is not
the same claim as "this app cannot send unacknowledged", and the first revision
only had the former. `rerunLastPrompt` reaches `sendPrompt` directly, so
**Regenerate sent a whole persisted conversation past a disclosure the reader had
never seen** — and #472 would have added a third such path. Gating the call every
send shares closes the class, not the instance.

The composer consults the same coordinator as well, for one reason the store-level
check cannot cover: **clear-on-accept**. If the composer cleared first and the
reader then declined, their question would be gone. So `submitPrompt` reports
`sent | held | refused`, a held attempt keeps the input, and the held attempt's own
promise carries both the send and the clear. Consulting twice is free — after the
first acknowledgement the gate is satisfied, so the second consult resolves
immediately and no second dialog appears.

`held` carries a `requestId` and a decision, rather than the composer comparing
its own prompt text against shared gate state. Two surfaces submitting identical
words used to be able to resume each other's attempt.

Three things it deliberately is **not**:

- **not the telemetry consent dialog.** That asks for an opt-in which defaults
  off and can be declined while the app keeps working. A data-flow disclosure is
  not a choice, so "Continue without" would have meant something false.
- **not per-surface.** The floating widget, the docked panel and #472's future Office
  are covered because the gate is on the app, not because three components
  remembered.
- **not the human-in-the-loop bridge.** A human prompt is run-scoped — it belongs
  to one conversation, and stopping that run settles it. This is a persisted,
  versioned send-admission policy that outlives every run, so a Stop must never
  be able to un-ask it.

Its dialog links to the full policy, which opens **over** it. That stacking is
handled once, in `use-dialog-focus.ts`: only the topmost dialog traps focus and
answers Escape, and the one beneath is `inert`. Without it, one Escape closed
both — taking the reader's unsent message with it.

The acknowledgement is versioned (`assistant-disclosure.ts`) and persisted in
**this app's** preferences namespace, separately from telemetry consent and from
the global privacy-policy acknowledgement. None of the three substitutes for
another. The same paragraphs render permanently in Settings → Privacy, because a
disclosure a reader meets once, while trying to do something else, is not one
they can return to.

`docs/overview/PRIVACY.md` carries the full version; editing it bumps
`PRIVACY_POLICY_VERSION` and re-prompts returning **product** users, which is the
accepted cost of a material data-flow clarification.

### Four load profiles, one table

`config/docs-performance-budget.json` — read by both
`scripts/check-docs-performance-budget.mjs` (what a built artifact weighs) and
`packages/e2e/tests/docs/assistant-performance.e2e.ts` (when a browser fetches
it). Two tables would drift, and the sequencing half is the one that would
quietly stop matching reality.

| profile | what it costs                                  |
| ------- | ---------------------------------------------- |
| 1       | page + launcher + the corpus **manifest**      |
| 2       | opening the assistant: the runtime chunk graph |
| 3       | one selected document artifact                 |
| 4       | the Lunr index and its worker                  |

The manifest sits at profile 1, not 3. `DocsPageProvider` loads it on every
route so a navigation into a document resolves immediately instead of opening a
fresh `corpus_pending` window at exactly the moment a reader is most likely to
ask something — #474's and #476's design. #481's own text placed it at the first
read; that wording predates what shipped, and the deviation is recorded
retrospectively at
https://github.com/NNTin/tinytinkerer/issues/481#issuecomment-5160246806.

That link is a correction, not a formality. This sentence used to claim the
reconciliation "is recorded on the issue"; it was not — #481 carried no comment
at all, unlike every other #471 child, and its issue body still described profile
3 (issue #482). Two deviations went the same way: this one, and the pre-send
disclosure being an app-scoped host rather than the reuse of #479's
`globalHosts` that #481's text asked for. Both are right, and both are now
written down where somebody reading the issue will find them.

The search profile doubles as the production-build smoke check: the upstream
plugin writes `search-index.json` only from `postBuild`, so a build that stopped
emitting it would leave the deployed assistant reporting search as permanently
unavailable while every unit test stayed green.

### CI cannot spend quota, and cannot forget to not spend it

`packages/e2e/fixtures/no-live-quota.ts`, installed from `playwright.config.ts`
at module scope, refuses any non-local `fetch` in every Playwright process. It is
worth being precise that the suite does not "stub auth and quota": `/api/**` runs
through the **real** edge worker in-process, anonymously, with rate limiting
off, and only the outbound LiteLLM call is replaced. That held only while every
spec remembered to install a mock; now a spec that forgets fails loudly.

What that cannot cover — a real provider response, real streaming, a real OAuth
round trip, a real rate limit — is
[`docs/contributing/staging-smoke-checklist.md`](../../../../docs/contributing/staging-smoke-checklist.md).

### Rollback

`TINYTINKERER_DOCS_ASSISTANT=off` plus a rebuild. `@theme/Root` then renders
ordinary Docusaurus children: nothing mounts, nothing requests the corpus, and
no launcher renders. Build-configured deliberately — a runtime switch cannot
help the case that motivates a rollback, since every reader is affected and none
of them will set a flag.

**It is a behavioural disable, not dead-code elimination.** The light assistant
modules are still compiled into Docusaurus' shared bundle (`Root` imports them
unconditionally and branches at render time), so a rolled-back build is the same
size as a normal one — measured: `coldPage` is byte-identical at 843,003 — and
the corpus artifacts and search index are still emitted, just never fetched.

That is the right trade for an emergency control. Eliminating the code would
need a second compile path whose output nobody routinely builds or tests, which
is the wrong thing to reach for during an incident; it would also break
`check-docs-performance-budget.mjs`, which requires the assistant runtime chunk
to exist. If a bundle-size rollback ever becomes the actual requirement, that is
a separate change.

Live labs are untouched; they boot from `live-lab/client-runtime.tsx`, which the
flag does not reach. The consequence is that nothing then owns the docs-wide
telemetry-consent or privacy-update hosts. That is acceptable for an **emergency**
rollback precisely because telemetry defaults to off — "no consent host" means
"no telemetry", not undisclosed collection.

Stated plainly because it is the sort of thing that quietly becomes permanent:
assistant-off is a rollback state, **not a supported permanent product
configuration** (issue #482). A deployment that intends to run that way
indefinitely needs a global privacy owner that does not depend on the assistant,
and that has not been designed.

## The audit (#482)

The cross-issue review. Most of what it found is recorded on the issues rather
than here; three things changed the code, and each removed a claim that was not
true.

**The bundle boundary is derived, not listed.** `__tests__/static-safety.test.ts`
used to assert its rule against a hand-written array of light modules. By the
time it was audited that array had drifted both ways at once —
`AssistantPageRegion.tsx` and `LatchedErrorBoundary.tsx` were reachable from
`@theme/Root` and missing from it — so it walks the value-import graph from the
declared eager roots now (`__tests__/eager-module-graph.ts`, a TypeScript AST
walk that stops at every dynamic `import()`). Adding a module to the eager path
brings it under the rule automatically. It also surfaced a second certified
subpath nobody had noticed the page was pulling: `documentation-corpus`, which
`DocsPageProvider` reaches on every route and which re-exports contracts only.

**`read_dom` is excluded on purpose, not by accident.** Nothing in the
documentation can read the rendered page. The reason USED to be that plugin
discovery resolved to nothing — a build-configuration fact that #495 has since
removed — so the exclusion is asserted as an outcome instead. `__tests__/no-dom-access.test.ts`
covers the source side — the assistant registers those three tools and no other,
and the alias that installs the empty registry is still there — and
`assistant-no-dom-access.e2e.ts` covers the **deployed catalogue**, through
Settings → Plugins, including with the plugin pre-enabled in the app's own
preferences.

That last part is the one worth knowing about: the tool PICKER is the wrong place
to assert this, because it lists only _enabled_ plugins and Browser state ships
disabled. A catalogue that wrongly included it would show nothing in the picker
and let a reader switch it on in Settings anyway. No denylist and no second
catalogue was invented: #482 stated the requirement and #495 satisfied it, by
naming what each documentation app carries in `plugin-subsets.ts` and asserting
the exclusion against those real lists.

**The public surface is what someone imports.** `index.ts` carried the storage
namespace, an imperative status reader, and per-axis presentation mutators — none
with a consumer, and none named in what #472 was told to use. They are gone,
along with `setDocsAssistantMinimized`/`setDocsAssistantMode` themselves, which
had had no caller since the widget became fully controlled by
`setDocsAssistantPresentation`.

Cross-engine coverage is the other change, and it is a narrow one:
`packages/e2e/tests/docs/assistant-cross-engine.e2e.ts` runs three flows on
Chromium, Firefox and WebKit — one each for `inert`, `isolation: isolate`, and
the CSS custom property the page insets on, which are the parts of #480 an
engine could plausibly differ on. Everything exhaustive stays on Chromium.

## What is not here

- The Pixel Agents Office UI (#472) — only the portal it mounts through.
- Any use of the rendered DOM or live-lab state.
- Human-in-the-loop in the documentation. Both catalogues exclude choice-prompt
  and permissions and both apps declare `humanInput: false` — a scope decision
  since #489 and #498 removed the two things that made it a constraint. See
  `plugin-subsets.ts`.
- Any plugin beyond the approved catalogues, in particular `read_dom` (excluded
  permanently) and Web search (excluded so no documentation answer can come from
  the open web).

---
title: Staging live-call smoke checklist
sidebar_position: 3
---

# Staging live-call smoke checklist

CI never makes a genuine live model or edge call against `/docs`. Every Playwright spec under
`packages/e2e/tests/docs/` installs `fixtures/mock-litellm.ts`'s in-process LiteLLM mock before
touching a lab or the assistant, and `fixtures/no-live-quota.ts` — installed from
`playwright.config.ts` in every Playwright process — refuses any non-local request outright, so a
spec that forgets a mock fails loudly instead of quietly spending somebody's quota.

Worth being precise about what that does and does not stub: `/api/**` runs through the **real**
edge worker in-process, anonymously, with rate limiting disabled. Only the edge's outbound LiteLLM
call is replaced. So CI covers the edge's own behaviour, and covers nothing about a real provider —
a genuine provider-shaped response, real latency and streaming, a real GitHub OAuth round trip, or
a real rate limit. Run this checklist by hand, against a real deployment, whenever a change touches:

- `apps/docs/src/live-lab/**` (the session bridge, any lab's `*Content` component)
- `apps/docs/src/docs-runtime/**`, `docs-tools/**`, `docs-search/**`, `docs-corpus/**`, or
  `docs-assistant/**` (the documentation assistant)
- `apps/docs/src/playground/client-runtime.tsx`
- anything in `apps/edge` or `packages/app/app-browser` that a lab or the assistant depends on

## Where to run it

- **A PR preview** (`https://pr-<number>-<branch>.tiny.preview.nntin.xyz/docs/`, linked in the
  PR's Vercel Preview comment) — reuses the **develop** edge, so this is real end-to-end coverage,
  not just a docs-only build.
- **Develop** (`https://dev.tiny.nntin.xyz/docs/`) — after merge, as a final check before promoting
  to `main`.

Both point at a real Cloudflare edge Worker and a real LiteLLM instance (see
[Vercel deployment](../self-hosting/vercel-deployment.md) for the full tier breakdown) — no local
setup needed.

## Checklist: the documentation assistant

Run this in a **fresh browser profile** (or a private window), because the first two steps are
one-time and cannot be repeated in a session that has already answered them.

- Open any `/docs/` page **signed out** and confirm the launcher is there and the page is otherwise
  untouched — no layout shift, no covered navbar.
- Open the assistant and type a question, then press send. Confirm the **pre-send disclosure**
  appears before anything is sent, that "Not now" leaves your question in the composer, and that
  "Read the privacy policy" opens the real policy.
- Acknowledge it and confirm the message goes through anonymously and a **real** answer streams
  back. This is the shared-quota path — no sign-in required.
- Send a second message and confirm the disclosure does **not** reappear.
- On an authored documentation page, ask "summarize this page". Confirm the activity shows a
  `read_current_doc` call and the answer is genuinely about that page.
- Ask something that needs another page ("where can I find the plugin documentation?"). Confirm a
  `search_docs` and/or `read_doc` call, and that the answer carries a **clickable citation** that
  lands on the right documentation page — following it must not lose the assistant panel.
- Sign in from the assistant's GitHub control. Confirm it round-trips back to the docs page you
  started from, that the conversation survives the round trip, and that a message now runs under
  your own account.
- Open Settings → Privacy inside the assistant and confirm the disclosure summary is still there.
- Reset the conversation from the widget. Confirm a fresh conversation starts, the page does **not**
  reload, and your **product** conversations (open TinyTinkerer itself in the same browser) are
  untouched.
- Keep sending until you hit the shared key's cooldown, and confirm the rate-limited state renders
  sensibly. This is the one state the mocked suite cannot reproduce.

## Checklist: interactive live labs

For each lab touched by the change (`Try Pixel Agents`, the execution trace lab, the plugin &
tool-picker lab):

- Load the lab **signed out**. Confirm the non-blocking sign-in notice renders and the lab is
  still fully usable anonymously (send a real message, get a real reply).
- Sign in with a real GitHub account via the lab's "Sign in with GitHub" link. Confirm it
  round-trips back to the exact docs page you started from, the signed-out notice disappears, and
  a message now runs under your own account.
- Send at least one real message that exercises a tool call (the plugin & tool-picker lab's demo
  tools, or a prompt that triggers one) and confirm the execution trace / activity status reflects
  a genuine run, not a canned fixture.
- Click "Reset this lab". Confirm your **product** conversations/settings/token (outside the docs
  lab) are completely unaffected — open the product itself (the preview's `Open TinyTinkerer`
  link) in the same browser and confirm nothing there changed.
- Watch for a real rate-limit: send enough messages to hit the shared key's cooldown and confirm
  the lab's rate-limited state renders sensibly (this is the one state the mocked e2e suite cannot
  reproduce, since its mock never actually throttles).

## If something only breaks here

File it against the lab's own tracking issue, not this checklist's issue — this page exists so the
gap between "CI is green" and "the real thing works" has an owner and a known procedure, not to
turn into a second place bugs get triaged.

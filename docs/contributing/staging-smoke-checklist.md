---
title: Staging live-call smoke checklist
sidebar_position: 3
---

# Staging live-call smoke checklist

CI never makes a genuine live model or edge call against `/docs`: every Playwright spec under
`packages/e2e/tests/docs/` installs `fixtures/mock-litellm.ts`'s in-process LiteLLM mock before
touching a lab, and the accessibility/navigation specs never send a chat message at all. That is
deliberate — a docs PR must never consume real model quota just because CI ran — but it also means
CI cannot catch a regression that only shows up against the **real** edge/LiteLLM (a genuine
provider-shaped response, real latency/streaming behavior, a real GitHub OAuth round trip). Run
this checklist by hand, against a real deployment, whenever a change touches:

- `apps/docs/src/live-lab/**` (the session bridge, any lab's `*Content` component)
- `apps/docs/src/playground/client-runtime.tsx`
- anything in `apps/edge` or `packages/app/app-browser` that a lab depends on

## Where to run it

- **A PR preview** (`https://pr-<number>-<branch>.tiny.preview.nntin.xyz/docs/`, linked in the
  PR's Vercel Preview comment) — reuses the **develop** edge, so this is real end-to-end coverage,
  not just a docs-only build.
- **Develop** (`https://dev.tiny.nntin.xyz/docs/`) — after merge, as a final check before promoting
  to `main`.

Both point at a real Cloudflare edge Worker and a real LiteLLM instance (see
[Vercel deployment](../self-hosting/vercel-deployment.md) for the full tier breakdown) — no local
setup needed.

## Checklist

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

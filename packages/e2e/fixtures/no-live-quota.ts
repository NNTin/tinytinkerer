/**
 * The fail-closed guarantee that CI cannot spend real model quota (issue #481).
 *
 * ## What was actually true before this, and why it needed saying
 *
 * #481's acceptance criterion says "normal CI uses model/auth/quota stubs". The
 * suite does not literally do that, and the difference matters: `/api/**` is
 * piped through the **real** edge worker in-process (`mock-litellm.ts`'s
 * `pipeToEdge`), running anonymously with rate limiting disabled, and only the
 * edge's outbound LiteLLM call is replaced. Nothing about a real backend is
 * stubbed — it is simply never reached, because the configured upstream host does
 * not resolve.
 *
 * That held only as long as every spec remembered to install a mock. A spec that
 * forgot, or a future one that opened the assistant and sent a message without
 * one, would have had the in-process edge dial whatever `LITELLM_BASE_URL` said
 * with whatever credentials the environment held. Nothing would have failed
 * loudly; it would just have worked, and spent somebody's quota.
 *
 * ## The guard
 *
 * Installed from `playwright.config.ts` at module scope. It wraps Node's `fetch`
 * — the only path an in-process edge has to the outside world — and REFUSES any
 * request that is not local. The failure names the offending URL and says what to
 * do about it.
 *
 * `mock-litellm.ts` patches `fetch` too, and falls through to whatever it found
 * for anything that is not its mock upstream. Because this runs first, that
 * fall-through lands here: a mocked spec is unaffected, an unmocked one is
 * stopped. Ordering is the whole mechanism, which is why a spec does not get to
 * opt in.
 *
 * From the CONFIG specifically, not from `globalSetup`: Playwright runs global
 * setup in its own process, so a `fetch` patched there would never be the one a
 * worker uses. The config is re-evaluated in every Playwright process — the same
 * property the shard-tagging reporter option below it already relies on — which
 * makes it the one module guaranteed to have run in the process that serves the
 * edge.
 *
 * ## What is deliberately still allowed
 *
 * `localhost`/`127.0.0.1` — the preview server the suite serves the built site
 * from — and the mock LiteLLM host, which resolves nowhere and is answered
 * in-process. Everything else is refused, including `api.github.com`: the docs
 * lab fixture patches that URL itself for its seeded-token tests, and a request
 * that reaches this guard instead means the patch is missing.
 */

const ALLOWED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
  // The never-resolvable upstream `mock-litellm.ts` answers in-process. Listed
  // so a mocked request that somehow reaches this guard reports as a mock
  // ordering problem rather than as an exfiltration attempt.
  'litellm.mock'
])

const isLocal = (url: string): boolean => {
  try {
    return ALLOWED_HOSTNAMES.has(new URL(url).hostname)
  } catch {
    // A relative or otherwise unparseable URL cannot leave the machine.
    return true
  }
}

let installed = false

export const installNoLiveQuotaGuard = (): void => {
  if (installed) return
  installed = true
  const realFetch = globalThis.fetch
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (isLocal(url)) return realFetch(input, init)
    return Promise.reject(
      new Error(
        `Blocked a non-local request from the e2e suite: ${url}\n\n` +
          `CI must never reach a real model, edge, or GitHub API — it would spend shared or ` +
          `user quota, and its result would depend on a live service. Install the appropriate ` +
          `mock in this spec (fixtures/mock-litellm.ts's installChatMock / installAppToolMock, ` +
          `or fixtures/docs-lab.ts's seeded-token helper) before the code under test sends ` +
          `anything. See fixtures/no-live-quota.ts.`
      )
    )
  }
}

#!/usr/bin/env node
// Deterministic connection constants for the Sentry MCP.
// The MCP tools need `organizationSlug` + `regionUrl` on (nearly) every call.
// Guessing them wastes a round-trip (e.g. org is NOT "tinytinkerer" -> 404).
// Run this to get the exact params; never hardcode them from memory elsewhere.

const CONTEXT = {
  organizationSlug: "nntin-labs",
  regionUrl: "https://de.sentry.io",
  webUrl: "https://nntin-labs.sentry.io",
  projects: {
    edge: {
      slug: "tinytinkerer-edge",
      platform: "Hono API on Cloudflare Workers (api.tiny.nntin.xyz, /api/*)",
      sourceRoot: "apps/edge/src/ (routes/*.ts call upstreams via lib/fetch.ts fetchWithTimeout)",
      what: "Backend API. Unhandled crashes surface via Hono's error handler as handled:no.",
    },
    frontend: {
      slug: "tinytinkerer-frontend",
      platform: "javascript (browser) — web/widget/mobile, deployed on Vercel",
      sourceRoot: "packages/app/app-browser/src/ (request-telemetry engine: packages/shared/sentry-telemetry/src/)",
      what: "HTTP failures surface via request-telemetry.ts (fetchWithTelemetry) as handled:yes.",
    },
  },
  // Releases are git short SHAs.
  // NOTE: event `environment` TAG is `production`; the release Last-Deploy
  // environment label is `vercel-production`. Filter issues with
  // `environment:production`; identify the live release via the vercel-production deploy.
  productionEnvironment: "vercel-production",
  eventEnvironmentTag: "production",
  // To find the live release at runtime: find_releases({organizationSlug, regionUrl, projectSlug})
  // and take the most recent whose Last Deploy environment === productionEnvironment.

  // Multi-environment topology (see docs/vercel-deployment.md §7 and
  // workflows/triage-by-environment.md). The two projects DO NOT share the same
  // environment set — segment by the `environment` tag before triaging.
  environments: {
    // Frontend has FOUR; each maps to a deploy tier.
    frontend: ["production", "develop", "pr-preview", "development"],
    // Edge has only TWO — each worker tags by which worker served the request.
    // PR-preview frontend traffic reuses the DEVELOP edge, so its edge events
    // are tagged `develop`, NOT `pr-preview`.
    edge: ["production", "develop"],
    // `development` = localhost (default when VITE_SENTRY_ENVIRONMENT unset).
    // The frontend NO LONGER initializes Sentry for `development` (telemetry.ts
    // ensureSentry gate) — so new localhost/E2E events should stop appearing.
    noise: ["development", "pr-preview"],
    // Production errors are the priority. An edge error from PR-preview traffic
    // shows under `develop`. Correlate cross-project via the shared 7-char SHA release.
    productionFilter: "environment:production",
  },
};

console.log(JSON.stringify(CONTEXT, null, 2));

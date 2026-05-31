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
      what: "Backend API. Unhandled crashes surface via Hono's error handler as handled:no.",
    },
    frontend: {
      slug: "tinytinkerer-frontend",
      platform: "javascript (browser) — web/widget/mobile, deployed on Vercel",
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
};

console.log(JSON.stringify(CONTEXT, null, 2));

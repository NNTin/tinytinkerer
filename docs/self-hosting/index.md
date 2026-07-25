---
id: index
title: Self-Hosting
sidebar_label: Self-Hosting
description: Start here if you want to run your own TinyTinkerer instance.
---

# Self-Hosting

This section is for **builders** running their own TinyTinkerer deployment: the hosted frontend,
the edge API, and the model proxy it depends on.

## Start here

- [Vercel deployment guide](./vercel-deployment.md) — the full hosted setup: Vercel frontend,
  Cloudflare Workers edge, GitHub OAuth sign-in, and GitHub Actions deploys.
- [LiteLLM setup guide](./litellm-setup.md) — hosting the LiteLLM proxy the edge forwards every
  chat completion to, and how anonymous vs. GitHub-authenticated keys are provisioned.

## Interactive docs labs run against your deployment too

The documentation site's interactive live labs (the tool-picker, execution-trace, and Pixel Agents
labs) are served from the same origin as the rest of your deployment, so once you self-host, they
contact **your** edge and **your** LiteLLM instance — not the upstream maintainer's — exactly like
every other part of the app. See [Interactive live labs](../extending/interactive-labs.md) for how
isolation works and [Privacy & Telemetry](../overview/PRIVACY.md#interactive-documentation-labs)
for what a lab does and doesn't share.

## Next step

Read [Architecture](../architecture/ARCHITECTURE.md) first if you want to understand how the pieces you're
deploying fit together before you provision them.

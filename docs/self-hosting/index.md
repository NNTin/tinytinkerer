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

## Next step

Read [Architecture](../architecture/ARCHITECTURE.md) first if you want to understand how the pieces you're
deploying fit together before you provision them.

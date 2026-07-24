---
id: index
title: Overview & Evaluation
sidebar_label: Overview
description: Start here if you are deciding whether TinyTinkerer fits your use case.
---

# Overview & Evaluation

This section is for **evaluators** — anyone deciding whether TinyTinkerer fits their use case,
before writing any code or standing up a deployment.

## What TinyTinkerer is

TinyTinkerer is a Rube Goldberg machine for human-computer conversation: a chat product built
around one shared runtime that also hosts integrated application workspaces — Canvas, an IDE,
Mermaid diagramming, and Pixel Agents — inside the same session. Capabilities extend through:

- **Plugins** that add tools to the agent runtime (web search, code execution, browser-state
  reading, human-in-the-loop prompts, and more) — see [Plugins & Tools](../plugins-and-tools/index.md).
- **MCP servers** that users register per-account to bring their own remote tools.
- **A single LiteLLM-backed model provider**, so any model the proxy exposes is available without
  code changes.

## Before you evaluate further

- [Privacy & Telemetry](./PRIVACY.md) — what data leaves the machine, when, and who can see it.
- [Open TinyTinkerer](pathname:///) — try the running product directly.

## Next step

Once you know TinyTinkerer fits, continue to [Using TinyTinkerer](../using-tinytinkerer/index.md)
to learn the product surface, or jump straight to [Self-Hosting](../self-hosting/index.md) if
you already plan to run your own instance.

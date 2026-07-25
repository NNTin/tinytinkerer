---
id: index
title: Extending the Content & Runtime
sidebar_label: Extending
description: Start here if you want to add a renderer or a new application workspace.
---

# Extending the Content & Runtime

This section is for **builders** who want to extend how the assistant renders content, or add a
new integrated application workspace alongside Canvas, the IDE, Mermaid, and Pixel Agents.

## Start here

- [Content platform](./content-platform.md) — the shared assistant-content architecture: parsing,
  rendering, specialized renderer packages, and fallback behavior.
- [Integrated application shells](./app-shell.md) — the stage/controller/dock contract that Canvas,
  IDE, Mermaid, and Pixel Agents implement, and the ownership boundary between `apps/<app>` and
  `packages/app/<app>`.
- [Interactive live labs](./interactive-labs.md) — the MDX framework for embedding a live,
  working TinyTinkerer demo directly in a docs page.

## Next step

See [Architecture](../architecture/ARCHITECTURE.md) for the monorepo-wide layering and dependency rules
these extension points sit inside, or [Plugins & Tools](../plugins-and-tools/index.md) if what
you're building is a model-facing tool rather than a renderer or app shell.

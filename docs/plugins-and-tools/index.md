---
id: index
title: Plugins & Tools
sidebar_label: Plugins & Tools
description: Start here if you want to add a tool the assistant can call.
---

# Plugins & Tools

This section is for **builders** who want to give the assistant a new capability — either by
writing a plugin that ships with the runtime, or by pointing users at an external MCP server.

## Start here

- **Concept & reference:** [Plugin infrastructure](./plugin-infrastructure.md) — the plugin
  contract, discovery, and how the nine shipped plugins (web search, code execution, browser
  state, feedback, and more) are built.
- **Tutorial:** [Build a plugin](./build-a-plugin.md) — give the assistant one new tool, end to
  end, in under a page.
- **Concept & reference:** [MCP integration](./mcp-integration.md) — how per-user remote MCP
  servers are registered, discovered, and exposed to the assistant (includes its own worked
  example).
- **Live lab:** [Plugin & tool-picker impact lab](./plugin-tool-picker-lab.mdx) — try the real
  tool-tree picker live, right in these docs.

## Next step

Plugins that render custom assistant content should also read
[Extending the Content & Runtime](../extending/index.md). For the package boundaries a plugin must
respect, see [Architecture](../architecture/ARCHITECTURE.md).

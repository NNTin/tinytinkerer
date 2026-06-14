import {
  createChatRuntime,
  isRuntimeTimeoutError,
  PluginRegistry,
  resolveActivePluginIds,
  type AgentHookContribution,
  type PluginEdgeFetch,
  type PluginHost,
  type PluginModule,
  type Tool
} from '@tinytinkerer/app-core'
import type {
  AgentType,
  McpDiscoveryResult,
  McpServerConfig,
  PluginActivationState
} from '@tinytinkerer/contracts'
import { LiteLLMProvider } from './litellm-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch } from './edge-fetch'
import { createMcpTool } from './mcp-tool'
import {
  captureTelemetryException,
  captureTelemetryMessage,
  fingerprintMessage
} from '../telemetry/telemetry'
import {
  parseJsonWithTelemetry,
  type RequestTelemetryMetadata
} from '../telemetry/request-telemetry'
import { requestPermission } from '../permission-service'

// Stable id of the web-search plugin (packages/plugins/plugin-web-search). Kept
// as a local copy because app-browser must never statically import a concrete
// plugin package — plugins are discovered dynamically. The web-search plugin is
// gated by the host's existing `searchEnabled` readiness machinery (not the
// generic plugin-activation toggles), so this layer activates it explicitly.
const WEB_SEARCH_PLUGIN_ID = 'web-search'

export type BrowserPluginRuntime = {
  registry: PluginRegistry
  modulesById: ReadonlyMap<string, PluginModule>
}

export const createPluginRuntime = (
  pluginModules: readonly PluginModule[] = []
): BrowserPluginRuntime => {
  const registry = new PluginRegistry()
  const modulesById = new Map<string, PluginModule>()

  for (const mod of pluginModules) {
    if (modulesById.has(mod.manifest.id)) {
      continue
    }

    try {
      const plugin = mod.createPlugin()
      if (plugin.id !== mod.manifest.id) {
        continue
      }
      registry.register(plugin)
      modulesById.set(mod.manifest.id, mod)
    } catch {
      // Optional plugin failed to instantiate — tolerate and skip.
    }
  }

  return { registry, modulesById }
}

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
  getLiteLLMBaseUrl?: () => string | null | undefined
  agentType?: AgentType
  mcpServers?: McpServerConfig[]
  mcpDiscovery?: Record<string, McpDiscoveryResult>
  pluginActivation?: PluginActivationState
  // Plugin modules the host discovered dynamically; only those whose id is
  // active in settings contribute tools and planner descriptors.
  pluginModules?: PluginModule[]
  // Persistent plugin runtime owned by a browser runtime factory. Keeping it
  // outside individual chat runtime instances lets lifecycle hooks observe
  // activation changes across runs.
  pluginRuntime?: BrowserPluginRuntime
}) => {
  const edgeFetch = createEdgeFetch(options.baseUrl, options.getToken)

  const tools: Tool<unknown, unknown>[] = []
  const hooks: AgentHookContribution[] = []
  const allToolDescriptors: PlannerToolDescriptor[] = []
  const registeredToolIds = new Set<string>()

  const addTool = (tool: Tool<unknown, unknown>): boolean => {
    if (registeredToolIds.has(tool.id)) {
      return false
    }
    registeredToolIds.add(tool.id)
    tools.push(tool)
    return true
  }

  const addToolWithDescriptor = (
    tool: Tool<unknown, unknown>,
    descriptor: PlannerToolDescriptor
  ): void => {
    if (addTool(tool)) {
      allToolDescriptors.push(descriptor)
    }
  }

  // Edge capability handed to plugins that must reach the edge backend (e.g. the
  // web-search plugin). Built from the runtime's existing edgeFetch so request
  // telemetry is preserved; response-parse telemetry (parse_error) stays here on
  // the host side via parseJsonWithTelemetry, keeping the plugin product-agnostic.
  const pluginEdgeFetch: PluginEdgeFetch = async (path, body, edgeOptions) => {
    const area = edgeOptions?.area
    const response = await edgeFetch(path, body, area ? { area } : undefined)
    const metadata: RequestTelemetryMetadata = {
      area: area ?? path,
      origin: 'edge',
      method: 'POST',
      url: response.url
    }
    return {
      ok: response.ok,
      status: response.status,
      json: () => parseJsonWithTelemetry<unknown>(metadata, response)
    }
  }

  for (const server of options.mcpServers ?? []) {
    if (!server.enabled) continue
    const disc = options.mcpDiscovery?.[server.id]
    if (!disc || disc.error) continue
    for (const toolMeta of disc.tools) {
      addToolWithDescriptor(createMcpTool(server, toolMeta, edgeFetch), {
        id: `mcp:${server.id}:${toolMeta.toolName}`,
        description: `[${server.name}] ${toolMeta.description}`,
        inputSchema: toolMeta.inputSchema
      })
    }
  }

  // Optional plugins: register tools only for the plugins the user activated in
  // Settings. Concrete plugins are discovered dynamically by the host and handed
  // in as `pluginModules`; this layer knows only the generic PluginModule shape.
  // The capture sink forwards structured plugin reports (e.g. feedback) to
  // telemetry; it no-ops unless telemetry consent is granted. An `info` report is
  // routed to `captureTelemetryMessage` so it surfaces as an informational
  // message (not an error issue); `warning`/`error` go through the exception path.
  const activePluginIds = resolveActivePluginIds(options.pluginActivation ?? {})
  // Web search is a discovered plugin but is gated by the host's `searchEnabled`
  // readiness state (default-on, plus service availability) rather than the
  // generic plugin-activation toggles — preserving today's behavior. Activate it
  // explicitly here so its tool + planner descriptor are contributed when search
  // is enabled and the web-search plugin was discovered.
  if (options.searchEnabled) {
    activePluginIds.add(WEB_SEARCH_PLUGIN_ID)
  }
  const pluginRuntime =
    options.pluginRuntime ?? createPluginRuntime(options.pluginModules ?? [])
  const activePluginModules = [...pluginRuntime.modulesById.values()].filter(
    (mod) => activePluginIds.has(mod.manifest.id)
  )
  if (activePluginIds.size > 0 || pluginRuntime.registry.list().length > 0) {
    const pluginHost: PluginHost = {
      capture: (report) => {
        const captureOptions = {
          level: report.level ?? 'warning',
          tags: { plugin: report.pluginId, plugin_kind: report.kind },
          ...(report.contexts ? { contexts: report.contexts } : {}),
          fingerprint: ['plugin', report.pluginId, report.kind]
        }
        if (report.level === 'info') {
          captureTelemetryMessage(report.message, captureOptions)
        } else {
          captureTelemetryException(report.message, captureOptions)
        }
      },
      // Human-in-the-loop gate: a permission-gating plugin (e.g. plugin-permissions)
      // calls this to ask the user before a tool runs. It enqueues a request on the
      // shared permission store; the mounted <PermissionModal /> resolves it with the
      // user's Allow/Deny choice. The browser can prompt, so it always provides this.
      requestPermission,
      // Edge capability: a plugin tool that must reach the edge (web search) builds
      // against this. The browser always has an edge backend, so it always provides
      // it; request telemetry rides along inside the wrapped edgeFetch.
      edgeFetch: pluginEdgeFetch
    }
    const addedPluginToolIds = new Set<string>()
    const contributions = pluginRuntime.registry.collectContributions(
      activePluginIds,
      pluginHost
    )
    hooks.push(...contributions.hooks)
    for (const tool of contributions.tools) {
      if (addTool(tool)) {
        addedPluginToolIds.add(tool.id)
      }
    }
    // Surface one planner descriptor per contributed plugin tool. A tool id can
    // only register once (addTool dedupes), so if two active plugins claim the
    // same id, only the winner's descriptor is exposed: the first module in
    // discovery order to claim a registered id wins, and the loser's descriptor
    // is dropped rather than duplicated.
    const describedToolIds = new Set<string>()
    for (const mod of activePluginModules) {
      for (const descriptor of mod.manifest.toolDescriptors ?? []) {
        if (addedPluginToolIds.has(descriptor.id) && !describedToolIds.has(descriptor.id)) {
          describedToolIds.add(descriptor.id)
          allToolDescriptors.push(descriptor)
        }
      }
    }
  }

  return createChatRuntime({
    ...(options.agentType ? { agentType: options.agentType } : {}),
    provider: new LiteLLMProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      ...(options.getLiteLLMBaseUrl
        ? { getLiteLLMBaseUrl: options.getLiteLLMBaseUrl }
        : {}),
      allToolDescriptors
    }),
    // Terminal runtime failures (e.g. a ReAct decision timeout, a provider/edge
    // error, or a rate limit that escaped the cooldown path) are swallowed into
    // a friendly fallback for the user; route them to Sentry here so they are
    // not lost. No-ops without telemetry consent. Aborts and handled rate-limit
    // cooldowns never reach this sink. The fingerprint keeps each distinct
    // failure its own issue rather than collapsing them under the shared frame.
    //
    // A RuntimeTimeoutError (a slow model tripped the planner / decision budget —
    // e.g. openai/gpt-5 via LiteLLM) is reported at `warning`, not `error`: the
    // run degraded into a friendly fallback rather than crashing, so it should be
    // visible to spot a misbehaving model/route without paging like an unexpected
    // exception (TINYTINKERER-FRONTEND-S). The `reason: 'timeout'` tag lets triage
    // filter these out of the hard-error signal.
    reportError: (error) => {
      const timedOut = isRuntimeTimeoutError(error)
      captureTelemetryException(error, {
        level: timedOut ? 'warning' : 'error',
        tags: { source: 'agent-runtime', ...(timedOut ? { reason: 'timeout' } : {}) },
        fingerprint: ['agent-runtime', fingerprintMessage(error.message)]
      })
    },
    createAssistantContentSession: async (initialSource = '') => {
      const { createMarkdownContentSession } = await import('@tinytinkerer/content-markdown')
      const session = createMarkdownContentSession(initialSource)
      return {
        append(chunk) {
          const snapshot = session.append(chunk)
          return { source: snapshot.source, content: snapshot.document }
        },
        replace(source) {
          const snapshot = session.replace(source)
          return { source: snapshot.source, content: snapshot.document }
        },
        snapshot() {
          const snapshot = session.snapshot()
          return { source: snapshot.source, content: snapshot.document }
        }
      }
    },
    tools,
    hooks,
    searchEnabled: options.searchEnabled
  })
}

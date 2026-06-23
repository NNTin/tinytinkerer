import {
  createChatRuntime,
  isPluginEnabled,
  isRuntimeTimeoutError,
  PluginRegistry,
  type AgentHookContribution,
  type PluginEdgeFetch,
  type PluginHost,
  type PluginModule,
  type Tool
} from '@tinytinkerer/app-core'
import { toolInputJsonSchema } from '@tinytinkerer/contracts'
import type {
  AgentType,
  McpDiscoveryResult,
  McpServerConfig,
  PluginActivationState
} from '@tinytinkerer/contracts'
import { LiteLLMProvider } from './litellm-provider'
import type { PlannerToolDescriptor } from './mcp-planner'
import { createEdgeFetch, type ForwardedRequestSink } from './edge-fetch'
import { createMcpTool } from './mcp-tool'
import { createSandboxExecutor } from '../sandbox-executor'
import { createDomReader, type DomSnapshotNode } from '../dom-reader'
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

// The code-exec plugin's tool id — the ONE host↔plugin coupling the plugin system
// deliberately keeps (documented in docs/plugin-infrastructure.md as the dom-snapshot
// channel). app-browser never imports the plugin; this literal only lets the runtime
// decide whether read_dom should build the (whole-body) sanitized DOM snapshot, which
// is wasted work — and an unnecessary exposure — unless a sandbox consumer
// (run_javascript) is actually registered to read it as its `dom` binding. Every
// other former host literal is now manifest-driven: the planner's keyword step
// travels on the web-search descriptor (keywordPlannerStep), and inspector capture
// is gated on a plugin contributing an inspectorDescriptor (see below).
const RUN_JAVASCRIPT_TOOL_ID = 'run_javascript'

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
  // Optional client-only capture sink for the context-inspector plugin (#270).
  // Only wired into the provider when that plugin is enabled (see below), so a
  // disabled inspector never captures or retains the forwarded payload.
  captureForwardedRequest?: ForwardedRequestSink
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
    // Plugin edge routes (today: web search → /api/search) require an
    // authenticated, identity-validated caller because they spend shared,
    // server-funded credentials (Tavily). An anonymous caller sends no
    // Authorization header, so the edge deterministically 401s — a preventable,
    // by-design outcome that carries no diagnostic signal. The web-search tool is
    // `defaultEnabled` and anonymous chat is allowed, so the model would otherwise
    // pick web search and trip a captured 401 on every unauthenticated run
    // (TINYTINKERER-FRONTEND-11). Short-circuit here WITHOUT a network round-trip or
    // telemetry capture, surfacing a clean "Unauthorized" the tool turns into a
    // graceful message for the model. A token that is *present but invalid/forbidden*
    // still flows through edgeFetch below and stays loud (captured) — real signal.
    if (!options.getToken()) {
      return {
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' })
      }
    }
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

  // Shared full sanitized DOM snapshot: read_dom writes the whole page here on every
  // read, and run_javascript reads it as its `dom` binding. This host-side holder is
  // the channel that lets the agent read a cheap narrow view with read_dom and then
  // compute/extract over the complete page in the sandbox (which cannot read the
  // page itself). Scoped to this runtime, like the two capabilities below. Capture is
  // gated on run_javascript being registered (set after the plugin block below), so a
  // read_dom with no sandbox consumer never pays for the whole-body deep clone.
  let domSnapshot: DomSnapshotNode | null = null
  let captureDomSnapshot = false

  // Sandbox capability handed to plugins that must run arbitrary code (e.g. the
  // code-exec plugin). The browser implements isolation via an ephemeral,
  // opaque-origin iframe + Worker with a strict CSP; the plugin stays
  // product-agnostic and only describes what to run. Constructed once per runtime
  // so its concurrency limit spans all runs in this runtime. It reads the shared
  // snapshot so sandboxed code receives the last-read page as `dom`.
  const sandboxExecutor = createSandboxExecutor(() => domSnapshot)

  // DOM-read capability handed to plugins that must read the current page (e.g.
  // the browser-state plugin). The browser implements it against this shell's own
  // document, capping and redacting form-field values host-side; the plugin stays
  // product-agnostic and only describes what to read. Each read also captures the
  // full sanitized page into the shared snapshot above for the sandbox to use.
  const domReader = createDomReader(
    (snapshot) => {
      domSnapshot = snapshot
    },
    () => captureDomSnapshot
  )

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
  const pluginRuntime = options.pluginRuntime ?? createPluginRuntime(options.pluginModules ?? [])
  // A plugin is active when the user's stored choice says so, or — with no stored
  // choice — when its manifest opts in via `defaultEnabled` (e.g. web search ships
  // on). Resolving against the discovered manifests keeps this fully generic: no
  // plugin id is special-cased here, and an undiscovered plugin is simply absent.
  const activation = options.pluginActivation ?? {}
  const activePluginModules = [...pluginRuntime.modulesById.values()].filter((mod) =>
    isPluginEnabled(activation, mod.manifest)
  )
  const activePluginIds = new Set(activePluginModules.map((mod) => mod.manifest.id))
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
      edgeFetch: pluginEdgeFetch,
      // Sandbox capability: a plugin tool that must run arbitrary code (code-exec)
      // builds against this. The browser can isolate code in an opaque-origin
      // iframe + Worker, so it always provides it; a host that cannot isolate omits
      // it and the plugin contributes no tool.
      executeSandboxedCode: sandboxExecutor,
      // DOM-read capability: a plugin tool that must read the current page
      // (browser-state) builds against this. The browser always has a document,
      // so it always provides it; a headless host omits it and the plugin
      // contributes no tool.
      readDom: domReader
    }
    const addedPluginToolIds = new Set<string>()
    const contributions = pluginRuntime.registry.collectContributions(activePluginIds, pluginHost)
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
          // Canonical schema path (issue #287): the planner-visible JSON Schema is
          // GENERATED here from the descriptor's Zod `schema` (the same schema the
          // tool validates input against) via `toolInputJsonSchema`, instead of a
          // hand-written property map that could drift from the runtime contract.
          allToolDescriptors.push({
            id: descriptor.id,
            description: descriptor.description,
            inputSchema: toolInputJsonSchema(descriptor.schema),
            ...(descriptor.keywordPlannerStep
              ? { keywordPlannerStep: descriptor.keywordPlannerStep }
              : {})
          })
        }
      }
    }
  }

  // Enable DOM-snapshot capture only when run_javascript actually registered, so a
  // read_dom never builds the whole-body clone (nor exposes it) when no sandbox can
  // consume it. Derived from the registered tools — the dom-snapshot channel is the
  // one deliberate host↔plugin coupling (see RUN_JAVASCRIPT_TOOL_ID above).
  captureDomSnapshot = registeredToolIds.has(RUN_JAVASCRIPT_TOOL_ID)

  return createChatRuntime({
    ...(options.agentType ? { agentType: options.agentType } : {}),
    provider: new LiteLLMProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel,
      ...(options.getLiteLLMBaseUrl ? { getLiteLLMBaseUrl: options.getLiteLLMBaseUrl } : {}),
      allToolDescriptors,
      // Arm forwarded-request capture ONLY when an active plugin contributes an
      // inspectorDescriptor, so the full conversation payload is captured/retained
      // solely for the developer inspector and stays entirely client-side otherwise
      // (#270). Gated on the manifest capability, not a hard-coded plugin id.
      ...(options.captureForwardedRequest &&
      activePluginModules.some((mod) => mod.manifest.inspectorDescriptor)
        ? { onForwardRequest: options.captureForwardedRequest }
        : {})
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
    hooks
  })
}

// The plugin contract (the plugin SDK) moved to @tinytinkerer/contracts — the
// leaf package — so plugin packages can depend ONLY on contracts. agent-core
// keeps the plugin *runtime* (PluginRegistry, hooks, ToolRegistry) and re-exports
// the contract here so its public export surface is unchanged and existing
// consumers (app-core, app-browser, plugins still importing from agent-core) need
// no import changes. See packages/shared/contracts/src/plugins.ts.
export type {
  PluginReport,
  PluginCaptureSink,
  HumanPromptView,
  HumanPromptResult,
  HumanInputService,
  PluginEdgeResponse,
  PluginEdgeFetch,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxCodeExecutor,
  DomQuery,
  DomNodeResult,
  DomReadResult,
  DomReader,
  PluginHost,
  ChatEventHookContext,
  ToolExecutionContext,
  ToolGateResult,
  AgentHookContribution,
  AgentPlugin,
  ActivityView,
  ActivityViewSection,
  ActivityTextSection,
  ActivityCodeSection,
  ActivityJsonSection,
  ActivityStatus,
  ActivitySummarizer,
  PermissionView,
  PermissionViewSection,
  PermissionCodeSection,
  PermissionJsonSection,
  JsonViewSection,
  PermissionSummarizer,
  PluginToolDescriptor,
  PluginManifest,
  PluginModule
} from '@tinytinkerer/contracts'
export { PluginCaptureError, isPluginModule } from '@tinytinkerer/contracts'

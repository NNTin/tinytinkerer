import { isPluginEnabled } from '@tinytinkerer/app-core'
import type { PluginManifest } from '@tinytinkerer/contracts'
import { useMemo } from 'react'
import { useSettingsStore } from './app'
import { usePluginModules } from './plugins/use-plugin-modules'

// Capability-neutral fillers shown when few (or no) plugins contribute starters.
// Safe to show in every configuration — they describe plain conversation, never
// a tool the user has not enabled.
const BASE_STARTER_PROMPTS: readonly string[] = [
  'Explain a concept in simple terms.',
  'Brainstorm ideas with me.',
  'Help me draft a message.',
  'Summarize some text I paste.'
]

// Prompt offered when at least one MCP server is connected and enabled. Derived
// from the host's own server list (a generic capability signal), not from any
// plugin id.
const MCP_STARTER_PROMPT = 'Help me automate a workflow.'

/**
 * Pure ordering logic behind {@link useStarterPrompts}, extracted so it is unit
 * testable without React. Capability-driven prompts come first (most useful),
 * then neutral fillers:
 * - each enabled plugin's `manifest.starterPrompt` (so a disabled plugin never
 *   advertises a capability the assistant cannot use),
 * - an MCP automation prompt when any MCP server is enabled,
 * - generic conversation fillers.
 *
 * Deduplicated, order-stable. Everything is derived from already-generic signals
 * (manifests + the server-enabled flag) — never a concrete plugin id.
 */
export const deriveStarterPrompts = (input: {
  manifests: readonly Pick<PluginManifest, 'id' | 'defaultEnabled' | 'starterPrompt'>[]
  pluginActivation: Record<string, boolean>
  hasEnabledMcpServer: boolean
}): string[] => {
  const ordered: string[] = []

  for (const manifest of input.manifests) {
    if (manifest.starterPrompt && isPluginEnabled(input.pluginActivation, manifest)) {
      ordered.push(manifest.starterPrompt)
    }
  }

  if (input.hasEnabledMcpServer) {
    ordered.push(MCP_STARTER_PROMPT)
  }

  ordered.push(...BASE_STARTER_PROMPTS)

  return [...new Set(ordered)]
}

/**
 * The ordered list of starter prompts for the current configuration (B3),
 * derived from enabled plugins and MCP servers via {@link deriveStarterPrompts}.
 */
export const useStarterPrompts = (): string[] => {
  const pluginModules = usePluginModules()
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const mcpServers = useSettingsStore((state) => state.mcpServers)

  return useMemo(
    () =>
      deriveStarterPrompts({
        manifests: pluginModules.map((mod) => mod.manifest),
        pluginActivation,
        hasEnabledMcpServer: mcpServers.some((server) => server.enabled)
      }),
    [pluginModules, pluginActivation, mcpServers]
  )
}

export type ConversationEmptyStateProps = {
  // How many suggested prompts to show. Web shows more, the widget just one.
  count: number
  // Fill the composer with the chosen prompt (shells wire this to setPrompt).
  onSelectPrompt: (prompt: string) => void
  // Optional one-line capability summary above the suggestions.
  summary?: string
  className?: string
}

const DEFAULT_SUMMARY =
  'Ask a question, brainstorm ideas, analyze content, or get help with a task.'

/**
 * Shared cold-start surface (B3). Renders a short capability summary plus
 * click-to-fill suggested prompts, data-driven via {@link useStarterPrompts}.
 * Every shell uses this component; only `count` and styling differ.
 */
export const ConversationEmptyState = ({
  count,
  onSelectPrompt,
  summary = DEFAULT_SUMMARY,
  className
}: ConversationEmptyStateProps) => {
  const prompts = useStarterPrompts().slice(0, Math.max(0, count))

  return (
    <div className={className}>
      <p className="text-sm text-[var(--muted)]">{summary}</p>
      {prompts.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {prompts.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                onClick={() => onSelectPrompt(prompt)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-left text-sm text-[var(--text)] transition-colors hover:border-[var(--accent-ring)] hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import {
  type PermissionSummarizer,
  type PermissionView,
  type PermissionViewSection
} from '@tinytinkerer/app-core'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { useHumanPromptStore, type PendingHumanPrompt } from './human-prompt-bridge'
import { loadPluginModules } from './plugins/registry'
import { useResolvedPluginView } from './resolved-plugin-view'

// The host's single human-in-the-loop modal (issue #85). It renders the head-of-queue
// HumanPromptView — the Permissions allow/deny prompt, the Choice-prompt poll, or any
// future HITL surface — and settles it with the user's answer. The requesting plugin
// owns the view shape (title, body, actions, custom/dismiss affordances) and maps the
// generic answer back to its own outcome; this generic renderer owns only the chrome.
// Plugins ship data, never a component. Mounted ONCE in the browser shell root
// (create-browser-shell-root), so no shell names a feature.

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // Inputs are normally plain JSON, but guard against a non-serializable value
    // (e.g. a cyclic object) so rendering the prompt can never throw.
    return '(value could not be displayed)'
  }
}

// Plugin-contributed permission summarizers, keyed by tool id. Discovered from the
// dynamic plugin manifests the host already reads (see ./plugins/registry), so the
// modal stays free of any static dependency on a concrete plugin and has no knowledge
// of any specific tool. Only a view with `inputContext` (the permission prompt) uses
// these — the choice poll carries none. Mirrors the activity-summarizer discovery in
// surfaces.tsx.
const usePermissionSummarizers = (): Map<string, PermissionSummarizer> => {
  const [summarizers, setSummarizers] = useState<Map<string, PermissionSummarizer>>(() => new Map())
  useEffect(() => {
    let cancelled = false
    void loadPluginModules().then((modules) => {
      if (cancelled) {
        return
      }
      const map = new Map<string, PermissionSummarizer>()
      for (const mod of modules) {
        for (const descriptor of mod.manifest.toolDescriptors ?? []) {
          if (descriptor.summarizePermission) {
            map.set(descriptor.id, descriptor.summarizePermission)
          }
        }
      }
      setSummarizers(map)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return summarizers
}

const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p>
    {children}
  </div>
)

const SectionList = ({ sections }: { sections: PermissionViewSection[] }) => (
  <>
    {sections.map((section: PermissionViewSection, index: number) => (
      <Section key={`${section.kind}-${section.label}-${index}`} label={section.label}>
        {section.kind === 'code' ? (
          <ReadOnlyCodeView
            value={section.code}
            language={section.language}
            className="tt-code-editor mt-1 max-h-72 overflow-auto rounded-md border border-stone-200"
          />
        ) : (
          <pre className="mt-1 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
            {formatJson(section.value)}
          </pre>
        )}
      </Section>
    ))}
  </>
)

// Renders a view's `inputContext`: the gated tool's input, drawn via the tool owner's
// summarizePermission (discovered by tool id) when present — and while it resolves, or
// when absent, a neutral JSON dump. The cross-plugin enrichment only the host can do
// (it alone sees every manifest). DISPLAY ONLY: the summarizer derives a view from a
// copy of the input; the runtime still executes the original payload.
const InputContextView = ({
  promptId,
  toolId,
  input,
  summarizer
}: {
  promptId: string
  toolId: string
  input: Record<string, unknown>
  summarizer: PermissionSummarizer | undefined
}) => {
  const fallback: PermissionView = {
    sections: [{ kind: 'json', label: 'Input', value: input }]
  }
  const hasSummarizer = summarizer !== undefined
  const view = useResolvedPluginView<PermissionView>({
    viewKey: `prompt:${promptId}:${toolId}:${hasSummarizer ? 'owner' : 'neutral'}`,
    fallback,
    resolveView: () => (summarizer ? summarizer(input) : fallback)
  })

  return (
    <>
      <Section label="Tool">
        <p className="mt-1 break-all font-mono text-sm text-stone-800">{toolId}</p>
      </Section>
      <SectionList sections={view.sections} />
    </>
  )
}

export const HumanPromptHost = () => {
  const pending = useHumanPromptStore((state): PendingHumanPrompt | undefined => state.queue[0])
  const summarizers = usePermissionSummarizers()

  // Free-text answer, reset whenever the head-of-queue prompt changes so a typed answer
  // never leaks from one prompt into the next.
  const [customText, setCustomText] = useState('')
  useEffect(() => {
    setCustomText('')
  }, [pending?.id])

  // Dismissing (overlay click / Escape) resolves `dismissed`. What that means is the
  // plugin's call: the permissions gate maps it to deny, the choice tool to a normal
  // dismissed result the model reacts to.
  useEffect(() => {
    if (!pending) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pending.resolve({ kind: 'dismissed' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending])

  if (!pending) {
    return null
  }

  const { view, resolve } = pending
  const trimmedCustom = customText.trim()
  const hasBody = Boolean(view.inputContext) || (view.sections?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label={view.dismissLabel}
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={() => resolve({ kind: 'dismissed' })}
      />
      <div
        role={view.role}
        aria-modal="true"
        aria-label={view.ariaLabel}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">{view.title}</h2>
          {view.description ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{view.description}</p>
          ) : null}
        </div>

        {hasBody ? (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto border-b border-[var(--border)] px-6 py-5">
            {view.sections && view.sections.length > 0 ? (
              <SectionList sections={view.sections} />
            ) : null}
            {view.inputContext ? (
              <InputContextView
                promptId={pending.id}
                toolId={view.inputContext.toolId}
                input={view.inputContext.input}
                summarizer={summarizers.get(view.inputContext.toolId)}
              />
            ) : null}
          </div>
        ) : null}

        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-5">
          {view.actions.map((action, index) => (
            <button
              key={`${index}-${action.id}`}
              type="button"
              onClick={() => resolve({ kind: 'action', id: action.id })}
              className={
                action.tone === 'primary'
                  ? 'flex w-full items-center justify-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700'
                  : 'flex w-full items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-sm text-stone-800 transition-colors hover:border-stone-300 hover:bg-stone-50'
              }
            >
              {action.label}
            </button>
          ))}
        </div>

        {view.allowCustom ? (
          <div className="space-y-2 border-t border-[var(--border)] px-6 py-4">
            <label
              htmlFor="tt-prompt-custom"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
            >
              Or type your own answer
            </label>
            <div className="flex gap-2">
              <input
                id="tt-prompt-custom"
                type="text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && trimmedCustom.length > 0) {
                    resolve({ kind: 'custom', text: trimmedCustom })
                  }
                }}
                placeholder="Type an answer…"
                className="flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-stone-400"
              />
              <button
                type="button"
                disabled={trimmedCustom.length === 0}
                onClick={() => resolve({ kind: 'custom', text: trimmedCustom })}
                className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400"
              >
                Send
              </button>
            </div>
          </div>
        ) : null}

        {/* An explicit dismiss button when the view asks for one (e.g. a poll's "Skip"):
            makes the "I won't answer" exit discoverable — the same `dismissed` outcome as
            Escape/overlay — so the composer is never silently blocked. */}
        {view.dismissAction ? (
          <div className="flex justify-end border-t border-[var(--border)] px-6 py-4">
            <button
              type="button"
              onClick={() => resolve({ kind: 'dismissed' })}
              className="inline-flex items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
            >
              {view.dismissAction.label}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import {
  type PermissionSummarizer,
  type PermissionView,
  type PermissionViewSection
} from '@tinytinkerer/app-core'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { HumanPromptControls } from './human-prompt-controls'
import { useHumanPromptPresentation } from './human-prompt-presentation'
import { loadPluginModules } from './plugins/registry'
import { useResolvedPluginView } from './resolved-plugin-view'
import { useDialogFocus } from './use-dialog-focus'

// The host's human-in-the-loop MODAL (issue #85) — one of two presentations for a
// HumanPromptView (the other is the composer dock). It renders the head-of-queue
// prompt as a centered overlay when that prompt's resolved presentation is `modal`
// (the default, and the only fit for the permissions allow/deny interrupt) and settles
// it with the user's answer. The requesting plugin owns the view shape; this generic
// renderer owns the chrome. Mounted ONCE in the browser shell root.

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
  const { view } = useResolvedPluginView<PermissionView>({
    viewKey: `prompt:${promptId}:${toolId}:${hasSummarizer ? 'owner' : 'neutral'}`,
    fallback,
    resolveView: () => (summarizer ? summarizer(input) : fallback)
  })

  return (
    <>
      <Section label="Tool">
        <p className="mt-1 break-all font-mono text-sm text-[var(--text)]">{toolId}</p>
      </Section>
      <SectionList sections={view.sections} />
    </>
  )
}

export const HumanPromptHost = () => {
  const { pending, presentation, conversationLabel } = useHumanPromptPresentation()
  const summarizers = usePermissionSummarizers()

  // Focus management for the modal presentation (issue #353). `focusKey` re-enters
  // the dialog when a queued prompt replaces the answered one.
  const dialogRef = useDialogFocus(Boolean(pending) && presentation === 'modal', {
    focusKey: pending?.id
  })

  // Only the modal presentation renders here; a `composer` prompt is drawn by the
  // composer dock instead. A view with no presentation preference defaults to modal.
  if (!pending || presentation !== 'modal') {
    return null
  }

  const { view, resolve } = pending
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
        ref={dialogRef}
        role={view.role}
        aria-modal="true"
        aria-label={view.ariaLabel}
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="border-b border-[var(--border)] px-6 py-4">
          {conversationLabel ? (
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {conversationLabel}
            </p>
          ) : null}
          <h2 className="text-base font-semibold text-[var(--text-strong)]">{view.title}</h2>
          {view.description ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">
              {view.description}
            </p>
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

        <HumanPromptControls pending={pending} />
      </div>
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import {
  type PermissionRequest,
  type PermissionSummarizer,
  type PermissionView,
  type PermissionViewSection
} from '@tinytinkerer/app-core'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { usePermissionStore, type PendingPermission } from './permission-service'
import { loadPluginModules } from './plugins/registry'
import { forwardPluginReport } from './telemetry/plugin-report'

// Reason recorded when the user dismisses the prompt (overlay click / Escape /
// Deny) rather than allowing the tool. The plugin wraps this into the runtime's
// "Tool execution blocked: …" message, naming the denied tool.
const DENY_REASON = 'Denied by user'

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
// same dynamic plugin manifests the host already reads (see ./plugins/registry), so
// the modal stays free of any static dependency on a concrete plugin package and
// has no knowledge of any specific tool. Mirrors the activity-summarizer discovery
// in surfaces.tsx.
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

// Renders a permission request's input. When the request's tool contributes a
// summarizer, its PermissionView drives the layout (e.g. a syntax-highlighted code
// section); otherwise — and while the async summarizer resolves — a neutral JSON
// dump of the raw input is shown, so the prompt is never blank and a slow/failed
// summarizer can never block approval. DISPLAY ONLY: the summarizer derives a view
// from a copy of the input; the runtime still executes the original payload.
const PermissionInputView = ({
  request,
  summarizer
}: {
  request: PermissionRequest
  summarizer: PermissionSummarizer | undefined
}) => {
  const [view, setView] = useState<PermissionView | null>(null)

  useEffect(() => {
    setView(null)
    if (!summarizer) {
      return
    }
    let cancelled = false
    void Promise.resolve(summarizer(request.input))
      .then((resolved) => {
        if (cancelled) {
          return
        }
        setView(resolved)
        if (resolved.report) {
          forwardPluginReport(resolved.report)
        }
      })
      .catch(() => {
        // A summarizer is expected to fail open and return a view; if one throws
        // anyway, fall back to the JSON dump rather than blocking the prompt.
        if (!cancelled) {
          setView(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [request, summarizer])

  if (!view) {
    return (
      <Section label="Input">
        <pre className="mt-1 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
          {formatJson(request.input)}
        </pre>
      </Section>
    )
  }

  return (
    <>
      {view.sections.map((section: PermissionViewSection, index: number) => (
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
}

const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p>
    {children}
  </div>
)

// Renders the head-of-queue permission request as a confirmation dialog and
// settles it with the user's choice. Mirrors the settings modal's overlay/dialog
// markup. Dismissing the dialog (overlay click or Escape) denies, the safe
// default for a permission prompt.
export const PermissionModal = () => {
  const pending = usePermissionStore((state): PendingPermission | undefined => state.queue[0])
  const summarizers = usePermissionSummarizers()

  useEffect(() => {
    if (!pending) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pending.resolve({ allow: false, reason: DENY_REASON })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending])

  if (!pending) {
    return null
  }

  const { request, resolve } = pending
  const allow = () => resolve({ allow: true })
  const deny = () => resolve({ allow: false, reason: DENY_REASON })

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Deny tool"
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={deny}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Tool permission request"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">Allow this tool to run?</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The assistant wants to run a tool. Review it and choose whether to allow it.
          </p>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
          <Section label="Tool">
            <p className="mt-1 break-all font-mono text-sm text-stone-800">{request.toolId}</p>
          </Section>
          <PermissionInputView request={request} summarizer={summarizers.get(request.toolId)} />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={deny}
            className="inline-flex items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={allow}
            className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

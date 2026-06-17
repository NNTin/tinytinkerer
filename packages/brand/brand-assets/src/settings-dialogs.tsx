import { useEffect, type ReactNode } from 'react'
import { LICENSE_TEXT } from './license.generated'
import { THIRD_PARTY_NOTICES } from './third-party-notices.generated'
import { TINYTINKERER_LICENSE } from './brand-links'
import {
  TINYTINKERER_CREDITS,
  TINYTINKERER_CREDITS_NOTE,
  TINYTINKERER_CREDITS_TITLE
} from './credits'

export type AboutDialogKind = 'license' | 'credits' | 'notices'

const NOTICES_TITLE = 'Third-Party Notices'

// Shared modal shell for the About footer dialogs. This whole module is loaded
// lazily (see BrandSettingsFooter) so the license text, credits list, and dialog
// chrome stay out of the startup bundle and only download when a dialog opens.
const SettingsDialog = ({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const closeLabel = `Close ${title.toLowerCase()}`

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label={closeLabel}
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="settings-content fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// License text and the third-party notices are both Markdown documents; render
// them with the host's Markdown renderer when available, otherwise fall back to
// monospace preformatted text.
const MarkdownBody = ({
  markdown,
  renderMarkdown
}: {
  markdown: string
  renderMarkdown?: (markdown: string) => ReactNode
}) =>
  renderMarkdown ? (
    renderMarkdown(markdown)
  ) : (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-stone-700">
      {markdown}
    </pre>
  )

const CreditsBody = () => (
  <div className="flex flex-col gap-4">
    <ul className="flex flex-col gap-3">
      {TINYTINKERER_CREDITS.map((credit) => (
        <li key={credit.name} className="text-sm leading-relaxed text-stone-700">
          {credit.href ? (
            <a
              href={credit.href}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-500"
            >
              {credit.name}
            </a>
          ) : (
            <span className="font-semibold text-stone-900">{credit.name}</span>
          )}
          <span className="text-stone-500"> — {credit.thanks}</span>
        </li>
      ))}
    </ul>
    <p className="text-xs italic leading-relaxed text-stone-500">{TINYTINKERER_CREDITS_NOTE}</p>
  </div>
)

const AboutDialogs = ({
  kind,
  onClose,
  renderMarkdown
}: {
  kind: AboutDialogKind
  onClose: () => void
  renderMarkdown?: (markdown: string) => ReactNode
}) => {
  if (kind === 'credits') {
    return (
      <SettingsDialog title={TINYTINKERER_CREDITS_TITLE} onClose={onClose}>
        <CreditsBody />
      </SettingsDialog>
    )
  }

  if (kind === 'notices') {
    return (
      <SettingsDialog title={NOTICES_TITLE} onClose={onClose}>
        <MarkdownBody
          markdown={THIRD_PARTY_NOTICES}
          {...(renderMarkdown ? { renderMarkdown } : {})}
        />
      </SettingsDialog>
    )
  }

  return (
    <SettingsDialog title={TINYTINKERER_LICENSE.title} onClose={onClose}>
      <MarkdownBody markdown={LICENSE_TEXT} {...(renderMarkdown ? { renderMarkdown } : {})} />
    </SettingsDialog>
  )
}

export default AboutDialogs

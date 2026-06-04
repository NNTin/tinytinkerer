import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { FaGithub, FaHeart, FaInstagram, FaLinkedinIn, FaScaleBalanced } from 'react-icons/fa6'
import { LICENSE_TEXT } from './license.generated'
import { TINYTINKERER_LICENSE, TINYTINKERER_SOCIALS, type BrandSocial } from './brand-links'
import { TINYTINKERER_CREDITS, TINYTINKERER_CREDITS_TITLE } from './credits'

const SOCIAL_ICONS: Record<BrandSocial['kind'], ComponentType<{ className?: string }>> = {
  github: FaGithub,
  instagram: FaInstagram,
  linkedin: FaLinkedinIn
}

const LicenseDialog = ({
  onClose,
  renderMarkdown
}: {
  onClose: () => void
  renderMarkdown?: (markdown: string) => ReactNode
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

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close license"
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TINYTINKERER_LICENSE.title}
        className="settings-content fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">{TINYTINKERER_LICENSE.title}</h2>
          <button
            type="button"
            aria-label="Close license"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          {renderMarkdown ? (
            renderMarkdown(LICENSE_TEXT)
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-stone-700">
              {LICENSE_TEXT}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

const CreditsDialog = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close credits"
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TINYTINKERER_CREDITS_TITLE}
        className="settings-content fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">{TINYTINKERER_CREDITS_TITLE}</h2>
          <button
            type="button"
            aria-label="Close credits"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
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
        </div>
      </div>
    </div>
  )
}

export const BrandSettingsFooter = ({
  renderMarkdown
}: {
  renderMarkdown?: (markdown: string) => ReactNode
}) => {
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)

  return (
    <section role="region" aria-label="About">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">About</h3>
      <div className="mt-3 flex items-center gap-2">
        {TINYTINKERER_SOCIALS.map((social) => {
          const Icon = SOCIAL_ICONS[social.kind]
          return (
            <a
              key={social.kind}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              aria-label={social.label}
              title={social.label}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              <Icon className="h-4 w-4" />
            </a>
          )
        })}
        <button
          type="button"
          onClick={() => setCreditsOpen(true)}
          aria-haspopup="dialog"
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
        >
          <FaHeart className="h-4 w-4" aria-hidden="true" />
          <span>{TINYTINKERER_CREDITS_TITLE}</span>
        </button>
        <button
          type="button"
          onClick={() => setLicenseOpen(true)}
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
        >
          <FaScaleBalanced className="h-4 w-4" aria-hidden="true" />
          <span>{TINYTINKERER_LICENSE.title}</span>
        </button>
      </div>
      {creditsOpen ? <CreditsDialog onClose={() => setCreditsOpen(false)} /> : null}
      {licenseOpen ? <LicenseDialog onClose={() => setLicenseOpen(false)} {...(renderMarkdown ? { renderMarkdown } : {})} /> : null}
    </section>
  )
}

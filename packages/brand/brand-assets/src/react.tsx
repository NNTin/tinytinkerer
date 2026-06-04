import { Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react'
import { FaGithub, FaHeart, FaInstagram, FaLinkedinIn, FaListUl, FaScaleBalanced } from 'react-icons/fa6'
import { TINYTINKERER_LICENSE, TINYTINKERER_SOCIALS, type BrandSocial } from './brand-links'
import { TINYTINKERER_CREDITS_TITLE } from './credits'
import type { AboutDialogKind } from './settings-dialogs'

const SOCIAL_ICONS: Record<BrandSocial['kind'], ComponentType<{ className?: string }>> = {
  github: FaGithub,
  instagram: FaInstagram,
  linkedin: FaLinkedinIn
}

// The three About actions share identical chrome, so they render from one button
// template below — keeping a single button block (instead of three) also keeps
// the startup entry chunk lean (see apps/widget bundle-size regression guard).
const ABOUT_ACTIONS: ReadonlyArray<{
  kind: AboutDialogKind
  Icon: ComponentType<{ className?: string }>
  label: string
}> = [
  { kind: 'credits', Icon: FaHeart, label: TINYTINKERER_CREDITS_TITLE },
  { kind: 'notices', Icon: FaListUl, label: 'Notices' },
  { kind: 'license', Icon: FaScaleBalanced, label: TINYTINKERER_LICENSE.title }
]

// The dialog chrome, license text, and credits list are only needed once a user
// opens a dialog, so they are split into their own chunk to keep the startup
// bundle small (see apps/widget bundle-size regression guard).
const AboutDialogs = lazy(() => import('./settings-dialogs'))

export const BrandSettingsFooter = ({
  renderMarkdown
}: {
  renderMarkdown?: (markdown: string) => ReactNode
}) => {
  const [openDialog, setOpenDialog] = useState<AboutDialogKind | null>(null)

  return (
    <section role="region" aria-label="About">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">About</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        {ABOUT_ACTIONS.map(({ kind, Icon, label }, index) => (
          <button
            key={kind}
            type="button"
            onClick={() => setOpenDialog(kind)}
            aria-haspopup="dialog"
            className={`${index === 0 ? 'ml-auto ' : ''}flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {openDialog ? (
        <Suspense fallback={null}>
          <AboutDialogs
            kind={openDialog}
            onClose={() => setOpenDialog(null)}
            {...(renderMarkdown ? { renderMarkdown } : {})}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

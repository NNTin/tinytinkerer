export type BrandCredit = {
  /** Project or service being thanked. */
  name: string
  /** Short thank-you note shown next to the name. */
  thanks: string
  /** Optional canonical link for the project or service. */
  href?: string
}

/**
 * Curated attribution list shown in the app's About section.
 *
 * This is intentionally hand-maintained and separate from the auto-generated
 * third-party notices (which enumerate every transitive dependency). Credits
 * are the human-picked "thank you" list for the tools that shaped this project,
 * including hosting, services, and the AI assistants used to build it.
 */
export const TINYTINKERER_CREDITS: readonly BrandCredit[] = [
  {
    name: 'CodeMirror',
    thanks: 'Thanks for powering the editing experience.',
    href: 'https://codemirror.net/'
  },
  {
    name: 'Mermaid',
    thanks: 'Thanks for making diagramming simple and elegant.',
    href: 'https://mermaid.js.org/'
  },
  {
    name: 'React',
    thanks: 'Thanks for providing the foundation of the application.',
    href: 'https://react.dev/'
  },
  {
    name: 'Tailwind CSS',
    thanks: 'Thanks for the fast and flexible styling system.',
    href: 'https://tailwindcss.com/'
  },
  {
    name: 'GitHub Models',
    thanks: 'Thanks for enabling access to a wide range of AI models.',
    href: 'https://github.com/marketplace/models'
  },
  {
    name: 'Sentry',
    thanks: 'Thanks for helping monitor and improve reliability.',
    href: 'https://sentry.io/'
  },
  {
    name: 'Turborepo',
    thanks: 'Thanks for streamlining builds and development workflows.',
    href: 'https://turborepo.com/'
  },
  {
    name: 'Vercel',
    thanks: 'Thanks for hosting and deploying the frontend.',
    href: 'https://vercel.com/'
  },
  {
    name: 'Cloudflare',
    thanks:
      'Thanks for powering the backend infrastructure and domain services.',
    href: 'https://www.cloudflare.com/'
  },
  {
    name: 'Codex',
    thanks:
      'Thanks for helping with planning, architecture, and turning rough ideas into actionable steps.',
    href: 'https://openai.com/codex/'
  },
  {
    name: 'Claude',
    thanks:
      'Thanks for helping implement features, explore solutions, and move ideas into working code.',
    href: 'https://www.anthropic.com/claude'
  },
  {
    name: 'Copilot',
    thanks:
      'Thanks for reviewing code, suggesting improvements, and catching things I might have missed.',
    href: 'https://github.com/features/copilot'
  }
] as const

export const TINYTINKERER_CREDITS_TITLE = 'Credits' as const

/** Closing note shown beneath the credits list. */
export const TINYTINKERER_CREDITS_NOTE =
  'In practice, these roles often overlapped, but each played a meaningful part in bringing this project to life.' as const

import {
  CLAUDE_ICON,
  CLOUDFLARE_ICON,
  CODEMIRROR_ICON,
  COPILOT_ICON,
  EXCALIDRAW_ICON,
  LITELLM_ICON,
  MERMAID_ICON,
  OPENAI_ICON,
  PIXEL_AGENTS_ICON,
  REACT_ICON,
  SENTRY_ICON,
  TAILWIND_ICON,
  TURBOREPO_ICON,
  VERCEL_ICON
} from './credits-icons'

export type BrandCredit = {
  /** Project or service being thanked. */
  name: string
  /** Short thank-you note shown next to the name. */
  thanks: string
  /** Optional canonical link for the project or service. */
  href?: string
  /** Official project icon, embedded as a data URI (see ./credits-icons). */
  icon?: string
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
    href: 'https://codemirror.net/',
    icon: CODEMIRROR_ICON
  },
  {
    name: 'Excalidraw',
    thanks: 'Thanks for powering the canvas with a delightful whiteboard.',
    href: 'https://excalidraw.com/',
    icon: EXCALIDRAW_ICON
  },
  {
    name: 'Mermaid',
    thanks: 'Thanks for making diagramming simple and elegant.',
    href: 'https://mermaid.js.org/',
    icon: MERMAID_ICON
  },
  {
    name: 'Pixel Agents',
    thanks: 'Thanks for bringing agent activity to life as a pixel office.',
    href: 'https://github.com/pixel-agents-hq/pixel-agents/',
    icon: PIXEL_AGENTS_ICON
  },
  {
    name: 'React',
    thanks: 'Thanks for providing the foundation of the application.',
    href: 'https://react.dev/',
    icon: REACT_ICON
  },
  {
    name: 'Tailwind CSS',
    thanks: 'Thanks for the fast and flexible styling system.',
    href: 'https://tailwindcss.com/',
    icon: TAILWIND_ICON
  },
  {
    name: 'LiteLLM',
    thanks: 'Thanks for the unified proxy that enables access to a wide range of AI models.',
    href: 'https://www.litellm.ai/',
    icon: LITELLM_ICON
  },
  {
    name: 'Sentry',
    thanks: 'Thanks for helping monitor and improve reliability.',
    href: 'https://sentry.io/',
    icon: SENTRY_ICON
  },
  {
    name: 'Turborepo',
    thanks: 'Thanks for streamlining builds and development workflows.',
    href: 'https://turborepo.com/',
    icon: TURBOREPO_ICON
  },
  {
    name: 'Vercel',
    thanks: 'Thanks for hosting and deploying the frontend.',
    href: 'https://vercel.com/',
    icon: VERCEL_ICON
  },
  {
    name: 'Cloudflare',
    thanks: 'Thanks for powering the backend infrastructure and domain services.',
    href: 'https://www.cloudflare.com/',
    icon: CLOUDFLARE_ICON
  },
  {
    name: 'Codex',
    thanks:
      'Thanks for helping with planning, architecture, and turning rough ideas into actionable steps.',
    href: 'https://openai.com/codex/',
    icon: OPENAI_ICON
  },
  {
    name: 'Claude',
    thanks:
      'Thanks for helping implement features, explore solutions, and move ideas into working code.',
    href: 'https://www.anthropic.com/claude',
    icon: CLAUDE_ICON
  },
  {
    name: 'Copilot',
    thanks:
      'Thanks for reviewing code, suggesting improvements, and catching things I might have missed.',
    href: 'https://github.com/features/copilot',
    icon: COPILOT_ICON
  }
] as const

export const TINYTINKERER_CREDITS_TITLE = 'Credits' as const

/** Closing note shown beneath the credits list. */
export const TINYTINKERER_CREDITS_NOTE =
  'In practice, these roles often overlapped, but each played a meaningful part in bringing this project to life.' as const

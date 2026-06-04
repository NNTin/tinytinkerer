export type BrandCredit = {
  /** Project or service being thanked. */
  name: string
  /** Short, first-person thank-you note shown next to the name. */
  thanks: string
  /** Optional canonical link for the project or service. */
  href?: string
}

/**
 * Curated attribution list shown in the app's About section.
 *
 * This is intentionally hand-maintained and separate from the auto-generated
 * THIRD_PARTY_NOTICES.md (which enumerates every transitive dependency). Credits
 * are the human-picked "thank you" list for the tools that shaped this project,
 * including hosting, services, and the AI assistants used to build it.
 */
export const TINYTINKERER_CREDITS: readonly BrandCredit[] = [
  { name: 'CodeMirror', thanks: 'thanks for the editor', href: 'https://codemirror.net/' },
  { name: 'Mermaid', thanks: 'thanks for the mermaid diagram', href: 'https://mermaid.js.org/' },
  { name: 'React', thanks: 'thanks for the framework', href: 'https://react.dev/' },
  { name: 'Tailwind', thanks: 'thanks for the styling', href: 'https://tailwindcss.com/' },
  {
    name: 'GitHub',
    thanks: 'thanks for the GitHub Models',
    href: 'https://github.com/marketplace/models'
  },
  { name: 'Sentry', thanks: 'thanks for the Telemetry', href: 'https://sentry.io/' },
  { name: 'Turborepo', thanks: 'thanks for the build system', href: 'https://turborepo.com/' },
  { name: 'Vercel', thanks: 'thanks for the SPA hosting', href: 'https://vercel.com/' },
  {
    name: 'Cloudflare',
    thanks: 'thanks for the serverless backend and domain',
    href: 'https://www.cloudflare.com/'
  },
  { name: 'Claude, Codex and Copilot', thanks: 'thanks for helping me develop this project' }
] as const

export const TINYTINKERER_CREDITS_TITLE = 'Credits' as const

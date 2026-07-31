/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * `DocsPageProvider` needs a **commit-synchronous** publish so a tool call
 * landing between an SPA route commit and the passive-effect flush cannot read
 * the previous route (see docs-page-context.tsx). React logs a warning for a
 * layout effect during server rendering, though — it cannot run one, and says
 * so — and this provider is rendered by `@theme/Root` on every statically
 * rendered page, so the warning would be printed for the entire site build.
 *
 * The guard is an **environment feature detect**, not a page read. It looks at
 * whether a DOM exists at all; it never touches the rendered document, which is
 * the rule `docs-page/__tests__/static-rendering.test.tsx` enforces across this
 * directory. Neither branch of the effect reads anything from the page either —
 * the value published is derived entirely from Docusaurus routing data and the
 * #474 corpus manifest.
 */
import { useEffect, useLayoutEffect } from 'react'

export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

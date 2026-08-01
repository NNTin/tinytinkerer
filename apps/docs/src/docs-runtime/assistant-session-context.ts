/**
 * Positive identification of the global documentation assistant (issue #479
 * review, finding 5).
 *
 * `useBrowserApp()` answers "is SOME BrowserApp mounted?", which is not the
 * question this app's supported session service needs to ask. Rendered under a
 * live lab's provider — a mistake #472 or #480 could make without noticing — a
 * facade guarded only by that check would read and mutate LAB conversations while
 * calling itself the documentation-assistant session, quietly undoing the
 * isolation the API exists to enforce.
 *
 * So the assistant tree publishes its own identity here, and
 * `useDocsAssistantSession` requires it. A dedicated context rather than a
 * comparison against the assistant's storage namespace: this is positive proof
 * that the assistant runtime mounted this subtree, where a namespace string would
 * pass for any app configured to look alike.
 *
 * Provided by `AssistantSession`, which mounts only after `BrowserAppShell` has
 * bootstrapped — so holding this context also means the session is live.
 */
import { createContext } from 'react'
import type { BrowserApp } from '@tinytinkerer/app-browser'

export const DocsAssistantSessionContext = createContext<BrowserApp | undefined>(undefined)

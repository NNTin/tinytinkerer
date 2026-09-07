/**
 * What every Pixel Agents office on this site needs, whichever session it is
 * driving.
 *
 * There are two kinds of host: the live labs (issue #452), each driving the
 * shared docs-lab `BrowserApp`'s demo conversations, and the documentation
 * assistant's sidebar Office (issue #472), driving the global assistant
 * session. They share the asset resolution, the "can the graphical office run
 * here at all?" rule, and the accessible textual fallback — so those live here
 * rather than inside `live-lab/`, which the assistant runtime must not import.
 *
 * Not light: `ConversationSwitcher` imports `@tinytinkerer/pixel-agents` for
 * its activity-status type. Reach this module from a lazily-loaded chunk only.
 */
export { ConversationSwitcher } from './ConversationSwitcher'
export type { ConversationSwitcherItem } from './ConversationSwitcher'
export { usePixelAgentsCapability } from './capability'
export { useResolveUpstreamUrl } from './upstream-url'

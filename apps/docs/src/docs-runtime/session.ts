/**
 * The supported session/conversation service for the global documentation
 * assistant (issue #479) — the interface #472 consumes.
 *
 * This is the whole of the public surface: a consumer manages assistant
 * conversations through these operations and never touches the chat store, the
 * shell, or the storage namespace directly. That is what stops a second global
 * store from appearing — there is nothing here that creates one, and
 * `ensureDocsAssistantApp` is not exported from the app's entry point.
 *
 * **Where this may be imported from.** Only code that already renders inside the
 * assistant provider: a component registered through
 * `registerDocsAssistantSurface`. The hook throws otherwise, because there is no
 * useful non-throwing answer — a conversation list with no session behind it
 * would just be a lie with a spinner. Importing this module also pulls the
 * product runtime, so an eagerly-loaded page component must import
 * `@site/src/docs-runtime` (light) and register a surface instead.
 */
import { useCallback, useContext, useMemo } from 'react'
import { useAuthStore, useChatStore } from '@tinytinkerer/app-browser'
import { DocsAssistantSessionContext } from './assistant-session-context'
import { beginDocsProductSignIn } from './product-sign-in'
import { useDocsRuntimeConfig } from './runtime-config'

export type DocsAssistantConversation = {
  id: string
  title: string
  /** A generation or tool call is in flight in this conversation. */
  isRunning: boolean
}

export type DocsAssistantSession = {
  conversations: readonly DocsAssistantConversation[]
  activeConversationId: string | undefined
  /**
   * Whether a product token was found at bootstrap. `false` is a normal,
   * fully-usable state: an anonymous visitor talks to the shared, rate-limited
   * key, exactly as every other TinyTinkerer chat surface allows.
   */
  isAuthenticated: boolean
  selectConversation: (conversationId: string) => Promise<void>
  startNewConversation: () => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  /**
   * Start the reader's assistant conversation over: cancel its in-flight work,
   * discard it, and create and select a fresh one — the locked semantics from
   * decision 5. Other assistant conversations are untouched.
   *
   * Deliberately NOT the live labs' reset. A lab lives inside one page and can
   * afford to delete its database and reload; doing that from a site-wide
   * assistant would reload the documentation out from under the reader and
   * throw away consent, authentication input, assistant settings, and #480's
   * presentation state along with it. Those all live in other stores, so this
   * cannot touch them — and it reaches no live lab and no product data either.
   */
  resetActiveConversation: () => Promise<void>
  /** Start the product's own GitHub login. Anonymous use continues meanwhile. */
  signIn: () => void
}

const NO_SESSION_MESSAGE =
  'useDocsAssistantSession() was called outside the documentation assistant session. Render ' +
  'through registerDocsAssistantSurface() so the component mounts inside the assistant provider. ' +
  'A live-lab or product BrowserApp does not satisfy it: this service manages the global ' +
  'documentation assistant conversations only.'

export const useDocsAssistantSession = (): DocsAssistantSession => {
  // The assistant's OWN identity, not merely "a BrowserApp is mounted" — under a
  // live lab's provider that weaker check would silently manage lab
  // conversations. See assistant-session-context.ts.
  if (!useContext(DocsAssistantSessionContext)) {
    throw new Error(NO_SESSION_MESSAGE)
  }

  const runtimeConfig = useDocsRuntimeConfig()
  const slices = useChatStore((state) => state.conversations)
  const order = useChatStore((state) => state.conversationOrder)
  const activeConversationId = useChatStore((state) => state.conversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewConversation = useChatStore((state) => state.startNewConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  // One store action rather than delete-then-create from here: deleting the
  // active conversation already selects the most recent remaining one (or makes
  // a fresh one), so composing the two would flash somebody else's conversation
  // between the awaits, and could leave two new ones behind.
  const restartConversation = useChatStore((state) => state.restartConversation)
  const token = useAuthStore((state) => state.token)

  const conversations = useMemo<readonly DocsAssistantConversation[]>(
    () =>
      // Ordered by the store's own `conversationOrder` (most recently updated
      // first at load, new ones prepended) rather than by object key order,
      // which is arbitrary. An id in the order with no slice is skipped rather
      // than rendered as a blank row.
      order.flatMap((id) => {
        const slice = slices[id]
        return slice ? [{ id, title: slice.title, isRunning: slice.isRunning }] : []
      }),
    [order, slices]
  )

  const resetActiveConversation = useCallback(async () => {
    await restartConversation()
  }, [restartConversation])

  const signIn = useCallback(() => {
    beginDocsProductSignIn(runtimeConfig)
  }, [runtimeConfig])

  return useMemo(
    () => ({
      conversations,
      activeConversationId,
      isAuthenticated: token != null,
      selectConversation,
      startNewConversation,
      deleteConversation,
      resetActiveConversation,
      signIn
    }),
    [
      conversations,
      activeConversationId,
      token,
      selectConversation,
      startNewConversation,
      deleteConversation,
      resetActiveConversation,
      signIn
    ]
  )
}

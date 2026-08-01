/**
 * Renders the registered assistant surfaces (issue #479).
 *
 * Mounted by the runtime client inside the assistant provider, so everything it
 * draws — inline or portaled — is a logical descendant of the one assistant
 * session: one app, one conversation repository, one query client.
 *
 * Its own module rather than part of the client, so placement behaviour can be
 * rendered and asserted without booting a `BrowserApp`. It imports no product
 * runtime for the same reason.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  readDocsAssistantSurfaces,
  readDocsAssistantSurfacesForServer,
  subscribeDocsAssistantSurfaces
} from './assistant-surface'

export const AssistantSurfaces = (): ReactNode => {
  const surfaces = useSyncExternalStore(
    subscribeDocsAssistantSurfaces,
    readDocsAssistantSurfaces,
    readDocsAssistantSurfacesForServer
  )

  return (
    <>
      {surfaces.map(({ id, Component, placement, target }) => {
        if (placement === 'inline') {
          return <Component key={id} />
        }
        // A portal surface waits for its target. Rendering it inline instead
        // would put #472's Office in the wrong part of the page on every route
        // that unmounts the target, and discard its state each way (issue #479
        // review, finding 2).
        if (!target) {
          return null
        }
        return createPortal(<Component />, target, id)
      })}
    </>
  )
}

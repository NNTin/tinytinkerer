import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// The ONLY package import on the startup path: the side-effect-free `/oauth`
// subpath. Importing anything from the package root here would put the whole
// runtime in this chunk; run.mjs measures that it does not.
import { completeGitHubOAuth, isGitHubOAuthCallback } from '@nntin/tinytinkerer-embed/oauth'
import { shellOptions } from './shell-options'

// The host's own page renders first; the assistant — and with it the package's
// runtime — is fetched only through this dynamic import().
const Assistant = lazy(() => import('./assistant'))

const container = document.getElementById('root')
if (!container) {
  throw new Error('missing #root')
}

// Finish GitHub's redirect before the page (and any router) renders. Chained,
// NOT a top-level await: an entry suspended on its own top-level await can
// deadlock a lazy chunk that imports back from it.
const finishCallback = async (): Promise<void> => {
  if (!isGitHubOAuthCallback()) {
    return
  }
  try {
    const returnUrl = await completeGitHubOAuth(shellOptions)
    window.history.replaceState(null, '', returnUrl ?? '/')
  } catch (error) {
    console.error('GitHub sign-in failed', error)
    window.history.replaceState(null, '', '/')
  }
}

void finishCallback().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <main>
        <h1>Embed acceptance host</h1>
        <Suspense fallback={<p role="status">Loading assistant…</p>}>
          <Assistant />
        </Suspense>
      </main>
    </StrictMode>
  )
})

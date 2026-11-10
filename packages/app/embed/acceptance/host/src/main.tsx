import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// The host's own page renders first; the assistant — and with it every byte of
// @nntin/tinytinkerer-embed — is fetched only through this dynamic import().
const Assistant = lazy(() => import('./assistant'))

const container = document.getElementById('root')
if (!container) {
  throw new Error('missing #root')
}

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

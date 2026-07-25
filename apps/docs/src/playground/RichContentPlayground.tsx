import { lazy, Suspense } from 'react'
import BrowserOnly from '@docusaurus/BrowserOnly'
import { LabContainer } from '../components/lab-container'

// The only place this framework reaches for the real content platform
// runtime. Docusaurus's <BrowserOnly> renders nothing at all during static
// rendering/prerendering, and only invokes its render-prop after the client
// mounts; nesting a React.lazy import inside that means the chunk (parser,
// React content runtime, and every specialized renderer plugin) is only ever
// fetched once a page that actually contains a <RichContentPlayground>
// renders it client-side (issue #455: "ordinary documentation pages do not
// include the playground's heavy runtime chunks").
const PlaygroundClientRuntime = lazy(() => import('./client-runtime'))

export type RichContentPlaygroundProps = { title?: string }

const DEFAULT_TITLE = 'Rich content playground'

export const RichContentPlayground = ({ title = DEFAULT_TITLE }: RichContentPlaygroundProps) => (
  <BrowserOnly fallback={<LabContainer title={title} status="loading" />}>
    {() => (
      <Suspense fallback={<LabContainer title={title} status="loading" />}>
        <PlaygroundClientRuntime title={title} />
      </Suspense>
    )}
  </BrowserOnly>
)

import type { ReactNode } from 'react'
import {
  BrowserAppShell,
  ChatApp,
  createBrowserApp,
  loadPlugins,
  resolveBrowserShellBootstrapConfig,
  z,
  type AppToolGroup
} from '@nntin/tinytinkerer-embed'
import '@nntin/tinytinkerer-embed/embed.css'
import '@nntin/tinytinkerer-embed/styles.css'
import { shellOptions } from './shell-options'

declare global {
  interface Window {
    /** Every call the assistant made to the host's tool, for the acceptance spec. */
    __embedToolCalls?: unknown[]
  }
}

const measureBoardInput = z.object({
  board: z.string().describe('The prototype board to measure, e.g. "perfboard-70x90".')
})

// The host's own tools: one group, one Zod-schema tool.
const hostTools: AppToolGroup = {
  id: 'host',
  label: 'Host',
  tools: [
    {
      id: 'measure_board',
      description: 'Return the width and height, in millimetres, of a named prototype board.',
      schema: measureBoardInput,
      execute: async (input) => {
        const { board } = measureBoardInput.parse(input)
        const result = { board, widthMm: 70, heightMm: 90 }
        window.__embedToolCalls = [...(window.__embedToolCalls ?? []), result]
        return result
      }
    }
  ]
}

const config = resolveBrowserShellBootstrapConfig({
  baseUrl: '/',
  origin: window.location.origin,
  ...shellOptions,
  authMode: 'hybrid',
  // The host's own token, followed live. The surface's tokens are `--tt-*`, so
  // this is a reference to the host's `--accent`, not to itself (issue #518, F1).
  theme: { accent: 'var(--accent)' }
})

const app = createBrowserApp(config, {
  plugins: () => loadPlugins(['plugin-tool-tree']),
  appToolGroup: hostTools,
  starterPrompts: ['How big is the perfboard-70x90?'],
  // The host owns its <head> and does not run TinyTinkerer telemetry.
  documentGlobals: { brandMetadata: false, telemetry: false },
  humanInput: false
})

const BootScreen = ({ error }: { error?: string }): ReactNode => (
  <p role="status">{error ? `Assistant failed to start: ${error}` : 'Starting assistant…'}</p>
)

export default function Assistant(): ReactNode {
  return (
    <div className="tt-app-embed">
      <BrowserAppShell
        app={app}
        config={config}
        BootScreen={BootScreen}
        globalHosts={{ telemetryConsent: false, privacyUpdate: false, konami: false }}
      >
        <ChatApp
          mode="sidebar"
          morphable={false}
          storageKey="embed-acceptance"
          LoadingComponent={BootScreen}
        />
      </BrowserAppShell>
    </div>
  )
}

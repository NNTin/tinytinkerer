import { startTransition, useEffect, useState } from 'react'
import type { BrowserApp } from './app'
import { initializeBrowserApp } from './app'
import type { BrowserShellConfig } from './config'

export const useBrowserAppBootstrap = (
  app: BrowserApp,
  config: BrowserShellConfig
): { ready: boolean; error: string | null } => {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    void initializeBrowserApp(app, config)
      .then(() => {
        if (!disposed) {
          startTransition(() => {
            setReady(true)
          })
        }
      })
      .catch((nextError: unknown) => {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : null)
        }
      })

    return () => {
      disposed = true
    }
  }, [app, config])

  return { ready, error }
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '')

export const resolveDeployBase = (value: string | undefined): string => trimSlashes(value ?? '')

export const resolveDocsBaseUrl = (value: string | undefined): string => {
  const deployBase = resolveDeployBase(value)
  return `/${deployBase ? `${deployBase}/` : ''}docs/`
}

export const resolveProductBaseUrl = (value: string | undefined): string => {
  const deployBase = resolveDeployBase(value)
  return deployBase ? `/${deployBase}/` : '/'
}

// webpack-dev-server's default HMR endpoint. The unified host proxies this
// upgrade alongside `/docs/*` during local development.
export const DOCS_DEV_WEBSOCKET_PATH = '/ws'

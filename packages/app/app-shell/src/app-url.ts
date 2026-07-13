// Resolve an iframe page owned by its harness shell under either the root
// deployment (`/canvas/` → `/canvas/excalidraw-app/`) or a nested preview base.
export const resolveEmbeddedAppUrl = (shellBaseUrl: string, appRouteSegment: string): string => {
  const appSegment = appRouteSegment.replace(/^\/+|\/+$/g, '')
  if (!shellBaseUrl.startsWith('/') || !shellBaseUrl.endsWith('/') || appSegment.length === 0) {
    throw new Error('app-harness: expected an absolute shell base and non-empty app route segment')
  }

  return `${shellBaseUrl}${appSegment}/`
}

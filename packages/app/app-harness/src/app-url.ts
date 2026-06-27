// Resolve an iframe app beside its harness shell under either the root deployment
// (`/canvas/` → `/excalidraw-app/`) or a nested preview base. Keeping this here
// prevents every shell from reimplementing deployment-path surgery.
export const resolveSiblingAppUrl = (shellBaseUrl: string, appRouteSegment: string): string => {
  const shellSegments = shellBaseUrl.split('/').filter(Boolean)
  const appSegment = appRouteSegment.replace(/^\/+|\/+$/g, '')
  if (!shellBaseUrl.startsWith('/') || shellSegments.length === 0 || appSegment.length === 0) {
    throw new Error('app-harness: expected an absolute shell base and non-empty app route segment')
  }

  shellSegments.pop()
  return `/${[...shellSegments, appSegment].join('/')}/`
}

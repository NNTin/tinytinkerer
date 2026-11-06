import { useEffect, useState } from 'react'
import { PIXEL_AGENTS_NARROW_VIEWPORT_QUERY, PIXEL_AGENTS_REDUCED_MOTION_QUERY } from './constants'

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query)
    const onChange = (): void => setMatches(mediaQueryList.matches)
    onChange()
    mediaQueryList.addEventListener('change', onChange)
    return () => mediaQueryList.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// Whether the Pixel Agents graphical office should be offered at all (issues
// #452, #472). Any of a narrow viewport, `prefers-reduced-motion`, or a
// bootstrap/asset/bridge failure (reported by the caller via
// `pixelAgentsFailed`, fed by PixelAgentsStage's `onBootstrapError`) routes the
// host to its textual conversation switcher instead of a half-working
// graphical surface.
export const usePixelAgentsCapability = (pixelAgentsFailed: boolean): boolean => {
  const isNarrowViewport = useMediaQuery(PIXEL_AGENTS_NARROW_VIEWPORT_QUERY)
  const prefersReducedMotion = useMediaQuery(PIXEL_AGENTS_REDUCED_MOTION_QUERY)
  return !isNarrowViewport && !prefersReducedMotion && !pixelAgentsFailed
}

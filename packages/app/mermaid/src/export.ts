import type { MermaidRenderTheme } from '@tinytinkerer/content-mermaid'

export type MermaidExportFormat = 'png' | 'svg' | 'clipboard'
export type MermaidExportBackground = 'transparent' | 'solid'

// Solid background colors, keyed by the render theme they pair with. Mermaid's
// 'dark' theme sets its `background` themeVariable to #333 — matching that here
// keeps the exported PNG/SVG background consistent with what the diagram itself
// was drawn against.
export const SOLID_BACKGROUND_COLOR: Record<MermaidRenderTheme, string> = {
  default: '#ffffff',
  dark: '#333333'
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

// Filesystem-safe, local-time export filename (no colons/spaces, sortable).
export const defaultExportFilename = (now: Date = new Date()): string =>
  `tinytinkerer-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(
    now.getHours()
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`

// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|\x00-\x1f\x7f]/g

export const sanitizeExportFilename = (input: string): string => {
  const stripped = input.replace(ILLEGAL_FILENAME_CHARS, '')
  const trimmed = stripped.trim().replace(/^[.\s]+/, '')
  // Trim trailing dots/spaces only after capping, so the cap cannot re-expose them.
  return trimmed.slice(0, 120).replace(/[.\s]+$/, '')
}

export const PNG_MAX_DIMENSION = 8192
export const PNG_MAX_AREA = 33_554_432

// Deterministic PNG scale policy: fixed 2x base (not devicePixelRatio, so exports
// reproduce identically across displays), capped so the rasterized PNG never
// exceeds the per-side or total-area limits above.
export const resolvePngScale = (width: number, height: number): number =>
  Math.min(
    2,
    PNG_MAX_DIMENSION / width,
    PNG_MAX_DIMENSION / height,
    Math.sqrt(PNG_MAX_AREA / (width * height))
  )

export type PreparedExportSvg = {
  svg: string
  width: number
  height: number
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export const prepareExportSvg = (
  svgMarkup: string,
  options: { background: MermaidExportBackground; theme: MermaidRenderTheme }
): PreparedExportSvg => {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror'))
    throw new Error('Could not parse the diagram markup as SVG')

  const viewBox = root.getAttribute('viewBox')
  let minX = 0
  let minY = 0
  let width = 0
  let height = 0
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      ;[minX, minY, width, height] = parts as [number, number, number, number]
    }
  }
  if (!(width > 0 && height > 0)) {
    const attrWidth = Number.parseFloat(root.getAttribute('width') ?? '')
    const attrHeight = Number.parseFloat(root.getAttribute('height') ?? '')
    if (
      Number.isFinite(attrWidth) &&
      Number.isFinite(attrHeight) &&
      attrWidth > 0 &&
      attrHeight > 0
    ) {
      minX = 0
      minY = 0
      width = attrWidth
      height = attrHeight
    }
  }
  if (!(width > 0 && height > 0)) throw new Error('Diagram has no measurable size')

  width = Math.ceil(width)
  height = Math.ceil(height)

  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('xmlns', SVG_NAMESPACE)

  // Only strip the max-width sizing mermaid put on the root; leave other
  // inline styles (e.g. font settings) untouched.
  const style = root.getAttribute('style')
  if (style) {
    const cleaned = style
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.length > 0 && !/^max-width\s*:/i.test(declaration))
      .join('; ')
    if (cleaned) root.setAttribute('style', cleaned)
    else root.removeAttribute('style')
  }

  // No padding is ever added here: the modal's preview checkerboard padding is
  // presentation-only and must never leak into the exported file.
  if (options.background === 'solid') {
    const rect = doc.createElementNS(SVG_NAMESPACE, 'rect')
    rect.setAttribute('x', String(minX))
    rect.setAttribute('y', String(minY))
    rect.setAttribute('width', String(width))
    rect.setAttribute('height', String(height))
    rect.setAttribute('fill', SOLID_BACKGROUND_COLOR[options.theme])
    rect.setAttribute('class', 'tt-export-background')
    root.insertBefore(rect, root.firstChild)
  }

  const svg = new XMLSerializer().serializeToString(doc)
  return { svg, width, height }
}

export const rasterizeSvgToPng = async (
  svg: string,
  width: number,
  height: number
): Promise<Blob> => {
  const scale = resolvePngScale(width, height)
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Failed to load the SVG for rasterization'))
    // Chromium taints the canvas when an SVG containing <foreignObject> (which
    // mermaid emits for HTML labels) is drawn from a blob: URL, and toBlob then
    // throws a SecurityError — a data: URL image stays untainted, so it is
    // load-bearing here, not a stylistic choice.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  // onload can fire before the bitmap is fully decoded in some engines; decode()
  // guarantees drawImage sees pixels. Its (rare, spurious for SVG) rejection is
  // ignored because the load above already succeeded.
  if (typeof image.decode === 'function') await image.decode().catch(() => undefined)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is not available')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((pngBlob) => {
      if (pngBlob) resolve(pngBlob)
      else reject(new Error('Failed to encode the PNG'))
    }, 'image/png')
  })
}

export const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const isClipboardImageSupported = (): boolean =>
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.clipboard &&
  typeof navigator.clipboard.write === 'function'

export const copyPngToClipboard = (png: Promise<Blob>): Promise<void> => {
  if (!isClipboardImageSupported())
    throw new Error('Copying images to the clipboard is not supported in this browser')
  // The ClipboardItem must be constructed synchronously around the pending
  // promise (not awaited first) — Safari only permits clipboard writes
  // initiated within the original user-gesture call stack.
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

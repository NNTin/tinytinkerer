// A raw (unencoded) SVG data URI: `data:image/svg+xml,<svg …>`. The raw form
// contains literal `<…>` markup and spaces. Those break `<img>` rendering, so the
// renderers detect this shape and mount the markup as sanitized INLINE SVG instead.
// The markdown parser also normalizes partially percent-encoded SVG data URIs with
// literal URL-breaking characters into this raw shape so they take the same
// sanitizing render path.
const RAW_SVG_DATA_URI = /^data:image\/svg\+xml,\s*<svg[\s>]/i

export const isRawSvgDataUri = (url: string): boolean => RAW_SVG_DATA_URI.test(url)

// Strip the `data:image/svg+xml,` prefix to recover the raw `<svg …>` markup. The
// body is NOT percent-encoded for the raw form, so it is returned verbatim (callers
// MUST sanitize it before it touches the DOM).
export const rawSvgMarkupFromDataUri = (url: string): string => {
  const commaIndex = url.indexOf(',')
  return commaIndex === -1 ? '' : url.slice(commaIndex + 1)
}

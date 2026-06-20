import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  InlineSvg,
  isRawSvgDataUri,
  rawSvgMarkupFromDataUri,
  sanitizeSvgMarkup,
  type ContentNodeRendererProps,
  type ImageNode,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'

const SVG_DATA_URI_PREFIX = 'data:image/svg+xml,'

const captionFor = (node: ImageNode): string | null => {
  if (node.title && node.title.trim().length > 0) {
    return node.title
  }
  if (node.alt && node.alt.trim().length > 0) {
    return node.alt
  }
  return null
}

const filenameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url, 'http://placeholder.local')
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    return last && last.length > 0 ? last : 'image'
  } catch {
    return 'image'
  }
}

export const ImageNodeRenderer = ({ node }: ContentNodeRendererProps<ImageNode>) => {
  const [open, setOpen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const caption = captionFor(node)

  // A raw `data:image/svg+xml,<svg …>` data URI can't ride in an `<img src>` (the
  // unencoded markup/spaces break it), so render it as sanitized inline SVG instead.
  const rawSvg = isRawSvgDataUri(node.url)
  // For the lightbox links (Open/Download) a raw data URI with literal `<…>` is not a
  // valid URL; re-encode the sanitized markup so those links still resolve safely.
  const linkUrl = useMemo(() => {
    if (!rawSvg) return node.url
    return `${SVG_DATA_URI_PREFIX}${encodeURIComponent(sanitizeSvgMarkup(rawSvgMarkupFromDataUri(node.url)))}`
  }, [rawSvg, node.url])

  const handleOpen = useCallback(() => {
    setZoomed(false)
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setZoomed(false)
  }, [])

  const toggleZoom = useCallback(() => {
    setZoomed((current) => !current)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, handleClose])

  return (
    <figure data-tt-image="" className="my-3 flex max-w-full flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={caption ? `Open ${caption}` : 'Open image'}
        className="block max-w-full overflow-hidden rounded-md border border-stone-200 bg-stone-50 transition-shadow hover:shadow"
      >
        {rawSvg ? (
          <InlineSvg
            markup={rawSvgMarkupFromDataUri(node.url)}
            className="block max-h-[420px] max-w-full overflow-hidden [&>svg]:block [&>svg]:max-h-[420px] [&>svg]:max-w-full"
          />
        ) : (
          <img
            src={node.url}
            alt={node.alt}
            title={node.title}
            loading="lazy"
            decoding="async"
            className="block max-h-[420px] max-w-full object-contain"
          />
        )}
      </button>
      {caption ? <figcaption className="text-[12px] text-stone-500">{caption}</figcaption> : null}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={caption ? `Image: ${caption}` : 'Image preview'}
          data-tt-image-lightbox=""
          className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4"
          onClick={handleClose}
        >
          <div
            className="flex items-center justify-end gap-2 pb-2 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={toggleZoom}
              aria-pressed={zoomed}
              className="rounded bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
            >
              {zoomed ? 'Fit' : 'Zoom'}
            </button>
            <a
              href={linkUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
            >
              Open
            </a>
            <a
              href={linkUrl}
              download={rawSvg ? 'image.svg' : filenameFromUrl(node.url)}
              className="rounded bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
            >
              Download
            </a>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close image preview"
              className="rounded bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <div
            className="flex flex-1 items-center justify-center overflow-auto"
            onClick={(event) => event.stopPropagation()}
          >
            {rawSvg ? (
              <InlineSvg
                markup={rawSvgMarkupFromDataUri(node.url)}
                className={
                  zoomed
                    ? '[&>svg]:max-w-none [&>svg]:cursor-zoom-out'
                    : 'flex max-h-full max-w-full items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full [&>svg]:cursor-zoom-in'
                }
              />
            ) : (
              <img
                src={node.url}
                alt={node.alt}
                title={node.title}
                className={
                  zoomed
                    ? 'max-w-none cursor-zoom-out'
                    : 'max-h-full max-w-full cursor-zoom-in object-contain'
                }
                onClick={toggleZoom}
              />
            )}
          </div>
        </div>
      ) : null}
    </figure>
  )
}

export const createImagePlugin = (): ReactNodeRendererPlugin<'image'> => ({
  id: 'image',
  nodeType: 'image',
  priority: 10,
  requirements: { clientOnly: true },
  render: (node) => <ImageNodeRenderer node={node} />
})

export const imagePlugin: ReactNodeRendererPlugin<'image'> = createImagePlugin()

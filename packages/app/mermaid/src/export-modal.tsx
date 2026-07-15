import { useDialogEscape, useDialogFocus } from '@tinytinkerer/app-shell'
import { renderMermaidSource, type MermaidRenderTheme } from '@tinytinkerer/content-mermaid'
import { useEffect, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  copyPngToClipboard,
  defaultExportFilename,
  downloadBlob,
  isClipboardImageSupported,
  prepareExportSvg,
  rasterizeSvgToPng,
  sanitizeExportFilename,
  SOLID_BACKGROUND_COLOR,
  type MermaidExportBackground,
  type MermaidExportFormat
} from './export'

export type MermaidExportModalProps = {
  source: string
  onClose: () => void
}

let previewIdCounter = 0

type ExportStatus = 'idle' | 'exporting' | 'copied'

const FORMAT_LABEL: Record<MermaidExportFormat, string> = {
  png: 'Export PNG',
  svg: 'Export SVG',
  clipboard: 'Copy to clipboard'
}

const ExportModal = ({ source, onClose }: MermaidExportModalProps): React.JSX.Element => {
  const [format, setFormat] = useState<MermaidExportFormat>('png')
  const [background, setBackground] = useState<MermaidExportBackground>('transparent')
  const [darkMode, setDarkMode] = useState(false)
  const [filename, setFilename] = useState(() => defaultExportFilename())
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [error, setError] = useState('')
  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [rendering, setRendering] = useState(true)

  const dialogRef = useDialogFocus(true)
  useDialogEscape(true, onClose)

  useEffect(() => {
    let cancelled = false
    if (source.trim().length === 0) {
      setPreviewSvg(null)
      setPreviewError('')
      setRendering(false)
      return
    }
    setRendering(true)
    const theme: MermaidRenderTheme = darkMode ? 'dark' : 'default'
    void renderMermaidSource(source, `tt-mermaid-export-${++previewIdCounter}`, { theme }).then(
      (result) => {
        if (cancelled) return
        setPreviewSvg(result.svg)
        setPreviewError('')
        setRendering(false)
      },
      (renderError) => {
        if (cancelled) return
        setPreviewSvg(null)
        setPreviewError(renderError instanceof Error ? renderError.message : String(renderError))
        setRendering(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, darkMode])

  // A stale success/error message would misdescribe the next export once any
  // control changes; clear it as soon as the configuration diverges.
  useEffect(() => {
    setStatus((current) => (current === 'copied' ? 'idle' : current))
    setError('')
  }, [format, background, darkMode, filename])

  const theme: MermaidRenderTheme = darkMode ? 'dark' : 'default'

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  const handleExport = async () => {
    if (!previewSvg) return
    setError('')
    setStatus('exporting')
    try {
      const prepared = prepareExportSvg(previewSvg, { background, theme })
      const name = sanitizeExportFilename(filename) || defaultExportFilename()
      if (format === 'svg') {
        downloadBlob(
          `${name}.svg`,
          new Blob([prepared.svg], { type: 'image/svg+xml;charset=utf-8' })
        )
        setStatus('idle')
        onClose()
        return
      }
      if (format === 'png') {
        const png = await rasterizeSvgToPng(prepared.svg, prepared.width, prepared.height)
        downloadBlob(`${name}.png`, png)
        setStatus('idle')
        onClose()
        return
      }
      // Construct the pending PNG promise synchronously so copyPngToClipboard can
      // build its ClipboardItem within the click's user-gesture call stack.
      await copyPngToClipboard(rasterizeSvgToPng(prepared.svg, prepared.width, prepared.height))
      setStatus('copied')
    } catch (exportError) {
      setStatus('idle')
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    }
  }

  const actionDisabled =
    rendering || status === 'exporting' || previewError.length > 0 || source.trim().length === 0
  const clipboardSupported = isClipboardImageSupported()
  const extension = format === 'svg' ? '.svg' : '.png'

  return createPortal(
    <div className="mermaid-export-backdrop" onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className="mermaid-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mermaid-export-title"
        tabIndex={-1}
      >
        <h2 id="mermaid-export-title">Export diagram</h2>
        <div className="mermaid-export-preview">
          <div
            className="mermaid-export-frame"
            style={{
              background: background === 'solid' ? SOLID_BACKGROUND_COLOR[theme] : 'transparent'
            }}
          >
            {previewError ? (
              <p role="alert" className="mermaid-export-error">
                {previewError}
              </p>
            ) : previewSvg ? (
              <div dangerouslySetInnerHTML={{ __html: previewSvg }} />
            ) : (
              <p>{rendering ? 'Rendering preview…' : 'Write Mermaid syntax to begin.'}</p>
            )}
          </div>
        </div>
        <p className="mermaid-export-preview-note">
          Checkered padding is preview-only and is not exported.
        </p>
        <div className="mermaid-export-controls">
          <fieldset className="mermaid-export-format">
            <legend>Format</legend>
            <label>
              <input
                type="radio"
                name="mermaid-export-format"
                value="png"
                checked={format === 'png'}
                onChange={() => setFormat('png')}
              />
              PNG
            </label>
            <label>
              <input
                type="radio"
                name="mermaid-export-format"
                value="svg"
                checked={format === 'svg'}
                onChange={() => setFormat('svg')}
              />
              SVG
            </label>
            <label
              title={
                clipboardSupported
                  ? undefined
                  : 'Copying images to the clipboard is not supported in this browser'
              }
            >
              <input
                type="radio"
                name="mermaid-export-format"
                value="clipboard"
                checked={format === 'clipboard'}
                disabled={!clipboardSupported}
                onChange={() => setFormat('clipboard')}
              />
              Copy to clipboard (PNG)
            </label>
          </fieldset>
          <label className="mermaid-export-checkbox">
            <input
              type="checkbox"
              checked={background === 'transparent'}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setBackground(event.target.checked ? 'transparent' : 'solid')
              }
            />
            Transparent background
          </label>
          <label className="mermaid-export-checkbox">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setDarkMode(event.target.checked)}
            />
            Dark mode
          </label>
          <label className="mermaid-export-filename">
            Filename
            <span className="mermaid-export-filename-row">
              <input
                type="text"
                value={filename}
                disabled={format === 'clipboard'}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setFilename(event.target.value)}
              />
              <span className="mermaid-export-extension">{extension}</span>
            </span>
          </label>
        </div>
        <div className="mermaid-export-footer">
          <span className="mermaid-export-status">
            {error ? (
              <span role="alert" className="mermaid-export-error">
                {error}
              </span>
            ) : status === 'copied' ? (
              'Copied to clipboard.'
            ) : (
              ''
            )}
          </span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="mermaid-export-primary"
            disabled={actionDisabled}
            onClick={() => void handleExport()}
          >
            {FORMAT_LABEL[format]}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ExportModal

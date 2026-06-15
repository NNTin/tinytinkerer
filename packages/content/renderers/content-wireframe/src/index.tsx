import {
  CodeBlockFallback,
  PreviewCodeFrame,
  type CodeBlockNode,
  type ContentNodeRendererProps,
  type ReactNodeRendererPlugin,
} from '@tinytinkerer/content-react'

// Content-Security-Policy enforced inside the wireframe preview document. The
// HTML is LLM-authored (semi-trusted), so even though the iframe runs at an
// opaque origin with no scripts (see WIREFRAME_SANDBOX), this blocks the
// resource-load egress vectors a mockup never needs: remote stylesheets,
// tracking pixels, web fonts, and beacons. Inline <style>/style="" is allowed so
// mockups still look right; images/fonts are limited to inline data: URIs.
// `form-action 'none'` blocks form-submission egress, `base-uri 'none'` stops a
// <base> from redirecting relative URLs, and `navigate-to 'none'` is a
// best-effort block on navigations (Chromium-only; the directive was dropped from
// the CSP spec, so browsers without it ignore it). Residual vector: a document
// without `navigate-to` support can still navigate ITSELF via an <a href> click or
// a <meta http-equiv="refresh">, which is a GET to the URL the author hard-coded.
// That is bounded — no scripts run and the origin is opaque with no referrer, so
// nothing dynamic can be exfiltrated — but it is not fully preventable by CSP here.
const WIREFRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; navigate-to 'none'"

// Sandbox flags for the preview iframe. Deliberately EMPTY (no allow-scripts, no
// allow-same-origin): a layout mockup needs no JS, and dropping scripts is the
// strongest mitigation against LLM-authored HTML calling fetch()/beacon or
// mining from the user's browser. An empty sandbox still renders HTML/CSS.
const WIREFRAME_SANDBOX = ''

// Wraps the LLM-authored HTML in a minimal document whose <head> carries the
// CSP meta first, so the policy applies to the whole document regardless of what
// markup the wireframe itself contains. Any doctype/html/head/body tags inside
// the wireframe are flattened by the parser into this body — fine for a mockup.
const buildWireframeDocument = (code: string): string =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${WIREFRAME_CSP}"></head><body>${code}</body></html>`

export const WireframeNodeRenderer = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => {
  if (!node.code.trim()) {
    return <CodeBlockFallback code={node.code} language={node.language ?? 'wireframe'} />
  }

  return (
    <PreviewCodeFrame
      containerProps={{ 'data-tt-wireframe': '' }}
      headerStart={
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">Wireframe</span>
        </div>
      }
      code={node.code}
      codeLanguage="html"
      preview={
        <iframe
          srcDoc={buildWireframeDocument(node.code)}
          title="Wireframe preview"
          sandbox={WIREFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          className="h-64 w-full border-0 bg-white"
        />
      }
    />
  )
}

export const createWireframePlugin = (): ReactNodeRendererPlugin<'codeBlock'> => ({
  id: 'wireframe',
  nodeType: 'codeBlock',
  priority: 40,
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'wireframe',
  render: (node) => <WireframeNodeRenderer node={node} />,
  fallback: (node) => <CodeBlockFallback code={node.code} language={node.language ?? 'wireframe'} />
})

export const wireframePlugin: ReactNodeRendererPlugin<'codeBlock'> = createWireframePlugin()

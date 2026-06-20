import DOMPurify from 'dompurify'

// Shared, hardened SVG sanitization policy. Both the mermaid renderer (which
// sanitizes the SVG the mermaid library produces) and the image renderer (which
// renders raw `data:image/svg+xml,<svg …>` data URIs as inline SVG) route their
// markup through this one helper so the security policy is defined in a single
// place and never forks.
//
// The policy keeps the SVG profile (and SVG filters) while ADDING the small set of
// HTML tags mermaid emits inside `foreignObject` for node labels — DOMPurify would
// otherwise strip every HTML child of an SVG element, deleting those labels. The
// HTML_INTEGRATION_POINTS hint tells DOMPurify that `foreignObject` is a legitimate
// HTML integration point so its `div`/`span`/`p` children survive. Scripts, event
// handlers (`onload=…`), and external references are still removed: this is an XSS
// surface for both LLM-authored mermaid output and raw inline SVG.
export const sanitizeSvgMarkup = (svg: string): string =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['foreignObject', 'div', 'span', 'p', 'br'],
    // foreignObject is an HTML integration point in SVG; without this, DOMPurify
    // rejects all HTML children (div, span, p) inside it, stripping node labels from
    // flowchart and class diagrams entirely.
    HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true }
  })

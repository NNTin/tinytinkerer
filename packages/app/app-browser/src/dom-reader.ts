import type {
  DomNodeResult,
  DomQuery,
  DomReader,
  DomReadResult
} from '@tinytinkerer/app-core'

// Resource ceilings the host enforces regardless of what a plugin requests.
// These are the browser-side guardrails behind the product-agnostic DomReader
// contract: a caller may ask for fewer nodes / shorter payloads, never more.
const DEFAULT_MAX_NODES = 25
const HARD_MAX_NODES = 100
const DEFAULT_MAX_CHARS = 4_000
const HARD_MAX_CHARS = 20_000

// What a selector query serializes per node when the caller does not ask for a
// specific set. `html` is intentionally NOT a default — it is the largest field,
// so a caller opts into it explicitly (e.g. to inspect a rendered SVG) to keep
// the model's context lean.
const DEFAULT_INCLUDE: ReadonlyArray<'html' | 'text' | 'attributes' | 'rect'> = [
  'text',
  'attributes',
  'rect'
]

const clamp = (value: number | undefined, fallback: number, hardMax: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.min(Math.floor(value), hardMax)
}

const cap = (text: string, maxChars: number): { value: string; truncated: boolean } =>
  text.length > maxChars
    ? { value: `${text.slice(0, maxChars)} …[truncated]`, truncated: true }
    : { value: text, truncated: false }

const classList = (element: Element): string[] | undefined => {
  const classes = Array.from(element.classList)
  return classes.length > 0 ? classes : undefined
}

// Names of attributes that can carry content the user typed but has not sent.
const REDACTED_ATTRS = new Set(['value', 'checked'])

// Returns a detached, redacted copy of `element` so its serialized form never
// leaks form-field content. We only ever read attributes / outerHTML / textContent
// (never the live `.value` property), and this strips the `value`/`checked`
// attributes from every form field in the subtree and fully blanks password
// inputs and textarea defaults. Exported so the redaction is unit-testable.
export const redactFormValues = (element: Element): Element => {
  const clone = element.cloneNode(true) as Element
  const fields: Element[] = [clone, ...Array.from(clone.querySelectorAll('input, textarea, select'))]
  for (const node of fields) {
    const tag = node.tagName.toLowerCase()
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      continue
    }
    for (const attr of REDACTED_ATTRS) {
      node.removeAttribute(attr)
    }
    if (tag === 'textarea') {
      // The default text content of a textarea is its initial value — blank it
      // so a serialized payload never carries pre-filled text.
      node.textContent = ''
    }
    if (tag === 'input' && (node.getAttribute('type') ?? '').toLowerCase() === 'password') {
      node.setAttribute('type', 'password')
      node.setAttribute('value', '[redacted]')
    }
  }
  return clone
}

const readAttributes = (
  redacted: Element,
  maxChars: number
): Record<string, string> => {
  const attributes: Record<string, string> = {}
  for (const attr of Array.from(redacted.attributes)) {
    attributes[attr.name] = cap(attr.value, maxChars).value
  }
  return attributes
}

const serializeNode = (
  element: Element,
  include: ReadonlyArray<'html' | 'text' | 'attributes' | 'rect'>,
  maxChars: number
): DomNodeResult => {
  const redacted = redactFormValues(element)
  const node: DomNodeResult = { tag: element.tagName.toLowerCase() }

  if (element.id) {
    node.id = element.id
  }
  const classes = classList(element)
  if (classes) {
    node.classes = classes
  }

  let truncated = false

  if (include.includes('html')) {
    const { value, truncated: cut } = cap(redacted.outerHTML, maxChars)
    node.html = value
    truncated = truncated || cut
  }
  if (include.includes('text')) {
    const { value, truncated: cut } = cap(redacted.textContent ?? '', maxChars)
    node.text = value
    truncated = truncated || cut
  }
  if (include.includes('attributes')) {
    node.attributes = readAttributes(redacted, maxChars)
  }
  if (include.includes('rect')) {
    const rect = element.getBoundingClientRect()
    node.rect = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0
    }
  }

  if (truncated) {
    node.truncated = true
  }
  return node
}

// Shallow outline of the body's child elements (tag/id/classes only) returned
// when no selector is supplied, so a caller can orient before drilling in.
const outlineBodyChildren = (maxNodes: number): { nodes: DomNodeResult[]; matchedCount: number } => {
  const body = document.body
  if (!body) {
    return { nodes: [], matchedCount: 0 }
  }
  const children = Array.from(body.children)
  const nodes = children.slice(0, maxNodes).map((child) => {
    const node: DomNodeResult = { tag: child.tagName.toLowerCase() }
    if (child.id) {
      node.id = child.id
    }
    const classes = classList(child)
    if (classes) {
      node.classes = classes
    }
    return node
  })
  return { nodes, matchedCount: children.length }
}

const pageMeta = (): { url: string; title: string; viewport: { width: number; height: number } } => ({
  url: typeof location !== 'undefined' ? location.href : '',
  title: document.title,
  viewport: { width: window.innerWidth, height: window.innerHeight }
})

const unavailable: DomReadResult = {
  url: '',
  title: '',
  viewport: { width: 0, height: 0 },
  matchedCount: 0,
  nodes: [],
  truncated: false
}

// Builds the host's DOM-read capability. It reads the current page (this shell's
// own document — never a cross-origin or sandboxed iframe) via a narrow query,
// caps the payload, and redacts form-field values before returning. The plugin
// stays product-agnostic and only describes what to read; all DOM access lives
// here. Mirrors createSandboxExecutor.
export const createDomReader = (): DomReader => {
  return (query: DomQuery): Promise<DomReadResult> => {
    if (typeof document === 'undefined') {
      return Promise.resolve(unavailable)
    }

    const maxNodes = clamp(query.maxNodes, DEFAULT_MAX_NODES, HARD_MAX_NODES)
    const maxChars = clamp(query.maxChars, DEFAULT_MAX_CHARS, HARD_MAX_CHARS)
    const meta = pageMeta()

    // No selector → page meta plus a shallow outline of the body's children.
    if (!query.selector) {
      const { nodes, matchedCount } = outlineBodyChildren(maxNodes)
      return Promise.resolve({
        ...meta,
        matchedCount,
        nodes,
        truncated: matchedCount > nodes.length
      })
    }

    let matches: Element[]
    try {
      matches = Array.from(document.querySelectorAll(query.selector))
    } catch {
      // Invalid selector: report zero matches rather than throwing, so a bad
      // selector from the model is a graceful empty result the agent can correct.
      return Promise.resolve({ ...meta, matchedCount: 0, nodes: [], truncated: false })
    }

    const include = query.include && query.include.length > 0 ? query.include : DEFAULT_INCLUDE
    const selected = matches.slice(0, maxNodes)
    const nodes = selected.map((element) => serializeNode(element, include, maxChars))
    const truncated = matches.length > nodes.length || nodes.some((node) => node.truncated)

    return Promise.resolve({
      ...meta,
      matchedCount: matches.length,
      nodes,
      truncated
    })
  }
}

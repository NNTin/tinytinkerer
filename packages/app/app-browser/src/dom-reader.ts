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

// Outline / subtree ceilings. The outline is depth- and breadth-bounded so a deep
// app tree can never produce an unbounded payload: at most TREE_NODE_BUDGET nodes
// total, at most TREE_CHILD_CAP children expanded per node.
const DEFAULT_OUTLINE_DEPTH = 4
const MAX_DEPTH = 8
const TREE_CHILD_CAP = 25
const TREE_NODE_BUDGET = 400
const TEXT_PREVIEW_CHARS = 80

const TEXT_NODE = 3
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea'])
const FORM_FIELD_TAGS = new Set(['input', 'textarea', 'select'])

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

// The collapsed text held directly in an element's own immediate text nodes (not
// its descendants'). Used to detect "content" elements and to build outline
// previews. Exported for testing.
export const directText = (element: Element): string => {
  let text = ''
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      text += child.nodeValue ?? ''
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

// Direct-text preview for an outline node. Form fields are skipped so a textarea's
// pre-filled default value is never previewed, and the preview is length-capped.
const directTextPreview = (element: Element): string => {
  if (FORM_FIELD_TAGS.has(element.tagName.toLowerCase())) {
    return ''
  }
  const text = directText(element)
  return text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…` : text
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
    if (!FORM_FIELD_TAGS.has(tag)) {
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

// Absolute vertical position of an element on the page (document-relative, so it
// is stable regardless of scroll), used to order region queries top↔bottom.
const absoluteTop = (element: Element): number => {
  const rect = element.getBoundingClientRect()
  const scroll =
    typeof window !== 'undefined' ? window.scrollY || window.pageYOffset || 0 : 0
  return rect.top + scroll
}

// A rendered element that carries its own content — has a layout box and either
// its own direct text or is an interactive control. These are the elements worth
// surfacing for a "what's at the top/bottom" question; pure layout wrappers are
// skipped so the agent sees labels and controls, not nested containers.
const isRenderedContent = (element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return false
  }
  if (INTERACTIVE_TAGS.has(element.tagName.toLowerCase())) {
    return true
  }
  return directText(element).length > 0
}

// Serializes one matched element to plain data. When `depth > 0`, its descendants
// are nested as `children` (bounded by TREE_CHILD_CAP per node and the shared node
// `budget`). Redaction and per-field caps apply at every level.
const serializeNode = (
  element: Element,
  include: ReadonlyArray<'html' | 'text' | 'attributes' | 'rect'>,
  maxChars: number,
  depth: number,
  budget: { remaining: number }
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

  const childElements = Array.from(element.children)
  if (childElements.length > 0) {
    node.childCount = childElements.length
  }
  if (depth > 0 && childElements.length > 0) {
    const capped = childElements.slice(0, TREE_CHILD_CAP)
    if (childElements.length > capped.length) {
      truncated = true
    }
    const children: DomNodeResult[] = []
    for (const child of capped) {
      if (budget.remaining <= 0) {
        truncated = true
        break
      }
      budget.remaining -= 1
      children.push(serializeNode(child, include, maxChars, depth - 1, budget))
    }
    if (children.length > 0) {
      node.children = children
    }
  }

  if (truncated) {
    node.truncated = true
  }
  return node
}

// A lean outline node: structure (tag/id/classes/childCount) plus a short direct-
// text preview, recursed to `depth`. No html/attributes — the outline is a map the
// agent reads to pick a precise selector, not a content dump.
const buildOutlineNode = (
  element: Element,
  depth: number,
  budget: { remaining: number }
): DomNodeResult => {
  const node: DomNodeResult = { tag: element.tagName.toLowerCase() }
  if (element.id) {
    node.id = element.id
  }
  const classes = classList(element)
  if (classes) {
    node.classes = classes
  }
  const preview = directTextPreview(element)
  if (preview) {
    node.text = preview
  }

  const childElements = Array.from(element.children)
  if (childElements.length > 0) {
    node.childCount = childElements.length
  }

  let truncated = false
  if (depth > 0 && childElements.length > 0) {
    const capped = childElements.slice(0, TREE_CHILD_CAP)
    if (childElements.length > capped.length) {
      truncated = true
    }
    const children: DomNodeResult[] = []
    for (const child of capped) {
      if (budget.remaining <= 0) {
        truncated = true
        break
      }
      budget.remaining -= 1
      const built = buildOutlineNode(child, depth - 1, budget)
      children.push(built)
      if (built.truncated) {
        truncated = true
      }
    }
    if (children.length > 0) {
      node.children = children
    }
  }

  if (truncated) {
    node.truncated = true
  }
  return node
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

const resolveInclude = (
  include: DomQuery['include']
): ReadonlyArray<'html' | 'text' | 'attributes' | 'rect'> =>
  include && include.length > 0 ? include : DEFAULT_INCLUDE

// Builds the host's DOM-read capability. It reads the current page (this shell's
// own document — never a cross-origin or sandboxed iframe), caps the payload, and
// redacts form-field values before returning. The plugin stays product-agnostic
// and only describes what to read; all DOM access lives here. The query resolves
// to one of three modes — region (position-ordered), outline (no selector), or
// selector (optionally with a nested subtree). Mirrors createSandboxExecutor.
export const createDomReader = (): DomReader => {
  return (query: DomQuery): Promise<DomReadResult> => {
    if (typeof document === 'undefined') {
      return Promise.resolve(unavailable)
    }

    const maxNodes = clamp(query.maxNodes, DEFAULT_MAX_NODES, HARD_MAX_NODES)
    const maxChars = clamp(query.maxChars, DEFAULT_MAX_CHARS, HARD_MAX_CHARS)
    const meta = pageMeta()

    // Region mode → rendered content elements ordered by where they sit on the
    // page, so "what's at the bottom/top" works without guessing a selector.
    if (query.region) {
      let candidates: Element[]
      try {
        candidates = Array.from(document.querySelectorAll(query.selector ?? '*'))
      } catch {
        return Promise.resolve({ ...meta, matchedCount: 0, nodes: [], truncated: false })
      }
      const region = query.region
      const visible = candidates
        .filter(isRenderedContent)
        .sort((a, b) =>
          region === 'bottom' ? absoluteTop(b) - absoluteTop(a) : absoluteTop(a) - absoluteTop(b)
        )
      // Always surface position + text so the agent sees where each element sits.
      const include = Array.from(
        new Set<'html' | 'text' | 'attributes' | 'rect'>([
          ...resolveInclude(query.include),
          'rect',
          'text'
        ])
      )
      const budget = { remaining: TREE_NODE_BUDGET }
      const nodes = visible
        .slice(0, maxNodes)
        .map((element) => serializeNode(element, include, maxChars, 0, budget))
      return Promise.resolve({
        ...meta,
        matchedCount: visible.length,
        nodes,
        truncated: visible.length > nodes.length || nodes.some((node) => node.truncated)
      })
    }

    // No selector → depth-limited structural outline of the page tree, so one call
    // reveals the real subtree (e.g. under a SPA's #root) instead of just the body.
    if (!query.selector) {
      const body = document.body
      if (!body) {
        return Promise.resolve({ ...meta, matchedCount: 0, nodes: [], truncated: false })
      }
      const depth = clamp(query.depth, DEFAULT_OUTLINE_DEPTH, MAX_DEPTH)
      const childElements = Array.from(body.children)
      const topLevel = childElements.slice(0, maxNodes)
      const budget = { remaining: TREE_NODE_BUDGET }
      let truncated = childElements.length > topLevel.length
      const nodes: DomNodeResult[] = []
      for (const child of topLevel) {
        if (budget.remaining <= 0) {
          truncated = true
          break
        }
        budget.remaining -= 1
        const built = buildOutlineNode(child, depth, budget)
        nodes.push(built)
        if (built.truncated) {
          truncated = true
        }
      }
      return Promise.resolve({ ...meta, matchedCount: childElements.length, nodes, truncated })
    }

    // Selector → matched elements, optionally with their descendants nested to depth.
    let matches: Element[]
    try {
      matches = Array.from(document.querySelectorAll(query.selector))
    } catch {
      // Invalid selector: report zero matches rather than throwing, so a bad
      // selector from the model is a graceful empty result the agent can correct.
      return Promise.resolve({ ...meta, matchedCount: 0, nodes: [], truncated: false })
    }

    const include = resolveInclude(query.include)
    const depth = clamp(query.depth, 0, MAX_DEPTH)
    const budget = { remaining: TREE_NODE_BUDGET }
    const nodes = matches
      .slice(0, maxNodes)
      .map((element) => serializeNode(element, include, maxChars, depth, budget))
    const truncated = matches.length > nodes.length || nodes.some((node) => node.truncated)

    return Promise.resolve({
      ...meta,
      matchedCount: matches.length,
      nodes,
      truncated
    })
  }
}

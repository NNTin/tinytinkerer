import type { DomNodeResult, DomQuery, DomReader, DomReadResult } from '@tinytinkerer/app-core'

// Resource ceilings the host enforces regardless of what a plugin requests.
// These are the browser-side guardrails behind the product-agnostic DomReader
// contract: a caller may ask for fewer nodes / shorter payloads, never more.
const DEFAULT_MAX_NODES = 25
const HARD_MAX_NODES = 100
const DEFAULT_MAX_CHARS = 4_000
const HARD_MAX_CHARS = 20_000
// Hard ceiling on how many attributes a single node serializes, so an element
// with hundreds of data-*/aria-* attributes can't produce an unbounded map.
const MAX_ATTRS = 60

// Outline / subtree ceilings. The outline is depth- and breadth-bounded so a deep
// app tree can never produce an unbounded payload: at most TREE_NODE_BUDGET nodes
// total, at most TREE_CHILD_CAP children expanded per node.
const DEFAULT_OUTLINE_DEPTH = 4
const MAX_DEPTH = 8
const TREE_CHILD_CAP = 25
const TREE_NODE_BUDGET = 400
const TEXT_PREVIEW_CHARS = 80

// Guardrails for the full DOM snapshot (the shared variable handed to the code-exec
// sandbox). Unlike a read_dom query, the snapshot is the whole sanitized body tree,
// so these are its only size bounds: at most MAX_SNAPSHOT_NODES nodes total, at most
// MAX_SNAPSHOT_DEPTH levels deep, and each text/attribute value capped at
// MAX_SNAPSHOT_FIELD_CHARS. All are generous (a real app page is well under them) but
// finite, so a pathological document can never produce an unbounded payload — or
// (via the depth cap on the recursive walk) overflow the stack — across the boundary.
const MAX_SNAPSHOT_NODES = 20_000
// Well above any real DOM nesting (apps rarely exceed ~50) yet far below the JS call
// stack limit, so the recursive walk can't overflow on a deeply-nested/adversarial
// page. Node count alone does NOT bound depth: a single deep chain is few nodes.
const MAX_SNAPSHOT_DEPTH = 256
const MAX_SNAPSHOT_FIELD_CHARS = 50_000

// Elements whose text/markup is never page content the agent computes over, and
// which routinely embed app config or secrets (inline JS, JSON data islands such as
// Next.js' #__NEXT_DATA__, CSS, escaped markup). The snapshot emits them as opaque
// structural nodes — tag/id/classes only, never their text, attributes, or
// children — so nothing inside them crosses into the sandbox.
const SNAPSHOT_OPAQUE_TAGS = new Set(['script', 'style', 'noscript', 'template'])

const TEXT_NODE = 3
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea'])
const FORM_FIELD_TAGS = new Set(['input', 'textarea', 'select'])
// contenteditable attribute values that make an element user-editable.
const EDITABLE_VALUES = new Set(['', 'true', 'plaintext-only'])

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

// Like clamp but for `depth`, where 0 is a meaningful value (a flat result) and
// must be distinguished from "not provided". Only an absent/invalid depth falls
// back to the default.
const resolveDepth = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return Math.min(Math.floor(value), MAX_DEPTH)
}

const cap = (text: string, maxChars: number): { value: string; truncated: boolean } =>
  text.length > maxChars
    ? { value: `${text.slice(0, maxChars)} …[truncated]`, truncated: true }
    : { value: text, truncated: false }

const classList = (element: Element): string[] | undefined => {
  const classes = Array.from(element.classList)
  return classes.length > 0 ? classes : undefined
}

const isEditable = (element: Element): boolean =>
  EDITABLE_VALUES.has((element.getAttribute('contenteditable') ?? ' ').toLowerCase())

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

// Direct-text preview for an outline node. Form fields and contenteditable
// regions are skipped so a textarea's pre-filled default or a rich-text composer's
// unsent draft is never previewed, and the preview is length-capped.
const directTextPreview = (element: Element): string => {
  if (FORM_FIELD_TAGS.has(element.tagName.toLowerCase()) || isEditable(element)) {
    return ''
  }
  const text = directText(element)
  return text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…` : text
}

// Names of attributes that can carry content the user typed but has not sent.
const REDACTED_ATTRS = ['value', 'checked']

// Redacts one element of the (detached) clone in place: drops inline event
// handlers and iframe `srcdoc` (minimal-exposure hardening — they can embed app
// secrets or whole documents), strips form-field values, blanks a textarea's
// default and a contenteditable region's text, redacts a password value, and
// removes a <select>'s current selection.
const redactElement = (node: Element): void => {
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on') || name === 'srcdoc') {
      node.removeAttribute(attr.name)
    }
  }
  const tag = node.tagName.toLowerCase()
  if (FORM_FIELD_TAGS.has(tag)) {
    for (const attr of REDACTED_ATTRS) {
      node.removeAttribute(attr)
    }
    if (tag === 'textarea') {
      // The default text content of a textarea is its initial value — blank it
      // so a serialized payload never carries pre-filled text.
      node.textContent = ''
    }
    if (tag === 'input' && (node.getAttribute('type') ?? '').toLowerCase() === 'password') {
      node.setAttribute('value', '[redacted]')
    }
  } else if (tag === 'option') {
    // The selected option is the <select>'s current value (the user's choice).
    // Drop it; option labels themselves are page-author content and stay.
    node.removeAttribute('selected')
  } else if (isEditable(node)) {
    // Rich-text / contenteditable composers hold text the user typed but has not
    // sent — withhold it like a textarea's default.
    node.textContent = '[redacted]'
  }
}

// Returns a detached, redacted copy of `element`. `deep` controls whether the
// whole subtree is cloned + redacted (needed when serializing `html`/`text`) or
// only the element itself (enough for `attributes`). We only ever read
// attributes / outerHTML / textContent (never the live `.value` property), so the
// per-element redaction above is sufficient. Exported so redaction is testable.
export const redactClone = (element: Element, deep: boolean): Element => {
  const clone = element.cloneNode(deep) as Element
  if (deep) {
    redactElement(clone)
    for (const node of Array.from(clone.querySelectorAll('*'))) {
      redactElement(node)
    }
  } else {
    redactElement(clone)
  }
  return clone
}

// Back-compat alias: a deep redacted clone.
export const redactFormValues = (element: Element): Element => redactClone(element, true)

const readAttributes = (redacted: Element, maxChars: number): Record<string, string> => {
  const attributes: Record<string, string> = {}
  let count = 0
  for (const attr of Array.from(redacted.attributes)) {
    if (count >= MAX_ATTRS) {
      break
    }
    attributes[attr.name] = cap(attr.value, maxChars).value
    count += 1
  }
  return attributes
}

// One node of the full sanitized DOM snapshot — the shared structure handed to the
// code-exec sandbox as its `dom` binding. Mirrors DomNodeResult's shape (minus
// rect/childCount), built from a fully-redacted clone of the page <body> subtree.
// `text` is the node's OWN direct text (not its subtree's — descendants come from
// `children`), per-field-capped, and `truncated` flags any node where the field
// cap, the per-node child budget, OR a descendant's truncation applied. Host-
// internal: passed to the sandbox as opaque JSON, it never crosses the plugin
// contract.
export type DomSnapshotNode = {
  tag: string
  id?: string
  classes?: string[]
  text?: string
  attributes?: Record<string, string>
  children?: DomSnapshotNode[]
  truncated?: boolean
}

// Serializes one node of an already-redacted clone into a snapshot node, recursing
// over its children under the shared node `budget` and a per-call `depth` left.
// Reads only attributes + direct text from the detached clone (never the live page or
// the live `.value`), so the snapshot exposes only what read_dom's redaction already
// permits. Script/style/etc. are emitted as opaque structural nodes so inline
// code/JSON/markup never leaks.
const buildSnapshotNode = (
  element: Element,
  budget: { remaining: number },
  depth: number
): DomSnapshotNode => {
  const node: DomSnapshotNode = { tag: element.tagName.toLowerCase() }
  if (element.id) {
    node.id = element.id
  }
  const classes = classList(element)
  if (classes) {
    node.classes = classes
  }

  // Opaque elements contribute structure only — never their text, attributes, or
  // children — so inline script/style/JSON-island content can't reach the sandbox.
  if (SNAPSHOT_OPAQUE_TAGS.has(node.tag)) {
    return node
  }

  let truncated = false

  // Direct text only — descendants' text comes from `children`, so content is never
  // duplicated up every ancestor.
  const { value: text, truncated: textCut } = cap(directText(element), MAX_SNAPSHOT_FIELD_CHARS)
  if (text) {
    node.text = text
    truncated = truncated || textCut
  }
  if (element.attributes.length > 0) {
    node.attributes = readAttributes(element, MAX_SNAPSHOT_FIELD_CHARS)
  }

  const childElements = Array.from(element.children)
  if (childElements.length > 0) {
    if (depth <= 0) {
      // Depth cap reached: stop descending (keeps the recursive walk from
      // overflowing the stack on a deeply-nested page) and flag the cut.
      truncated = true
    } else {
      const children: DomSnapshotNode[] = []
      for (const child of childElements) {
        if (budget.remaining <= 0) {
          truncated = true
          break
        }
        budget.remaining -= 1
        const built = buildSnapshotNode(child, budget, depth - 1)
        children.push(built)
        // Propagate a descendant's truncation up so the root carries the signal.
        if (built.truncated) {
          truncated = true
        }
      }
      if (children.length > 0) {
        node.children = children
      }
    }
  }
  if (truncated) {
    node.truncated = true
  }
  return node
}

// Builds the full sanitized DOM snapshot from the page <body> (matching read_dom's
// own root — the document <head>, with its inline scripts/meta/link tokens, is never
// included). Deep-redacts the body once via the same redactClone path read_dom uses,
// then walks the detached clone into plain JSON nodes. Returns null when there is no
// document/body (headless host) or if the walk fails for any reason — a snapshot is
// best-effort and must never break the read_dom call it rides along with. This is the
// shared variable the sandbox reads as `dom`.
const buildDomSnapshot = (): DomSnapshotNode | null => {
  if (typeof document === 'undefined' || !document.body) {
    return null
  }
  try {
    const redacted = redactClone(document.body, true)
    // Seed one below the cap so the root counts toward MAX_SNAPSHOT_NODES too.
    const budget = { remaining: MAX_SNAPSHOT_NODES - 1 }
    return buildSnapshotNode(redacted, budget, MAX_SNAPSHOT_DEPTH)
  } catch {
    return null
  }
}

// A rendered element that carries its own content — has a layout box and either
// its own direct text or is an interactive control. These are the elements worth
// surfacing for a "what's at the top/bottom" question; pure layout wrappers are
// skipped so the agent sees labels and controls, not nested containers.
const isRenderedContent = (element: Element, rect: DOMRect): boolean => {
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
  const node: DomNodeResult = { tag: element.tagName.toLowerCase() }

  if (element.id) {
    node.id = element.id
  }
  const classes = classList(element)
  if (classes) {
    node.classes = classes
  }

  // Only clone when a field actually needs the redacted markup/text/attributes,
  // and only clone the subtree when html/text are requested.
  const needsSubtree = include.includes('html') || include.includes('text')
  const needsClone = needsSubtree || include.includes('attributes')
  const redacted = needsClone ? redactClone(element, needsSubtree) : element

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

const pageMeta = (): {
  url: string
  title: string
  viewport: { width: number; height: number }
} => ({
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
export const createDomReader = (
  // Optional sink for the full sanitized DOM snapshot, written on every successful
  // read so a later run_javascript can read the whole page as its `dom` binding.
  // The host wires this to a shared holder the sandbox executor reads (see
  // create-runtime). Absent on hosts that don't share with a sandbox.
  onSnapshot?: (snapshot: DomSnapshotNode | null) => void,
  // Optional gate: when provided and false, the (whole-body deep-clone) snapshot is
  // not built at all. The host uses this to skip the work entirely when no sandbox
  // consumer (run_javascript) is active, so a plain read_dom never pays for it.
  shouldCapture?: () => boolean
): DomReader => {
  return (query: DomQuery): Promise<DomReadResult> => {
    // Only build/emit the snapshot when something will consume it (and the build is
    // possible). Defaults to on when no gate is supplied, so direct callers/tests
    // that pass only a sink still capture.
    const capture = onSnapshot !== undefined && (shouldCapture?.() ?? true)

    if (typeof document === 'undefined') {
      if (capture) {
        onSnapshot(null)
      }
      return Promise.resolve(unavailable)
    }

    // Capture the full sanitized page into the shared snapshot on every read,
    // regardless of which mode the query resolves to, so the variable always
    // reflects the page the agent just looked at. The returned (narrow, truncated)
    // DomReadResult is unaffected.
    if (capture) {
      onSnapshot(buildDomSnapshot())
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
      // Measure each candidate's box once, then filter + sort on the cached top
      // (a constant scroll offset doesn't change relative order, so viewport-top
      // is enough). Avoids repeated layout reads during the comparator.
      const scored = candidates
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ el, rect }) => isRenderedContent(el, rect))
        .sort((a, b) => (region === 'bottom' ? b.rect.top - a.rect.top : a.rect.top - b.rect.top))
      // Always surface position + text so the agent sees where each element sits.
      const include = Array.from(
        new Set<'html' | 'text' | 'attributes' | 'rect'>([
          ...resolveInclude(query.include),
          'rect',
          'text'
        ])
      )
      const budget = { remaining: TREE_NODE_BUDGET }
      const nodes = scored
        .slice(0, maxNodes)
        .map(({ el }) => serializeNode(el, include, maxChars, 0, budget))
      return Promise.resolve({
        ...meta,
        matchedCount: scored.length,
        nodes,
        truncated: scored.length > nodes.length || nodes.some((node) => node.truncated)
      })
    }

    // No selector → depth-limited structural outline of the page tree, so one call
    // reveals the real subtree (e.g. under a SPA's #root) instead of just the body.
    if (!query.selector) {
      const body = document.body
      if (!body) {
        return Promise.resolve({ ...meta, matchedCount: 0, nodes: [], truncated: false })
      }
      const depth = resolveDepth(query.depth, DEFAULT_OUTLINE_DEPTH)
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
    const depth = resolveDepth(query.depth, 0)
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

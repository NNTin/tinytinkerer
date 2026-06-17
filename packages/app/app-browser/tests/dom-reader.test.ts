// @vitest-environment jsdom
//
// The DOM reader serializes the current page for the browser-state plugin. jsdom
// provides querySelector / outerHTML / textContent / attributes, so the host-side
// behaviour that matters — the body outline, selector matching, capping, the
// graceful invalid-selector path, and form-field redaction — is fully covered
// here. getBoundingClientRect is zeroed under jsdom, so `rect` shape (not real
// geometry) is what these tests assert.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  createDomReader,
  directText,
  redactFormValues,
  type DomSnapshotNode
} from '../src/dom-reader'

beforeEach(() => {
  document.title = 'Test Page'
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createDomReader — no selector', () => {
  it('returns page meta plus a shallow outline of the body children', async () => {
    document.body.innerHTML = `
      <header id="top" class="bar"></header>
      <main class="content area"></main>
      <footer></footer>
    `.trim()
    const read = createDomReader()

    const result = await read({})

    expect(result.title).toBe('Test Page')
    expect(result.viewport.width).toBeGreaterThan(0)
    expect(result.matchedCount).toBe(3)
    expect(result.nodes).toEqual([
      { tag: 'header', id: 'top', classes: ['bar'] },
      { tag: 'main', classes: ['content', 'area'] },
      { tag: 'footer' }
    ])
    expect(result.truncated).toBe(false)
  })

  it('caps the outline to maxNodes and flags truncation', async () => {
    document.body.innerHTML = Array.from({ length: 5 }, () => '<div></div>').join('')
    const read = createDomReader()

    const result = await read({ maxNodes: 2 })

    expect(result.matchedCount).toBe(5)
    expect(result.nodes).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})

describe('createDomReader — selector', () => {
  it('returns matched nodes with the default include set (text/attributes/rect)', async () => {
    document.body.innerHTML = '<p class="msg" data-x="1">hello</p>'
    const read = createDomReader()

    const result = await read({ selector: 'p' })

    expect(result.matchedCount).toBe(1)
    const [node] = result.nodes
    expect(node?.tag).toBe('p')
    expect(node?.classes).toEqual(['msg'])
    expect(node?.text).toBe('hello')
    expect(node?.attributes).toMatchObject({ class: 'msg', 'data-x': '1' })
    expect(node?.rect).toBeDefined()
    // html is not in the default include set.
    expect(node?.html).toBeUndefined()
  })

  it('returns outerHTML when html is requested (e.g. inspecting a rendered SVG)', async () => {
    document.body.innerHTML = '<div aria-label="Mermaid diagram"><svg><g></g></svg></div>'
    const read = createDomReader()

    const result = await read({ selector: '[aria-label="Mermaid diagram"]', include: ['html'] })

    expect(result.nodes[0]?.html).toContain('<svg>')
  })

  it('truncates html/text beyond maxChars and flags truncation', async () => {
    document.body.innerHTML = `<p>${'a'.repeat(100)}</p>`
    const read = createDomReader()

    const result = await read({ selector: 'p', include: ['text'], maxChars: 10 })

    expect(result.nodes[0]?.text?.startsWith('aaaaaaaaaa ')).toBe(true)
    expect(result.nodes[0]?.text).toContain('[truncated]')
    expect(result.nodes[0]?.truncated).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('caps the number of returned nodes to maxNodes', async () => {
    document.body.innerHTML = Array.from({ length: 6 }, () => '<span></span>').join('')
    const read = createDomReader()

    const result = await read({ selector: 'span', maxNodes: 3 })

    expect(result.matchedCount).toBe(6)
    expect(result.nodes).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('returns an empty result for an invalid selector instead of throwing', async () => {
    document.body.innerHTML = '<div></div>'
    const read = createDomReader()

    const result = await read({ selector: ':::not-a-selector' })

    expect(result.matchedCount).toBe(0)
    expect(result.nodes).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

describe('form-field redaction', () => {
  it('strips value/checked attributes and blanks textarea defaults in serialized html', async () => {
    document.body.innerHTML =
      '<form><input type="text" value="typed secret"><input type="checkbox" checked>' +
      '<textarea>draft note</textarea></form>'
    const read = createDomReader()

    const result = await read({ selector: 'form', include: ['html'] })
    const html = result.nodes[0]?.html ?? ''

    expect(html).not.toContain('typed secret')
    expect(html).not.toContain('checked')
    expect(html).not.toContain('draft note')
  })

  it('redacts a password input value in serialized html and attributes', async () => {
    document.body.innerHTML = '<input type="password" value="hunter2">'
    const read = createDomReader()

    const result = await read({ selector: 'input', include: ['html', 'attributes'] })

    expect(result.nodes[0]?.html).not.toContain('hunter2')
    expect(result.nodes[0]?.attributes?.value ?? '').not.toContain('hunter2')
  })

  it('redactFormValues returns a detached clone, leaving the live node untouched', () => {
    document.body.innerHTML = '<input type="text" value="keep">'
    const original = document.querySelector('input')!

    const clone = redactFormValues(original)

    expect(clone).not.toBe(original)
    expect(clone.getAttribute('value')).toBeNull()
    // The live node keeps its attribute — only the returned copy is redacted.
    expect(original.getAttribute('value')).toBe('keep')
  })
})

describe('createDomReader — recursive outline reveals the SPA subtree', () => {
  it('descends into #root and reports structure with childCount and text previews', async () => {
    document.body.innerHTML =
      '<div id="root"><header>Top bar</header><main><p>hi</p></main><footer>© 2026</footer></div>'
    const read = createDomReader()

    const result = await read({})

    // The body has one child (#root); the outline shows its subtree, not just #root.
    expect(result.matchedCount).toBe(1)
    const root = result.nodes[0]
    expect(root?.tag).toBe('div')
    expect(root?.id).toBe('root')
    expect(root?.childCount).toBe(3)
    expect(root?.children?.map((c) => c.tag)).toEqual(['header', 'main', 'footer'])

    const header = root?.children?.find((c) => c.tag === 'header')
    expect(header?.text).toBe('Top bar')

    const main = root?.children?.find((c) => c.tag === 'main')
    expect(main?.childCount).toBe(1)
    expect(main?.children?.[0]?.tag).toBe('p')
    expect(main?.children?.[0]?.text).toBe('hi')

    const footer = root?.children?.find((c) => c.tag === 'footer')
    expect(footer?.text).toBe('© 2026')
  })

  it('stops at the requested outline depth, leaving childCount as the drill-in signal', async () => {
    document.body.innerHTML = '<div id="root"><main><p>deep</p></main></div>'
    const read = createDomReader()

    const result = await read({ depth: 1 })

    const root = result.nodes[0]
    const main = root?.children?.find((c) => c.tag === 'main')
    // depth 1 expanded #root's children but not main's — childCount still flags them.
    expect(main?.childCount).toBe(1)
    expect(main?.children).toBeUndefined()
  })

  it('does not preview a textarea default value in the outline', async () => {
    document.body.innerHTML = '<div id="root"><textarea>secret draft</textarea></div>'
    const read = createDomReader()

    const result = await read({})

    const textarea = result.nodes[0]?.children?.find((c) => c.tag === 'textarea')
    expect(textarea?.text).toBeUndefined()
  })
})

describe('createDomReader — subtree depth on a selector', () => {
  it('returns a flat node by default but nests descendants when depth is set', async () => {
    document.body.innerHTML = '<section id="s"><h2>Title</h2><p>Body</p></section>'
    const read = createDomReader()

    const flat = await read({ selector: '#s' })
    expect(flat.nodes[0]?.children).toBeUndefined()
    expect(flat.nodes[0]?.childCount).toBe(2)

    const nested = await read({ selector: '#s', depth: 1, include: ['text'] })
    const node = nested.nodes[0]
    expect(node?.children?.map((c) => c.tag)).toEqual(['h2', 'p'])
    expect(node?.children?.[1]?.text).toBe('Body')
  })
})

describe('createDomReader — region (position-ordered)', () => {
  let rects: Map<Element, { top: number; width: number; height: number }>
  let spy: MockInstance

  beforeEach(() => {
    rects = new Map()
    spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const r = rects.get(this) ?? { top: 0, width: 0, height: 0 }
        return {
          x: 0,
          y: r.top,
          top: r.top,
          left: 0,
          right: r.width,
          bottom: r.top + r.height,
          width: r.width,
          height: r.height,
          toJSON: () => ({})
        }
      })
  })

  afterEach(() => {
    spy.mockRestore()
  })

  const placeBottomBar = () => {
    document.body.innerHTML =
      '<div id="root"><button id="send">Send</button><a id="priv">Privacy</a><span id="ver">v0.1.0</span></div>'
    rects.set(document.getElementById('send')!, { top: 1902, width: 60, height: 20 })
    rects.set(document.getElementById('priv')!, { top: 1920, width: 50, height: 16 })
    rects.set(document.getElementById('ver')!, { top: 1928, width: 40, height: 12 })
  }

  it('orders rendered content elements from the bottom of the page up', async () => {
    placeBottomBar()
    const read = createDomReader()

    const result = await read({ region: 'bottom' })

    // #root has a zero box → skipped; the three content elements come back bottom-first.
    expect(result.nodes.map((n) => n.id)).toEqual(['ver', 'priv', 'send'])
    expect(result.nodes[0]?.text).toBe('v0.1.0')
    expect(result.nodes[0]?.rect?.y).toBe(1928)
  })

  it('orders from the top down for region "top"', async () => {
    placeBottomBar()
    const read = createDomReader()

    const result = await read({ region: 'top' })

    expect(result.nodes.map((n) => n.id)).toEqual(['send', 'priv', 'ver'])
  })

  it('caps region results to maxNodes and flags truncation', async () => {
    placeBottomBar()
    const read = createDomReader()

    const result = await read({ region: 'bottom', maxNodes: 2 })

    expect(result.matchedCount).toBe(3)
    expect(result.nodes).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('restricts region candidates to a custom selector', async () => {
    document.body.innerHTML =
      '<button id="b">Btn</button><span class="keep" id="s1">A</span><span class="keep" id="s2">B</span>'
    rects.set(document.getElementById('b')!, { top: 100, width: 30, height: 10 })
    rects.set(document.getElementById('s1')!, { top: 200, width: 10, height: 10 })
    rects.set(document.getElementById('s2')!, { top: 150, width: 10, height: 10 })
    const read = createDomReader()

    const result = await read({ region: 'bottom', selector: '.keep' })

    // The button is excluded by the selector; only the two .keep spans, bottom-first.
    expect(result.nodes.map((n) => n.id)).toEqual(['s1', 's2'])
  })

  it('returns an empty result for an invalid selector in region mode', async () => {
    document.body.innerHTML = '<div></div>'
    const read = createDomReader()

    const result = await read({ region: 'bottom', selector: ':::not-valid' })

    expect(result.matchedCount).toBe(0)
    expect(result.nodes).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

describe('createDomReader — redaction & hardening', () => {
  it('treats an explicit depth of 0 as a flat outline (no children)', async () => {
    document.body.innerHTML = '<div id="root"><main><p>x</p></main></div>'
    const read = createDomReader()

    const result = await read({ depth: 0 })

    const root = result.nodes[0]
    expect(root?.id).toBe('root')
    expect(root?.childCount).toBe(1)
    expect(root?.children).toBeUndefined()
  })

  it('removes a <select>\'s selected state but keeps its option labels', async () => {
    document.body.innerHTML =
      '<select id="s"><option value="a">Alpha</option><option value="b" selected>Beta</option></select>'
    const read = createDomReader()

    const result = await read({ selector: '#s', include: ['html'] })
    const html = result.nodes[0]?.html ?? ''

    expect(html).not.toContain('selected')
    expect(html).toContain('Alpha')
    expect(html).toContain('Beta')
  })

  it('redacts contenteditable text in html and text modes', async () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">my unsent draft</div>'
    const read = createDomReader()

    const result = await read({ selector: '#editor', include: ['html', 'text'] })

    expect(result.nodes[0]?.text).not.toContain('my unsent draft')
    expect(result.nodes[0]?.html).not.toContain('my unsent draft')
    expect(result.nodes[0]?.text).toContain('[redacted]')
  })

  it('does not preview contenteditable text in the outline', async () => {
    document.body.innerHTML = '<div id="root"><div contenteditable="true">draft text</div></div>'
    const read = createDomReader()

    const result = await read({})

    const editor = result.nodes[0]?.children?.find((c) => c.tag === 'div')
    expect(editor?.text).toBeUndefined()
  })

  it('redacts a password input nested inside a depth-expanded subtree', async () => {
    document.body.innerHTML =
      '<form id="f"><fieldset><input type="password" value="hunter2"></fieldset></form>'
    const read = createDomReader()

    const result = await read({ selector: '#f', depth: 3, include: ['html'] })

    expect(JSON.stringify(result.nodes[0])).not.toContain('hunter2')
  })

  it('strips inline event handlers and iframe srcdoc from serialized output', async () => {
    document.body.innerHTML =
      '<div id="d" onclick="steal()"><iframe srcdoc="<p>secret</p>"></iframe></div>'
    const read = createDomReader()

    const result = await read({ selector: '#d', include: ['html', 'attributes'] })
    const html = result.nodes[0]?.html ?? ''

    expect(html).not.toContain('onclick')
    expect(html).not.toContain('srcdoc')
    expect(html).not.toContain('secret')
    expect(result.nodes[0]?.attributes?.onclick).toBeUndefined()
  })

  it('caps attribute values at maxChars', async () => {
    document.body.innerHTML = `<div id="d" data-x="${'y'.repeat(100)}"></div>`
    const read = createDomReader()

    const result = await read({ selector: '#d', include: ['attributes'], maxChars: 10 })
    const value = result.nodes[0]?.attributes?.['data-x'] ?? ''

    expect(value.startsWith('yyyyyyyyyy ')).toBe(true)
    expect(value).toContain('[truncated]')
  })

  it('flags truncation when the outline node budget is exhausted', async () => {
    // 25 blocks × 25 spans = 650 nodes > the 400-node tree budget.
    const block = `<div>${'<span></span>'.repeat(25)}</div>`
    document.body.innerHTML = `<div id="root">${block.repeat(25)}</div>`
    const read = createDomReader()

    const result = await read({ depth: 5 })

    expect(result.truncated).toBe(true)
  })
})

describe('directText', () => {
  it('returns only the element\'s own immediate text, collapsed', () => {
    document.body.innerHTML = '<div>  hello   <span>world</span>  there </div>'
    const div = document.querySelector('div')!
    expect(directText(div)).toBe('hello there')
  })
})

describe('createDomReader — full sanitized snapshot (the run_javascript `dom` binding)', () => {
  const lastSnapshot = (fn: ReturnType<typeof vi.fn>): DomSnapshotNode =>
    fn.mock.calls.at(-1)?.[0] as DomSnapshotNode

  it('writes a structured snapshot rooted at <body> on every read, whatever the query mode', async () => {
    document.body.innerHTML = '<main id="app"><h1>Title</h1><p class="lead">Body text</p></main>'
    const onSnapshot = vi.fn()
    const read = createDomReader(onSnapshot)

    await read({}) // outline
    await read({ selector: '#app' }) // selector
    await read({ region: 'top' }) // region
    expect(onSnapshot).toHaveBeenCalledTimes(3)

    const snap = lastSnapshot(onSnapshot)
    expect(snap.tag).toBe('body')
    const app = snap.children?.find((c) => c.id === 'app')
    expect(app?.tag).toBe('main')
    expect(app?.children?.map((c) => c.tag)).toEqual(['h1', 'p'])
    const lead = app?.children?.find((c) => c.classes?.includes('lead'))
    expect(lead?.text).toBe('Body text')
  })

  it('is the FULL page — not subject to read_dom\'s node/char caps', async () => {
    const longText = 'a'.repeat(60)
    document.body.innerHTML =
      `<section>${Array.from({ length: 30 }, (_, i) => `<p>${i}</p>`).join('')}` +
      `<p id="long">${longText}</p></section>`
    const onSnapshot = vi.fn()
    const read = createDomReader(onSnapshot)

    // The returned (narrow) result is capped hard; the snapshot must not be.
    const result = await read({ selector: 'p', maxNodes: 2, maxChars: 5 })
    expect(result.nodes).toHaveLength(2)

    const section = lastSnapshot(onSnapshot).children?.find((c) => c.tag === 'section')
    expect(section?.children).toHaveLength(31) // all 30 + the long one, none dropped
    expect(section?.children?.find((c) => c.id === 'long')?.text).toBe(longText) // untruncated
  })

  it('applies the same redaction as read_dom (password, textarea, contenteditable, handlers, srcdoc)', async () => {
    document.body.innerHTML =
      '<form onclick="steal()"><input type="password" value="hunter2">' +
      '<textarea>draft note</textarea>' +
      '<div contenteditable="true">unsent draft</div>' +
      '<iframe srcdoc="<p>secret</p>"></iframe></form>'
    const onSnapshot = vi.fn()
    const read = createDomReader(onSnapshot)

    await read({})

    const json = JSON.stringify(lastSnapshot(onSnapshot))
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('draft note')
    expect(json).not.toContain('unsent draft')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('onclick')
    expect(json).not.toContain('srcdoc')
    expect(json).toContain('[redacted]') // password surfaces only the marker
  })

  it('excludes the document <head> and the contents of body script/style nodes', async () => {
    document.head.innerHTML =
      '<meta name="csrf-token" content="HEAD_META_SECRET">' +
      '<script>var headVar = "HEAD_SCRIPT_SECRET"</script>'
    document.body.innerHTML =
      '<div id="app">visible</div>' +
      '<script id="data" type="application/json">{"session":"BODY_SCRIPT_SECRET"}</script>' +
      '<style>.x{color:BODY_STYLE_SECRET}</style>'
    const onSnapshot = vi.fn()
    const read = createDomReader(onSnapshot)

    try {
      await read({})

      const snap = lastSnapshot(onSnapshot)
      expect(snap.tag).toBe('body') // rooted at body, so <head> is wholly excluded
      const json = JSON.stringify(snap)
      expect(json).not.toContain('HEAD_META_SECRET')
      expect(json).not.toContain('HEAD_SCRIPT_SECRET')
      // body script/style appear as opaque structural nodes — no inner text/attributes.
      expect(json).not.toContain('BODY_SCRIPT_SECRET')
      expect(json).not.toContain('BODY_STYLE_SECRET')
      const dataScript = snap.children?.find((c) => c.id === 'data')
      expect(dataScript?.tag).toBe('script')
      expect(dataScript?.text).toBeUndefined()
      expect(dataScript?.attributes).toBeUndefined()
    } finally {
      document.head.innerHTML = ''
    }
  })

  it('caps an oversized attribute value in the snapshot', async () => {
    const big = 'y'.repeat(60_000) // beyond MAX_SNAPSHOT_FIELD_CHARS (50k)
    document.body.innerHTML = `<div id="d" data-blob="${big}"></div>`
    const onSnapshot = vi.fn()
    const read = createDomReader(onSnapshot)

    await read({})

    const value = lastSnapshot(onSnapshot).children?.find((c) => c.id === 'd')?.attributes?.['data-blob'] ?? ''
    expect(value).toContain('[truncated]')
    expect(value.length).toBeLessThan(60_000)
  })

  it('skips building the snapshot entirely when capture is gated off', async () => {
    document.body.innerHTML = '<div>x</div>'
    const offSnapshot = vi.fn()
    await createDomReader(offSnapshot, () => false)({})
    expect(offSnapshot).not.toHaveBeenCalled()

    const onSnapshot = vi.fn()
    await createDomReader(onSnapshot, () => true)({})
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(lastSnapshot(onSnapshot).tag).toBe('body')
  })
})

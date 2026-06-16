// @vitest-environment jsdom
//
// The DOM reader serializes the current page for the browser-state plugin. jsdom
// provides querySelector / outerHTML / textContent / attributes, so the host-side
// behaviour that matters — the body outline, selector matching, capping, the
// graceful invalid-selector path, and form-field redaction — is fully covered
// here. getBoundingClientRect is zeroed under jsdom, so `rect` shape (not real
// geometry) is what these tests assert.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDomReader, redactFormValues } from '../src/dom-reader'

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

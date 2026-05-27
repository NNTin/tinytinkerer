import { describe, expect, it } from 'vitest'
import { createMarkdownContentSession, markdownSourcePlugin, parseMarkdownContent } from '../src/index.js'

describe('markdownSourcePlugin', () => {
  it('describes markdown as the default content source plugin', () => {
    expect(markdownSourcePlugin.id).toBe('markdown')
    expect(markdownSourcePlugin.format).toBe('text/markdown')
  })

  it('parses source and creates streaming sessions through the same plugin contract', () => {
    expect(markdownSourcePlugin.parse('Hello')).toEqual(parseMarkdownContent('Hello'))

    const session = markdownSourcePlugin.createSession('Hello')
    expect(session.snapshot()).toEqual(createMarkdownContentSession('Hello').snapshot())

    expect(session.append('\n\nWorld').source).toBe('Hello\n\nWorld')
    expect(session.snapshot().document.nodes).toHaveLength(2)
  })
})

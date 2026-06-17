// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityView, TurnActivity } from '@tinytinkerer/app-core'
import { TurnActivityPanel } from '../src/turn-activity-panel.js'

afterEach(cleanup)

const activity = (items: TurnActivity['items']): TurnActivity => ({ items, reasoningText: '' })

describe('TurnActivityPanel hierarchy rendering', () => {
  it('indents nested steps and tools with connector markers', () => {
    const a = activity([
      {
        kind: 'label',
        id: 'l-plan',
        label: 'Created 1-step plan',
        stepId: 'plan',
        stepKind: 'plan'
      },
      {
        kind: 'label',
        id: 'l-s1',
        label: 'Search the docs',
        stepId: 's1',
        parentId: 'plan',
        stepKind: 'plan-step'
      },
      {
        kind: 'tool',
        id: 't-1',
        toolId: 'web-search',
        stepId: 'tool-1',
        parentId: 's1',
        status: 'completed',
        output: { query: 'docs', results: [] }
      }
    ])

    render(<TurnActivityPanel activity={a} isLive serverNameById={new Map()} />)

    // Root step uses a dot; nested step + tool use the tree connector.
    expect(screen.getAllByText('└─').length).toBe(2)
    expect(screen.getByText('•')).toBeInTheDocument()

    // Nested plan-step is indented relative to the root plan step.
    const rootRow = screen.getByText('Created 1-step plan').closest('div')?.parentElement
    const nestedRow = screen.getByText('Search the docs').closest('div')?.parentElement
    expect(rootRow?.getAttribute('style') ?? '').not.toContain('padding-left')
    expect(nestedRow?.getAttribute('style') ?? '').toContain('padding-left')
  })

  it('renders a streamed think step thought', () => {
    const a = activity([
      {
        kind: 'label',
        id: 'l-th',
        label: 'Let me search the docs',
        stepId: 'th1',
        stepKind: 'think'
      }
    ])

    render(<TurnActivityPanel activity={a} isLive serverNameById={new Map()} />)

    expect(screen.getByText('Let me search the docs')).toBeInTheDocument()
  })
})

describe('TurnActivityPanel generic ActivityView rendering', () => {
  const completedTool = (toolId: string, output: unknown): TurnActivity =>
    activity([{ kind: 'tool', id: 't-1', toolId, stepId: 'tool-1', status: 'completed', output }])

  it('renders the resolved summarizer view: title heading and section rows', () => {
    const view: ActivityView = {
      title: 'Ran JavaScript',
      status: 'ok',
      sections: [
        { label: 'Result', value: '314061' },
        { label: 'Logs', value: '0 lines' }
      ]
    }
    const resolveSummarizer = () => () => view

    render(
      <TurnActivityPanel
        activity={completedTool('run_javascript', { ok: true })}
        isLive
        serverNameById={new Map()}
        resolveSummarizer={resolveSummarizer}
      />
    )

    expect(screen.getByText('Ran JavaScript')).toBeInTheDocument()
    expect(screen.getByText('Result:')).toBeInTheDocument()
    expect(screen.getByText('314061')).toBeInTheDocument()
    expect(screen.getByText('Logs:')).toBeInTheDocument()
    expect(screen.getByText('0 lines')).toBeInTheDocument()
  })

  it('renders untrusted section values as text, never as HTML', () => {
    const view: ActivityView = {
      title: 'Tool',
      sections: [{ label: 'Output', value: '<img src=x onerror=alert(1)>' }]
    }
    render(
      <TurnActivityPanel
        activity={completedTool('whatever', {})}
        isLive
        serverNameById={new Map()}
        resolveSummarizer={() => () => view}
      />
    )

    // The payload appears verbatim as text and no <img> element is injected.
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('neutral default: shows the tool label and "(no output)" for empty output', () => {
    render(
      <TurnActivityPanel
        activity={completedTool('mystery-tool', {})}
        isLive
        serverNameById={new Map()}
      />
    )

    expect(screen.getByText('mystery-tool')).toBeInTheDocument()
    expect(screen.getByText('(no output)')).toBeInTheDocument()
  })

  it('neutral default: does not show "(no output)" when output is non-empty', () => {
    render(
      <TurnActivityPanel
        activity={completedTool('mystery-tool', { some: 'data' })}
        isLive
        serverNameById={new Map()}
      />
    )

    expect(screen.getByText('mystery-tool')).toBeInTheDocument()
    expect(screen.queryByText('(no output)')).not.toBeInTheDocument()
  })
})

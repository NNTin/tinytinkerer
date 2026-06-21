// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('renders the decision reasoning with a colour + non-colour cue per kind', () => {
    const a = activity([
      {
        kind: 'label',
        id: 'l-action',
        label: 'Need to run the snippet',
        stepId: 'th1',
        stepKind: 'think',
        decisionKind: 'action',
        decisionReasoning: 'Run the snippet in the sandbox to gather the observation.'
      },
      {
        kind: 'label',
        id: 'l-final',
        label: 'I have the result',
        stepId: 'th2',
        stepKind: 'think',
        decisionKind: 'final',
        decisionReasoning: 'The sandbox returned its result; ready to answer.'
      }
    ])

    const { container } = render(
      <TurnActivityPanel activity={a} isLive serverNameById={new Map()} />
    )

    // The reasoning text is surfaced for both the action and the final step.
    expect(
      screen.getByText('Run the snippet in the sandbox to gather the observation.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('The sandbox returned its result; ready to answer.')
    ).toBeInTheDocument()

    // The kind is conveyed by a non-colour cue (a spelled-out word) AND a stable
    // data attribute the kind-styled colour hangs off (WCAG 1.4.1).
    const action = container.querySelector('[data-decision-kind="action"]')
    const final = container.querySelector('[data-decision-kind="final"]')
    expect(action).toBeInTheDocument()
    expect(final).toBeInTheDocument()
    expect(action).toHaveTextContent('Action')
    expect(final).toHaveTextContent('Final')
    // Distinct colour classes back the two kinds (colour cue), not the same tone.
    expect(action?.className).toContain('text-sky-700')
    expect(final?.className).toContain('text-emerald-700')
  })

  it('renders a think step with no resolved decision as a plain thought', () => {
    const a = activity([
      {
        kind: 'label',
        id: 'l-th',
        label: 'A bare thought',
        stepId: 'th1',
        stepKind: 'think'
      }
    ])

    const { container } = render(
      <TurnActivityPanel activity={a} isLive serverNameById={new Map()} />
    )

    expect(screen.getByText('A bare thought')).toBeInTheDocument()
    expect(container.querySelector('[data-decision-kind]')).toBeNull()
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
        { kind: 'text', label: 'Result', value: '314061' },
        { kind: 'text', label: 'Logs', value: 'hello\nworld' }
      ]
    }
    const resolveSummarizer = () => () => view

    const { container } = render(
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
    // Multi-line log output is rendered verbatim with newlines preserved (the value
    // lives in a pre-wrap span so a chatty run reads line-by-line).
    const logValue = screen.getByText('Logs:').parentElement?.querySelector('.whitespace-pre-wrap')
    expect(logValue?.textContent).toBe('hello\nworld')
    // The ok/warn/error outcome carries an explicit non-colour cue (glyph + word),
    // not only the status border colour (WCAG 1.4.1).
    const cue = container.querySelector('[data-activity-status="ok"]')
    expect(cue).toBeInTheDocument()
    expect(cue).toHaveTextContent('OK')
  })

  it('shows a Timed out outcome cue for a warn status', () => {
    const view: ActivityView = {
      title: 'Ran JavaScript',
      status: 'warn',
      sections: [{ kind: 'text', label: 'Timed out', value: 'Execution exceeded the time limit' }]
    }
    const { container } = render(
      <TurnActivityPanel
        activity={completedTool('run_javascript', { ok: false })}
        isLive
        serverNameById={new Map()}
        resolveSummarizer={() => () => view}
      />
    )
    const cue = container.querySelector('[data-activity-status="warn"]')
    expect(cue).toBeInTheDocument()
    expect(cue).toHaveTextContent('Warning')
    expect(screen.getByText('Execution exceeded the time limit')).toBeInTheDocument()
  })

  it('renders a code section through a read-only CodeMirror view, resolving async summarizers', async () => {
    const view: ActivityView = {
      title: 'Ran JavaScript',
      status: 'ok',
      sections: [
        { kind: 'code', label: 'Code', language: 'javascript', code: 'const answer = 42' },
        { kind: 'text', label: 'Logs', value: '(none)' }
      ]
    }
    // An async summarizer mirrors the real code-exec one (it lazy-loads a formatter).
    const resolveSummarizer = () => () => Promise.resolve(view)

    const { container } = render(
      <TurnActivityPanel
        activity={completedTool('run_javascript', { ok: true })}
        isLive
        serverNameById={new Map()}
        resolveSummarizer={resolveSummarizer}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeInTheDocument())
    expect(container).toHaveTextContent('const answer = 42')
  })

  it('renders untrusted text section values as text, never as HTML', () => {
    const view: ActivityView = {
      title: 'Tool',
      sections: [{ kind: 'text', label: 'Output', value: '<img src=x onerror=alert(1)>' }]
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

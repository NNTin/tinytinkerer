// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TurnActivity } from '@tinytinkerer/app-core'
import { TurnActivityPanel } from '../src/turn-activity-panel.js'

afterEach(cleanup)

const activity = (items: TurnActivity['items']): TurnActivity => ({ items, reasoningText: '' })

describe('TurnActivityPanel hierarchy rendering', () => {
  it('indents nested steps and tools with connector markers', () => {
    const a = activity([
      { kind: 'label', id: 'l-plan', label: 'Created 1-step plan', stepId: 'plan', stepKind: 'plan' },
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
      { kind: 'label', id: 'l-th', label: 'Let me search the docs', stepId: 'th1', stepKind: 'think' }
    ])

    render(<TurnActivityPanel activity={a} isLive serverNameById={new Map()} />)

    expect(screen.getByText('Let me search the docs')).toBeInTheDocument()
  })
})

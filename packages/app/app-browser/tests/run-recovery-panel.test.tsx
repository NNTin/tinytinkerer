// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { AppBrowserProvider, type BrowserApp } from '../src/app.js'
import RunRecoveryPanel from '../src/run-recovery-panel.js'
import type { RunCheckpoint } from '../src/runtime/run-checkpoint.js'

// Issue #531: the latest turn describes its saved progress and offers an
// explicit Resume; a blocked one explains why, and offers a retry only when
// retrying can help. Nothing is resumed without the click.

const saved = (overrides: Partial<RunCheckpoint> = {}): RunCheckpoint => ({
  version: 1,
  conversationId: 'c1',
  turnId: 'u1',
  prompt: 'Make it',
  history: [],
  agentType: 'react',
  account: 'anonymous',
  origins: {},
  invocations: [
    {
      callId: 'a',
      toolId: 'mcp:s:create',
      input: {},
      outcome: { ok: true, output: { id: 'secret-ref' } }
    },
    { callId: 'b', toolId: 'mcp:s:add', input: {}, outcome: { ok: true, output: 1 } }
  ],
  state: 'stopped',
  attempts: 1,
  createdAt: '',
  updatedAt: '',
  ...overrides
})

const mount = (record: unknown, turnId = 'u1') => {
  const resumeRun = vi.fn(() => Promise.resolve())
  const chat = createStore(() => ({
    conversationId: 'c1',
    isRunning: false,
    events: [],
    cooldownUntil: undefined,
    resumeRun
  }))
  const app = {
    shell: { loadRunCheckpoints: () => Promise.resolve({ get: () => Promise.resolve(record) }) },
    stores: { chat }
  } as unknown as BrowserApp
  render(
    <AppBrowserProvider app={app}>
      <RunRecoveryPanel turnId={turnId} prompt="Make it" />
    </AppBrowserProvider>
  )
  return { resumeRun }
}

afterEach(cleanup)

describe('RunRecoveryPanel (issue #531)', () => {
  it('describes resumable progress without its outputs and resumes only on click', async () => {
    const { resumeRun } = mount(saved())
    expect(await screen.findByText(/Saved progress: 2 completed tool calls/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('secret-ref')
    expect(resumeRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(resumeRun).toHaveBeenCalledWith('Make it', 'u1', 'c1')
    // A second click while the first is pending is ignored.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
  })

  it('warns about an uncertain call before Resume checks it', async () => {
    mount(saved({ inFlight: { callId: 'c', toolId: 'mcp:s:add', input: {} } }))
    expect(await screen.findByText(/The last call \(mcp:s:add\) was sent/)).toBeInTheDocument()
  })

  it('explains a blocked record, offering a retry only when it can help', async () => {
    mount(saved({ state: 'blocked', blocked: { reason: 'The design is gone.', retryable: false } }))
    expect(await screen.findByText('Resume unavailable: The design is gone.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers a retry for a retryable block', async () => {
    mount(saved({ state: 'blocked', blocked: { reason: 'Sign in again.', retryable: true } }))
    expect(await screen.findByRole('button', { name: 'Try Resume again' })).toBeInTheDocument()
  })

  it('shows nothing for another turn or no saved progress', async () => {
    mount(saved(), 'u2')
    mount(undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/Saved progress/)).toBeNull()
  })
})

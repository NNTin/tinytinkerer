// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { McpDiscoveryResult } from '@tinytinkerer/contracts'
import { AppBrowserProvider, type BrowserApp } from '../src/app.js'
import { createHostMcpStore } from '../src/stores/host-mcp-store.js'
import type { BrowserShell } from '../src/shell.js'
import { ToolTreePanel } from '../src/tool-tree-panel.js'

/**
 * The tool picker lists the app's own MCP servers (issue #518, F5), so a server
 * that is down reads as unavailable instead of silently missing.
 */
afterEach(cleanup)

const discovered = (serverId: string, error?: string): McpDiscoveryResult => ({
  serverId,
  serverName: serverId,
  syncedAt: '2026-11-11T00:00:00.000Z',
  tools: error ? [] : [{ toolName: 'create_project', description: '', inputSchema: {} }],
  ...(error ? { error } : {})
})

const renderPanel = (discovery: Record<string, McpDiscoveryResult>) => {
  const hostMcp = createHostMcpStore({ config: { edgeBaseUrl: '' } } as BrowserShell, [
    { id: 'kiprint', name: 'KiPrint', url: 'https://kiprint.test/mcp' },
    { id: 'parts', name: 'Parts', url: 'https://parts.test/mcp' }
  ])
  const discover = vi.fn(() => Promise.resolve())
  hostMcp.setState({ discovery, discover })
  const settings = createStore(() => ({
    setPluginToolSelection: vi.fn(),
    setAppToolSelection: vi.fn(),
    pluginDisabledTools: {},
    appToolDisablement: {}
  }))
  const auth = { getState: () => ({ token: 'gh-token' }) }
  const app = { stores: { hostMcp, settings, auth } } as unknown as BrowserApp
  render(
    <AppBrowserProvider app={app}>
      <ToolTreePanel
        view={{ plugins: [], enabledCount: 0, toolCount: 0 }}
        toolIdsByPlugin={{}}
        onClose={vi.fn()}
      />
    </AppBrowserProvider>
  )
  return { discover }
}

describe('tool picker: host-provided MCP servers', () => {
  it('shows a failed server as unavailable, with its error and a Retry', () => {
    const { discover } = renderPanel({
      kiprint: discovered('kiprint', 'Bad gateway'),
      parts: discovered('parts')
    })

    const failed = screen.getByTestId('tool-tree-host-server-kiprint')
    expect(failed).toHaveAttribute('data-status', 'unavailable')
    expect(failed).toHaveTextContent('Unavailable: Bad gateway')
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry KiPrint' }))
    expect(discover).toHaveBeenCalledWith('gh-token')

    const healthy = screen.getByTestId('tool-tree-host-server-parts')
    expect(healthy).toHaveAttribute('data-status', 'available')
    expect(healthy).toHaveTextContent('1 tool, always on')
    expect(within(healthy).queryByRole('button')).toBeNull()
  })

  it('says why a server has no tools while signed out', () => {
    renderPanel({})
    expect(screen.getByTestId('tool-tree-host-server-kiprint')).toHaveTextContent(
      'Sign in to load its tools'
    )
  })
})

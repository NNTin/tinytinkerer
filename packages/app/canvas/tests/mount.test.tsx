// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getSceneElements: vi.fn(() => []),
  getAppState: vi.fn(() => ({})),
  onChange: vi.fn(() => () => undefined),
  updateLibrary: vi.fn()
}))
const storage = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(() => Promise.resolve())
}))

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: ({ excalidrawAPI }: { excalidrawAPI: (api: unknown) => void }) => {
    React.useEffect(() => excalidrawAPI(api), [excalidrawAPI])
    return <div data-testid="excalidraw">whiteboard</div>
  },
  CaptureUpdateAction: { IMMEDIATELY: 'immediately', NEVER: 'never' }
}))

vi.mock('../src/workspace-db', () => ({
  loadCanvasSnapshot: storage.load,
  saveCanvasSnapshot: storage.save
}))

import React from 'react'
import { CanvasStage } from '../src'

afterEach(cleanup)

beforeEach(() => {
  storage.load.mockReset().mockResolvedValue(null)
  storage.save.mockClear()
})

describe('CanvasStage', () => {
  it('loads persistence before mounting a two-panel integrated workspace', async () => {
    let resolveLoad: (value: null) => void = () => undefined
    storage.load.mockReturnValueOnce(new Promise((resolve) => (resolveLoad = resolve)))

    render(<CanvasStage assistant={<div>assistant body</div>} />)
    expect(screen.getByText('Opening canvas…')).toBeInTheDocument()
    expect(screen.queryByTestId('excalidraw')).not.toBeInTheDocument()

    resolveLoad(null)
    await waitFor(() => expect(screen.getByTestId('excalidraw')).toBeInTheDocument(), {
      timeout: 5_000
    })
    expect(screen.getByText('Canvas workspace')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Canvas' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Assistant' })).toHaveTextContent('assistant body')
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const sendPrompt = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tinytinkerer/app-browser', () => ({
  useChatStore: (selector: (state: { sendPrompt: typeof sendPrompt }) => unknown) =>
    selector({ sendPrompt })
}))

import { useRequestAssistantAction } from '../src/assistant-action'

describe('useRequestAssistantAction', () => {
  it('returns the public chat prompt action', async () => {
    const { result } = renderHook(() => useRequestAssistantAction())
    await result.current('Repair the diagram')
    expect(sendPrompt).toHaveBeenCalledWith('Repair the diagram')
  })
})

import type { ReactNode } from 'react'
import type { ChatEvent } from '@tinytinkerer/contracts'

export type PixelAgentsStageProps = {
  assistant: ReactNode
  events: readonly ChatEvent[]
  isRunning: boolean
}

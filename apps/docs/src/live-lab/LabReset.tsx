import { useState } from 'react'
import { useLabSessionContextOptional } from './lab-session-context'

export type LabResetProps = {
  label?: string
}

// A clearly visible control (issue #451) that removes ONLY the isolated docs-lab
// session (conversations, plugin settings, model selection) — never the main
// product's database or auth token. See client-runtime.tsx's resetDocsLabSession.
export const LabReset = ({ label = 'Reset this lab' }: LabResetProps) => {
  const context = useLabSessionContextOptional()
  const [error, setError] = useState<string | null>(null)

  if (!context) {
    return null
  }

  const isResetting = context.snapshot.status === 'reset'

  const handleClick = () => {
    setError(null)
    context.reset().catch((resetError: unknown) => {
      setError(
        resetError instanceof Error ? resetError.message : 'Failed to reset the lab session.'
      )
    })
  }

  return (
    <div className="live-lab__reset">
      <button type="button" onClick={handleClick} disabled={isResetting}>
        {isResetting ? 'Resetting…' : label}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}

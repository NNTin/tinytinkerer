import { useState } from 'react'

export const DocumentationPlatformStatus = (): React.JSX.Element => {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <section className="docs-platform-status" aria-labelledby="docs-platform-status-title">
      <div>
        <strong id="docs-platform-status-title">Docusaurus + React are connected</strong>
        <p>
          This component is rendered from the documentation app while its content remains in the
          repository&apos;s root docs directory.
        </p>
      </div>
      <button type="button" onClick={() => setConfirmed((value) => !value)}>
        {confirmed ? 'React interaction confirmed' : 'Test the React component'}
      </button>
    </section>
  )
}

export default DocumentationPlatformStatus

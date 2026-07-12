import type { FileDiagnostic } from '@tinytinkerer/file-tools'
import { MERMAID_FILE_PATH } from './workspace-constants'

export const buildMermaidFixPrompt = (
  source: string,
  revision: number,
  diagnostic: FileDiagnostic
): string => {
  const line = diagnostic.line ?? 1
  const lines = source.split('\n')
  const start = Math.max(0, line - 3)
  const excerpt = lines
    .slice(start, Math.min(lines.length, line + 2))
    .map((value, index) => `${start + index + 1}: ${value}`)
    .join('\n')
    .slice(0, 2000)
  return `Fix the Mermaid syntax error in ${MERMAID_FILE_PATH}. Use read_files first and apply_file_changes with revision ${revision}; re-read if it changed.\n\nDiagnostic: ${diagnostic.message}\n\nNearby source:\n${excerpt}`
}

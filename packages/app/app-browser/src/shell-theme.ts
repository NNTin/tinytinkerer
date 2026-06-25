import type { CSSProperties } from 'react'
import type { ShellThemeTokens } from './config'

// Maps host-supplied theme tokens (B4) onto the shell's CSS custom properties.
// Each host value is written to BOTH the generic base token consumed by shared
// components (--bg/--panel/--text/--border/--accent) and the widget-specific
// token used by the widget's own chrome (--widget-*). Because the conversation
// surface — message bubbles, turn chrome, empty state, jump pill, settings —
// reads only these base tokens and the derived tokens built on them (see
// app-browser/styles.css), overriding the bases here recolors that whole surface
// in one shot. Fixed semantic colors (notice/warning banners, destructive-action
// hovers) intentionally stay put. Omitted fields are not set, so the shell's own
// defaults remain in effect.
export const shellThemeToCssVars = (theme: ShellThemeTokens | undefined): CSSProperties => {
  if (!theme) {
    return {}
  }

  const vars: Record<string, string> = {}
  const set = (names: readonly string[], value: string | undefined) => {
    if (value === undefined) {
      return
    }
    for (const name of names) {
      vars[name] = value
    }
  }

  set(['--bg', '--widget-bg'], theme.background)
  set(['--panel', '--widget-panel'], theme.panel)
  set(['--text', '--widget-text'], theme.text)
  set(['--border', '--widget-border'], theme.border)
  set(['--accent'], theme.accent)

  return vars
}

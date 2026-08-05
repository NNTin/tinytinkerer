import type { CSSProperties } from 'react'
import type { ShellThemeTokens } from './config'

// Maps host-supplied theme tokens (B4) onto the shell's CSS custom properties.
// Each host value is written to BOTH the generic base token consumed by shared
// components (--bg/--panel/--text/--border/--accent) and the widget-specific
// token used by the widget's own chrome (--widget-*). Overriding the bases here
// recolors the whole conversation surface in one shot; fixed semantic colors
// (notice/warning banners, destructive-action hovers) intentionally stay put,
// and omitted fields are not set, so the shell's own defaults remain in effect.
//
// TWO CORRECTIONS to what this comment used to claim (issue #496):
//
//  1. The tokens are no longer "in app-browser/styles.css". #491 split them:
//     `tokens.css` declares the base VALUES on `:root`, and `token-graph.css`
//     declares the DERIVED graph — --text-strong, --panel-hover, --accent-ring,
//     --accent-soft, --user-bubble — for `:root` AND `:where(.tt-app-embed)`.
//  2. "Recolors that whole surface in one shot" was true of the bases and NOT of
//     the derived values. This function returns an inline style, applied to the
//     stage element in sidebar-layout.tsx / floating-layout.tsx. A custom
//     property is computed where it is DECLARED, so a graph declared only on
//     `:root` mixed against the ROOT's bases and handed that result down —
//     meaning a host supplying a dark theme got dark bases and light rings,
//     hovers and bubbles. Both stage elements now carry `tt-app-embed`, which is
//     the scope `token-graph.css` re-declares the graph for, so the formulas
//     resolve against whatever this function just wrote.
//
// The conversation surface reads only these bases and that graph — which is now
// true of `turn-activity-panel.tsx` and `docked-chat-surface.tsx` too, the two
// components that had been the exception (issue #496).
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

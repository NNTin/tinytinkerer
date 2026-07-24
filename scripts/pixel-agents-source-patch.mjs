// Upstream's "+ Agent" button (webview-ui/src/components/BottomToolbar.tsx)
// reveals a "Skip permissions mode" hover dropdown that sends `launchAgent`
// with `bypassPermissions: true` — a field this integration's single
// TinyTinkerer "workspace" (the chat store) has no meaning for and silently
// ignores (see packages/app/pixel-agents/src/protocol.ts). Rather than ship
// a reachable dead-end menu item, this removes that JSX block, and its
// now-unreachable `handleBypassSelect` handler (TypeScript's `noUnusedLocals`
// fails the build otherwise), from the freshly cloned pinned-commit source
// before it's built (prepare-pixel-agents.mjs).
//
// The `Dropdown` component (webview-ui/src/components/ui/Dropdown.tsx) fully
// unmounts when closed rather than CSS-hiding, and its items share generic
// classes with the (legitimate) folder-picker dropdown right next to it —
// there is no stable selector a post-build CSS injection could target
// safely, so this has to be a source-level edit.
const BYPASS_DROPDOWN_PATTERN =
  /[ \t]*<Dropdown isOpen=\{isBypassMenuOpen\}>[\s\S]*?<\/Dropdown>\r?\n/
const HANDLE_BYPASS_SELECT_PATTERN =
  /[ \t]*const handleBypassSelect = \(bypassPermissions: boolean\) => \{[\s\S]*?\n[ \t]*\};\r?\n/

const removeOrThrow = (source, pattern, label) => {
  if (!pattern.test(source)) {
    throw new Error(
      `BottomToolbar.tsx: expected ${label} not found — upstream may have restructured ` +
        'this file. Update scripts/pixel-agents-source-patch.mjs.'
    )
  }
  return source.replace(pattern, '')
}

export const patchBottomToolbarSource = (source) => {
  let patched = removeOrThrow(
    source,
    BYPASS_DROPDOWN_PATTERN,
    'the "Skip permissions mode" <Dropdown isOpen={isBypassMenuOpen}> block'
  )
  patched = removeOrThrow(patched, HANDLE_BYPASS_SELECT_PATTERN, 'the handleBypassSelect handler')
  return patched
}

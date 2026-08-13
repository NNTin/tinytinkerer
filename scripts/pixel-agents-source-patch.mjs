// Source-level edits applied to the freshly cloned pinned upstream commit
// before it is built (prepare-pixel-agents.mjs). Everything here is something
// a post-build CSS or DOM injection could not do safely; anything that CAN be
// done from the injected bridge belongs in pixel-agents-bridge.mjs instead.
//
// Every patch fails loudly rather than silently no-oping, so a pin bump that
// restructures the file breaks the build instead of the office.

const patchOrThrow = (source, { file, label, pattern, replacement }) => {
  if (!pattern.test(source)) {
    throw new Error(
      `${file}: expected ${label} not found — upstream may have restructured ` +
        'this file. Update scripts/pixel-agents-source-patch.mjs.'
    )
  }
  return source.replace(pattern, replacement)
}

// Upstream's "+ Agent" button (webview-ui/src/components/BottomToolbar.tsx)
// reveals a "Skip permissions mode" hover dropdown that sends `launchAgent`
// with `bypassPermissions: true` — a field this integration's single
// TinyTinkerer "workspace" (the chat store) has no meaning for and silently
// ignores (see packages/app/pixel-agents/src/protocol.ts). Rather than ship
// a reachable dead-end menu item, this removes that JSX block, and its
// now-unreachable `handleBypassSelect` handler (TypeScript's `noUnusedLocals`
// fails the build otherwise).
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

export const patchBottomToolbarSource = (source) => {
  const patched = patchOrThrow(source, {
    file: 'BottomToolbar.tsx',
    label: 'the "Skip permissions mode" <Dropdown isOpen={isBypassMenuOpen}> block',
    pattern: BYPASS_DROPDOWN_PATTERN,
    replacement: ''
  })
  return patchOrThrow(patched, {
    file: 'BottomToolbar.tsx',
    label: 'the handleBypassSelect handler',
    pattern: HANDLE_BYPASS_SELECT_PATTERN,
    replacement: ''
  })
}

// Upstream picks its initial zoom from the display's pixel ratio
// (webview-ui/src/office/toolUtils.ts): `round(2 * devicePixelRatio)`, so 2 on
// an ordinary display and 4 on a retina one. At that zoom the 21x22-tile room
// is ~672 device pixels wide, which is fine in a window and hopeless in the
// documentation sidebar's ~300px column — a reader would see one corner of an
// empty floor, and issue #472 removes the panning that would otherwise let
// them go and find the characters.
//
// So a frame that asked for compact chrome starts at ZOOM_MIN, where the whole
// room fits the column. A source patch rather than a bridge-side override
// because the value is read once, at `useState(defaultZoom)` initialization
// (webview-ui/src/hooks/useEditorActions.ts), before any message from the host
// could reach it — and faking `devicePixelRatio` from the bridge instead would
// also halve the canvas backing store and blur every sprite.
//
// The parameter name is the one the stage puts on the frame URL; see
// packages/app/pixel-agents/src/pixel-agents-stage.tsx and
// scripts/pixel-agents-bridge.mjs, which read the same value for the chrome
// and gesture halves of compact mode. `ZOOM_MIN` is already imported by this
// module upstream, so the patched body needs no new import to type-check.
const DEFAULT_ZOOM_PATTERN =
  /export function defaultZoom\(\): number \{\r?\n([ \t]*)const dpr = window\.devicePixelRatio \|\| 1;\r?\n/

const DEFAULT_ZOOM_REPLACEMENT =
  'export function defaultZoom(): number {\n' +
  '$1// TinyTinkerer (issue #472): a host with a narrow column asks for the\n' +
  '$1// whole room at once instead of a legible but cropped corner of it.\n' +
  "$1if (new URLSearchParams(location.search).get('tinytinkerer-chrome') === 'compact') {\n" +
  '$1  return ZOOM_MIN;\n' +
  '$1}\n' +
  '$1const dpr = window.devicePixelRatio || 1;\n'

export const patchDefaultZoomSource = (source) =>
  patchOrThrow(source, {
    file: 'toolUtils.ts',
    label: 'the `defaultZoom()` device-pixel-ratio body',
    pattern: DEFAULT_ZOOM_PATTERN,
    replacement: DEFAULT_ZOOM_REPLACEMENT
  })

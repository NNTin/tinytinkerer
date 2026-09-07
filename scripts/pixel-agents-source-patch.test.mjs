import assert from 'node:assert/strict'
import test from 'node:test'
import { patchBottomToolbarSource, patchDefaultZoomSource } from './pixel-agents-source-patch.mjs'

// A trimmed stand-in for the real upstream BottomToolbar.tsx shape (as of the
// pinned commit) — just enough surrounding context to exercise the patch.
const bottomToolbarSource = `export function BottomToolbar() {
  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    transport.send({ type: 'launchAgent', folderPath: folder.path });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      {!isBrowserRuntime && (
        <div ref={folderPickerRef} className="relative">
          <Button variant="accent" onClick={handleAgentClick}>
            + Agent
          </Button>
          <Dropdown isOpen={isBypassMenuOpen}>
            <DropdownItem onClick={() => handleBypassSelect(true)}>
              Skip permissions mode <span className="text-2xs text-warning">⚠</span>
            </DropdownItem>
          </Dropdown>
          <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
            {workspaceFolders.map((folder) => (
              <DropdownItem key={folder.path} onClick={() => handleFolderSelect(folder)}>
                {folder.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      )}
    </div>
  );
}
`

test('patchBottomToolbarSource removes the bypass-permissions dropdown and its handler', () => {
  const patched = patchBottomToolbarSource(bottomToolbarSource)
  assert.doesNotMatch(patched, /isBypassMenuOpen/)
  assert.doesNotMatch(patched, /Skip permissions mode/)
  assert.doesNotMatch(patched, /handleBypassSelect/)
  // The real "+ Agent" button and the (legitimate) folder-picker dropdown/
  // handler survive untouched.
  assert.match(patched, /\+ Agent/)
  assert.match(patched, /isOpen=\{isFolderPickerOpen\}/)
  assert.match(patched, /handleFolderSelect/)
})

test('patchBottomToolbarSource throws if upstream has restructured the dropdown', () => {
  const restructured = bottomToolbarSource.replace(/isBypassMenuOpen/g, 'isSkipPermissionsOpen')
  assert.throws(() => patchBottomToolbarSource(restructured), /expected the "Skip permissions/)
})

test('patchBottomToolbarSource throws if upstream has restructured the handler', () => {
  const restructured = bottomToolbarSource.replace(
    'const handleBypassSelect = (bypassPermissions: boolean) => {',
    'const handleBypassSelect = (bypass: boolean) => {'
  )
  assert.throws(() => patchBottomToolbarSource(restructured), /expected the handleBypassSelect/)
})

// The real upstream toolUtils.ts shape (as of the pinned commit), verbatim for
// the function this patches.
const toolUtilsSource = `import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js';

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}
`

test('patchDefaultZoomSource starts a compact-chrome frame at minimum zoom', () => {
  const patched = patchDefaultZoomSource(toolUtilsSource)
  assert.match(patched, /tinytinkerer-chrome'\) === 'compact'/)
  assert.match(patched, /return ZOOM_MIN;/)
  // Every other frame keeps upstream's device-pixel-ratio default untouched —
  // this is a new branch in front of it, not a replacement for it.
  assert.match(patched, /const dpr = window\.devicePixelRatio \|\| 1;/)
  assert.match(patched, /Math\.round\(ZOOM_DEFAULT_DPR_FACTOR \* dpr\)/)
  // Indentation is carried over from the line it displaces, so the patched
  // file still satisfies upstream's own formatter/lint step during the build.
  assert.match(patched, /\n {2}if \(new URLSearchParams/)
  assert.match(patched, /\n {4}return ZOOM_MIN;/)
})

test('patchDefaultZoomSource throws if upstream has restructured defaultZoom', () => {
  const restructured = toolUtilsSource.replace(
    'const dpr = window.devicePixelRatio || 1;',
    'const dpr = getDevicePixelRatio();'
  )
  assert.throws(() => patchDefaultZoomSource(restructured), /expected the `defaultZoom\(\)`/)
})

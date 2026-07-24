import assert from 'node:assert/strict'
import test from 'node:test'
import { patchBottomToolbarSource } from './pixel-agents-source-patch.mjs'

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

import { Button } from '@tinytinkerer/ui'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { useInstallPrompt } from './use-install-prompt'

// The PWA install banner (mobile only). Injected into the shared docked chat body
// as an `installSlot` because it depends on @tinytinkerer/ui + heroicons, which the
// shared App package (app-browser) is not allowed to import.
export const MobileInstallBanner = () => {
  const { canInstall, showIosHint, promptToInstall } = useInstallPrompt()

  if (!canInstall && !showIosHint) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {showIosHint ? (
        <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          On iPhone or iPad, use Share {'>'} Add to Home Screen to install this app.
        </div>
      ) : (
        <div />
      )}
      {canInstall ? (
        <Button
          type="button"
          size="sm"
          className="rounded-full"
          onClick={() => void promptToInstall()}
        >
          <ArrowDownTrayIcon className="mr-1 h-4 w-4" />
          Install app
        </Button>
      ) : null}
    </div>
  )
}

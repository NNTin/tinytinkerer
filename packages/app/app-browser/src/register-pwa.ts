/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'

// How often a long-foregrounded session re-checks for a new service worker.
const UPDATE_INTERVAL_MS = 60 * 60 * 1000

/**
 * Registers the service worker and actively checks for new deployments.
 *
 * The PWA uses `registerType: 'autoUpdate'`, so once a newer service worker is
 * *found* Workbox skips waiting, claims clients, and the page reloads silently.
 * The gap this closes: an installed standalone PWA rarely performs a real
 * navigation (the user just foregrounds it), so the browser never re-fetches
 * `sw.js` on its own and keeps serving the stale precached build. We trigger the
 * check ourselves on foreground and on an hourly interval.
 *
 * Uniform across all shells: where the build emitted no service worker (web and
 * widget configure `vite-plugin-pwa` with `disable: true`), `registerSW`
 * resolves to a no-op and this function does nothing observable. Only mobile
 * ships a service worker today; whether a shell is installable is a per-app vite
 * config choice, not a code-level branch.
 *
 * No-op in environments without service worker support.
 */
export function registerPwa(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) {
        return
      }

      const checkForUpdate = () => {
        // Only check while the app is visible — skip when backgrounded, offline,
        // or already installing — to avoid needless background network/battery use.
        if (
          document.visibilityState !== 'visible' ||
          !navigator.onLine ||
          registration.installing
        ) {
          return
        }
        void registration.update()
      }

      // Highest-value trigger for an installed mobile PWA: the user reopening it.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate()
        }
      })

      // Fallback for a session left open and visible for a long time; the
      // visibility guard in checkForUpdate keeps it idle while backgrounded.
      setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
    }
  })
}

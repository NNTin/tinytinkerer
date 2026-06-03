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
        // Skip while offline or while an install is already in flight.
        if (!navigator.onLine || registration.installing) {
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

      // Fallback for sessions that stay foregrounded for a long time.
      setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
    }
  })
}

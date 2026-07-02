import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { resolvePresentation } from './presentations'
import { createShellRouter } from './app/router'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

// One build, three endpoints. The presentation (web / widget / mobile) is chosen from
// the URL path this bundle was served under; the shared bootstrap gets that
// presentation's router + boot screen, and only the mobile presentation registers the
// service worker (its /mobile/ scope must not leak onto the same-origin /web, /widget).
const presentation = resolvePresentation(window.location.pathname)

createBrowserShellRoot({
  router: createShellRouter(presentation),
  BootScreen: presentation.BootScreen,
  registerServiceWorker: presentation.registersServiceWorker
})

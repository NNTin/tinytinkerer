// A named re-export (not a dynamic namespace import of the barrel) so the router's
// lazy import lets Rollup tree-shake @tinytinkerer/app-browser down to just the
// callback page in the callback chunk, keeping the shared surface out of the entry.
export { BrowserCallbackPage as CallbackPage } from '@tinytinkerer/app-browser'

// What both halves of the host agree on: the eager callback in main.tsx and the
// lazy assistant. Imports only the side-effect-free `/oauth` subpath, so it is
// safe on the startup path (run.mjs measures that it stays so).
import { GITHUB_OAUTH_CALLBACK_PATH } from '@nntin/tinytinkerer-embed/oauth'

export const shellOptions = {
  // Same origin: the acceptance spec answers /api/** with the real edge worker.
  edgeBaseUrl: window.location.origin,
  storageNamespace: 'embed-acceptance',
  githubRedirectUri: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`
}

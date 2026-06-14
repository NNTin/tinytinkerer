import type {
  SandboxCodeExecutor,
  SandboxExecutionRequest,
  SandboxExecutionResult
} from '@tinytinkerer/app-core'

// Resource ceilings the host enforces regardless of what a plugin requests. These
// are the browser-side guardrails behind the product-agnostic SandboxCodeExecutor
// contract: a plugin may ask for a smaller timeout but can never exceed these.
const HARD_TIMEOUT_MS = 10_000
const MAX_CONCURRENT = 3
// Total captured console output budget, measured in UTF-16 code units (~chars),
// enforced BOTH inside the worker and again host-side on the untrusted reply.
const MAX_OUTPUT_CHARS = 4_000_000
// Defence-in-depth caps applied to whatever the (untrusted) sandbox sends back.
const MAX_LOG_LINES = 10_000

// The sandbox bootstrap document. It is fully STATIC — the user's code never
// appears here; it arrives at runtime via postMessage. So nothing the agent
// supplies is ever parsed as HTML. The document:
//   - declares a strict CSP that blocks all network/resource loads (default-src
//     'none', connect-src 'none', img-src 'none', …) and only allows a Worker
//     from a blob: URL (worker-src blob:) plus its own inline bootstrap
//     (script-src 'unsafe-inline'); notably NO 'unsafe-eval'.
//   - builds a Worker whose body embeds the user code as an async function body,
//     so the code runs without eval/new Function.
//   - captures the worker's console output (output-capped) and forwards a single
//     result message to the embedder.
// Because the iframe is created with sandbox="allow-scripts" and NOT
// allow-same-origin, it runs at an opaque origin: the worker and code cannot read
// the parent DOM, storage, cookies, or the app URL.
const SANDBOX_SRCDOC = `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; object-src 'none'; frame-src 'none'; child-src blob:; base-uri 'none'; form-action 'none'; worker-src blob:; script-src 'unsafe-inline'">
</head>
<body>
<script>
(function () {
  var parentWin = window.parent;

  function send(nonce, payload) {
    payload.nonce = nonce;
    payload.type = 'result';
    // Opaque origin on both ends; the embedder validates event.source + nonce.
    parentWin.postMessage(payload, '*');
  }

  function buildWorkerSource(code) {
    return [
      'var __logs = []; var __used = 0; var __capped = false; var __CAP = ' + ${MAX_OUTPUT_CHARS} + ';',
      'function __push(line){',
      '  if (__capped) return;',
      '  var room = __CAP - __used;',
      '  if (line.length >= room) { __logs.push(line.slice(0, room) + " …[output truncated]"); __used = __CAP; __capped = true; return; }',
      '  __used += line.length; __logs.push(line);',
      '}',
      'function __fmt(args){ return Array.prototype.map.call(args, function (a) {',
      '  try { return typeof a === "string" ? a : JSON.stringify(a); }',
      '  catch (e) { return String(a); } }).join(" "); }',
      'var __c = self.console || (self.console = {});',
      '["log","info","warn","error","debug"].forEach(function (m) {',
      '  __c[m] = function () { __push(__fmt(arguments)); }; });',
      'self.onmessage = function (e) {',
      '  var input = e && e.data ? e.data.input : undefined;',
      '  (async function () {',
      '    var __run = async function (input) {',
      code,
      '\\n    };',
      '    try {',
      '      var __result = await __run(input);',
      '      var __safe;',
      '      try { __safe = JSON.parse(JSON.stringify(__result === undefined ? null : __result)); }',
      '      catch (err) { __safe = String(__result); }',
      '      self.postMessage({ ok: true, result: __safe, logs: __logs });',
      '    } catch (err) {',
      '      self.postMessage({ ok: false, error: (err && err.message) ? String(err.message) : String(err), logs: __logs });',
      '    }',
      '  })();',
      '};'
    ].join('\\n');
  }

  function run(nonce, code, input, budget) {
    var url = null;
    var worker = null;
    var done = false;
    var timer = null;

    function finish(payload) {
      if (done) return;
      done = true;
      try { if (timer) clearTimeout(timer); } catch (e) {}
      try { if (worker) worker.terminate(); } catch (e) {}
      try { if (url) URL.revokeObjectURL(url); } catch (e) {}
      send(nonce, payload);
    }

    try {
      var blob = new Blob([buildWorkerSource(code)], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
    } catch (e) {
      finish({ ok: false, error: 'worker creation failed: ' + String((e && e.message) || e), logs: [], timedOut: false });
      return;
    }

    worker.onmessage = function (ev) {
      var d = (ev && ev.data) || {};
      finish({
        ok: d.ok === true,
        result: d.result,
        logs: Array.isArray(d.logs) ? d.logs : [],
        timedOut: false,
        error: typeof d.error === 'string' ? d.error : undefined
      });
    };
    worker.onerror = function (ev) {
      finish({ ok: false, error: (ev && ev.message) ? String(ev.message) : 'worker error', logs: [], timedOut: false });
    };

    // The worker runs on its own thread, so user code that blocks (e.g. while(true))
    // cannot stop this timer from terminating it.
    timer = setTimeout(function () {
      finish({ ok: false, error: 'execution timed out', logs: [], timedOut: true });
    }, budget);

    try { worker.postMessage({ input: input }); }
    catch (e) { finish({ ok: false, error: 'failed to start: ' + String((e && e.message) || e), logs: [], timedOut: false }); }
  }

  window.addEventListener('message', function (event) {
    // Accept only the single setup message from our embedder.
    if (event.source !== parentWin) return;
    var data = event.data || {};
    if (typeof data.nonce !== 'string' || typeof data.code !== 'string') return;
    var budget = typeof data.timeoutMs === 'number' ? data.timeoutMs : ${HARD_TIMEOUT_MS};
    run(data.nonce, data.code, data.input, budget);
  });
})();
</script>
</body>
</html>`

// Coerce the untrusted message from the sandbox into the contract shape. The
// sandbox content is adversarial by assumption, so we never trust types: `result`
// passes through as opaque data (never rendered as HTML by callers), and logs are
// filtered, line-capped, AND total-size-capped here — a real host-side budget that
// does not depend on the (untrusted) worker honoring its own in-worker cap.
export const normalizeResult = (data: Record<string, unknown>): SandboxExecutionResult => {
  const rawLogs = Array.isArray(data.logs) ? data.logs : []
  const logs: string[] = []
  let used = 0
  for (const line of rawLogs) {
    if (typeof line !== 'string') continue
    if (logs.length >= MAX_LOG_LINES || used >= MAX_OUTPUT_CHARS) break
    const room = MAX_OUTPUT_CHARS - used
    if (line.length > room) {
      logs.push(`${line.slice(0, room)} …[output truncated]`)
      break
    }
    logs.push(line)
    used += line.length
  }

  const result: SandboxExecutionResult = {
    ok: data.ok === true,
    logs,
    timedOut: data.timedOut === true
  }
  if ('result' in data) {
    result.result = data.result
  }
  if (typeof data.error === 'string') {
    result.error = data.error
  }
  return result
}

const unavailable = (error: string): SandboxExecutionResult => ({
  ok: false,
  logs: [],
  timedOut: false,
  error
})

// Builds the host's sandboxed-code capability. Each call spins up a fresh hidden,
// opaque-origin iframe (sandbox="allow-scripts", no allow-same-origin,
// referrerPolicy="no-referrer"), runs the code in a Worker inside it, and tears
// the iframe down after completion, error, or timeout. State is limited to a
// concurrency counter shared across calls.
export const createSandboxExecutor = (): SandboxCodeExecutor => {
  let active = 0

  return (request: SandboxExecutionRequest): Promise<SandboxExecutionResult> => {
    if (typeof document === 'undefined' || typeof Worker === 'undefined') {
      return Promise.resolve(unavailable('sandbox unavailable in this environment'))
    }
    if (active >= MAX_CONCURRENT) {
      return Promise.resolve(unavailable('sandbox busy: too many concurrent executions'))
    }

    active += 1

    const nonce =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sbx-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const budget = Math.min(
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? request.timeoutMs
        : HARD_TIMEOUT_MS,
      HARD_TIMEOUT_MS
    )

    const iframe = document.createElement('iframe')
    // allow-scripts ONLY — never allow-same-origin (keeps the origin opaque).
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('title', 'code execution sandbox')
    iframe.style.display = 'none'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.srcdoc = SANDBOX_SRCDOC

    return new Promise<SandboxExecutionResult>((resolve) => {
      let settled = false

      const onMessage = (event: MessageEvent): void => {
        // Strict boundary: only this iframe's window, matching nonce + type.
        if (event.source !== iframe.contentWindow) return
        const data = event.data as Record<string, unknown> | null
        if (!data || data.nonce !== nonce || data.type !== 'result') return
        finish(normalizeResult(data))
      }

      const finish = (result: SandboxExecutionResult): void => {
        if (settled) return
        settled = true
        window.removeEventListener('message', onMessage)
        clearTimeout(backstop)
        iframe.remove()
        active -= 1
        resolve(result)
      }

      window.addEventListener('message', onMessage)

      // Hard backstop in case the iframe itself is wedged and never replies. The
      // iframe enforces its own (equal) timeout against the worker; this fires a
      // little later and destroys the iframe outright.
      const backstop = setTimeout(() => {
        finish({ ok: false, logs: [], timedOut: true, error: 'execution timed out' })
      }, budget + 500)

      iframe.onload = (): void => {
        // The bootstrap registered its listener before load fired. Send the code;
        // targetOrigin '*' is safe — the payload carries no app secrets, only the
        // code/input the sandbox is meant to run.
        iframe.contentWindow?.postMessage(
          {
            nonce,
            code: request.code,
            input: request.input ?? null,
            timeoutMs: budget
          },
          '*'
        )
      }

      // Guard the only synchronously-throwing step (e.g. no document.body): on
      // failure settle immediately via finish() so the concurrency slot is freed
      // rather than held until the backstop fires (or leaked entirely).
      try {
        document.body.appendChild(iframe)
      } catch (error) {
        finish(
          unavailable(
            `sandbox setup failed: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        )
      }
    })
  }
}

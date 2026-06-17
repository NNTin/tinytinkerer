# Define a diagnostic and use it at an error site

Goal: turn an ad-hoc `console.error('...')` / `throw new Error('...')` into a stable, code-named nostics diagnostic — without leaking dev machinery into the production bundle.

## 0. Decide: is nostics even the right tool?

- The string is a **developer hint in a browser shell** (something a dev/agent should see and act on locally) → yes, continue.
- The string is part of **production error handling** (an edge response, something Sentry must capture, a contract a client depends on) → **stop**. Use the edge error contract (`edgeErrorResponseSchema`) and Sentry (`sentry-debugging` skill). nostics is stripped from prod and cannot carry prod behaviour.

## 1. Add (or reuse) the code in the one foundation module

Edit `packages/app/app-browser/src/diagnostics.ts`. Add an entry under `codes`:

```ts
TT_<AREA>_<WHAT_FAILED>: {
  // `why` and `fix` are static strings OR typed builders. A builder's param
  // object is inferred — the call site is type-checked against it.
  why: (p: { resource: string }) =>
    `Could not load "${p.resource}". <what this breaks for the user/dev>.`,
  fix: (p: { resource: string }) =>
    `<concrete next step referencing "${p.resource}">.`,
  // optional: `docs: '<url>'` to override docsBase for this code.
},
```

Conventions:

- **Name:** `SCREAMING_SNAKE_CASE`, `TT_` prefix, area + what failed. Stable forever — it is the grep key and the docs anchor.
- **`why`** = why it failed / what it breaks. **`fix`** = the actionable next step. Keep both one or two sentences.
- Use a **typed builder** (`(p: {...}) => ...`) when the message needs runtime values; a plain string when it doesn't.
- `docsBase` already turns the code into a link to `docs/diagnostics.md#<lowercased-code>` — add a matching `###` heading there (see step 4).

## 2. Use it at the error site — choose report vs throw deliberately

`import { diagnostics } from './diagnostics'` (relative path; the module lives in `@tinytinkerer/app-browser`, so reach it relatively — never via a cross-package `@tinytinkerer/*` import).

- **Report-only** (the call is its own expression statement): the strip transform wraps it in `process.env.NODE_ENV !== 'production'`, so it — and its reporters — **tree-shake completely out of prod**. Use for non-fatal dev hints:
  ```ts
  diagnostics.TT_AREA_THING_FAILED({ resource: 'x', cause: error })
  ```
- **Throw** (a `ThrowStatement`): the diagnostic is a real `Error` and **survives in prod** (its reporters are still dev-gated and stripped). Use when the code path must actually fail:
  ```ts
  throw diagnostics.TT_AREA_THING_FAILED({ resource: 'x', cause: error })
  ```

Runtime extras (merged into the same params object): `cause` (preserve the original error), `sources` (`['file:line:col', ...]` for compiler-style locations).

## 3. Typecheck, lint, boundaries

```bash
pnpm --filter @tinytinkerer/app-browser exec tsc -p tsconfig.json   # types incl. builder params
pnpm --filter @tinytinkerer/app-browser exec eslint src
node scripts/check-boundaries.mjs
```

(If tsc complains about missing `*.generated.ts`, run `pnpm generate:brand-assets && pnpm generate:notices` first — those are gitignored build artifacts.)

## 4. Document the code

Add a `### TT_<AREA>_<WHAT_FAILED>` section to `docs/diagnostics.md` (the `docsBase` link target). One line each for _why_ and _fix_, mirroring the definition.

## 5. Prove prod is unaffected

```bash
pnpm --filter @tinytinkerer/web exec vite build
grep -rl "TT_<AREA>_<WHAT_FAILED>" apps/web/dist   # expect: no output for a report-only code
grep -rlF "nostics:report" apps/web/dist           # expect: no output (dev collector channel)
```

A report-only code must leave **zero** matches. A thrown code leaves the `Diagnostic` itself (by design) but still **no reporters / no `nostics:report`**. Then `pnpm format` and you are done.

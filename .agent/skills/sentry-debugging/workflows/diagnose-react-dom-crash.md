# Workflow: Diagnose a React `removeChild` / reconciliation crash

Goal: given a frontend `handled: no` crash whose stacktrace is entirely inside `react-dom`
(`NotFoundError: Failed to execute 'removeChild' on 'Node'`,
`Failed to execute 'insertBefore'`, "is not a child of this node"), decide whether it's
**our code** mutating the React tree or an **external agent** (browser translation / extension)
mutating React-owned DOM — so you fix the real cause instead of swallowing it.

This is the `handled: no` branch of `triage-issues.md` step 5 for React DOM exceptions. Read the
**Triage philosophy** in `../SKILL.md` first.

## The signature (what these crashes look like)

- `mechanism: auto.browser.global_handlers.onerror` (an uncaught error caught by `window.onerror`).
- Title `NotFoundError: ... 'removeChild' ... not a child of this node` with tag `DOMException.code: 8`,
  or the `insertBefore` variant.
- The stacktrace is **100% `react-dom` frames** — `commitDeletionEffectsOnFiber`,
  `recursivelyTraverseMutationEffects`, `removeChildFromContainer`, `commitMutationEffectsOnFiber`.
  **No first-party frame** appears, because the crash happens inside React's commit phase, not at
  one of our call sites.

`removeChildFromContainer` specifically means React is removing a node that is a **direct child of a
root/portal container** — i.e. a top-level node — and the browser reports it is no longer there.

## Steps

1. **Confirm there's no first-party frame.** If our code *does* appear (a component calling
   `removeChild`/`appendChild`/`createPortal` on a node it doesn't own), that's the bug — fix it.
   Grep the source for direct DOM mutation:
   ```bash
   grep -rn "removeChild\|appendChild\|insertBefore\|replaceChild\|createPortal\|document\.body\|innerHTML" \
     --include=*.ts --include=*.tsx apps/ packages/ | grep -v node_modules | grep -v '\.test\.'
   ```
   Appends to `<head>` (e.g. injecting `<link>`/`<style>`) and setting `dataset`/attributes are **not**
   the cause — they don't touch the React tree. If nothing in our code removes a node React owns,
   the mutation is **external** → step 2.

2. **Check the environment tags for an external DOM mutator.** The dominant external cause is
   **in-browser translation** (Google Translate / Chrome's built-in translate / the Edge equivalent).
   It rewrites text nodes into `<font>` wrappers, detaching the exact nodes React tracks; React's next
   `removeChild`/`insertBefore` then fails. Strong tells in the issue:
   - `culture.locale` / `user.geo` is a **different language than the UI** (e.g. `de` user on an
     English app) → the browser offered to translate.
   - `DOMException.code: 8` (`NotFoundError`) on `removeChild`, via `onerror`.
   - Reproduces for a single user, sporadically, only on real browsers (never in tests/CI).
   Browser extensions that inject/rewrite DOM (ad blockers, Grammarly, password managers) cause the
   same class; translation is the most common.

3. **Decide & fix:**
   - **External mutation (translation/extension)** → not a logic bug, but **don't `accept`/`ignore`**
     it — `accept` only covers `handled: yes` request telemetry, and this is a real `handled: no`
     crash that breaks the user's session. Fix it by opting the React-managed shell **out of
     automatic translation** in each SPA's `index.html`:
     ```html
     <html lang="en" translate="no">
       ...
       <meta name="google" content="notranslate" />
     ```
     Translation engines honour `translate="no"` / the `notranslate` meta and skip the subtree, so
     they stop mutating React-owned DOM. (You generally don't want the live chat UI machine-translated
     into broken markup anyway.) Apply to **all** SPA shells that share the pattern
     (`apps/widget`, `apps/web`, `apps/mobile`) — the crash fires wherever a translating user lands;
     it's the same vulnerable shell, not one app's bug.
   - **Our code mutating a node it doesn't own** (found in step 1) → remove the manual DOM mutation;
     render through React, or scope the manual node outside the React root. Wrap conditionally-rendered
     bare text in an element (`<span>`) so a mutator can't strand a tracked text node.

4. **Verify & resolve.** There's no unit test for browser-translation behaviour — note that in the PR.
   Set the Sentry issue `resolvedInNextRelease` with a `reason` naming the `index.html` files and the
   root cause, so it **auto-reopens** if the crash recurs after the fix ships (the honest signal that
   the hypothesis was wrong).

## Notes

- `removeChildFromContainer` (container-level) vs `removeChild` (mid-tree) tells you the stranded node
  was a **top-level** child of the root/portal — consistent with translation rewriting the visible
  text shell.
- If `resolvedInNextRelease` reopens, the translation hypothesis was wrong: re-open step 1 and look
  harder for a portal/double-unmount in our code, or an extension-specific mutation.

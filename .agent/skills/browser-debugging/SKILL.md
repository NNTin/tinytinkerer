# browser-debugging

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # markdown SOPs (step-by-step procedures)
  tools/        # deterministic scripts the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. Scan workflow **filenames** for a relevant SOP — don't read every file.
3. Follow the SOP; run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Drive the running `pnpm dev` app with **agent-browser** to debug it in a real browser. Read `../../README.md` first for the WAT framework.

`agent-browser` is a fast CDP browser-automation CLI (snapshot → `@ref` → act). This skill gets you from a cold `pnpm dev` to a logged-in app you can inspect, and codifies the repo-specific gotchas (iframes, consent gate, token scope) so you don't rediscover them.

## When to use

- You changed frontend behaviour and want to see/exercise it in a real browser (click through a flow, read console/network errors, screenshot) instead of only running tests.
- A bug only reproduces in the browser against the live dev servers.
- You need the app **signed in to GitHub** to reach model/auth-gated UI while debugging.

## How

1. Start the dev servers (frontend `:3111`, edge `:8787`) — see `workflows/debug-pnpm-dev.md`.
2. Run the startup tool: `node .agent/skills/browser-debugging/tools/browser-login.mjs`. It opens the app, consents to the privacy notice if it pops up, and signs in with the PAT from `$GITHUB_MODELS_TOKEN` (or `.env.github` as a fallback).
3. Drive the app with `agent-browser` (`snapshot -i`, `console`, `errors`, `network requests`, `screenshot`). Read `agent-browser skills get core --full` once if you're unsure of a command.
4. Scan `workflows/` filenames for a matching SOP. Capture a new SOP if you solve something repeatable.

## Available tools

- `tools/browser-login.mjs [--port 3111] [--url <url>] [--token-file <path>]` — opens the web shell (`http://localhost:3111/web/`), accepts the telemetry/privacy consent if shown, and signs in via personal access token. Reads the PAT **by reference** from the `GITHUB_MODELS_TOKEN` environment variable, falling back to `.env.github` (repo root) when it is unset. Self-heals a hung browser session (closes all + retries the open once). Verifies the session actually stuck and fails loudly with a scope diagnostic if the app drops the token.
- `agent-browser` — the CLI itself. Snapshot-and-`@ref` loop; re-snapshot after every page change. Sessions persist across invocations until `agent-browser close --all`.

## Constraints

- **The frontend lives at `/web/`, not `/`.** The host root (`:3111/`) embeds web/mobile/widget in **iframes**, which top-level `eval`/`querySelector` can't see across. Always target `http://localhost:3111/web/` (the tool does this by default).
- **Token by reference only.** The PAT comes from the `GITHUB_MODELS_TOKEN` environment variable (exported in `~/.bashrc`), falling back to the gitignored `.env.github` file when unset. Never echo it, write it into the repo, or commit it. The value is only ever handed to the local browser.
- **The PAT must pass `api.github.com/user`.** On load the app probes `/user` and **drops any token that 401s** (`packages/app/app-browser/src/github-user.ts`). A Models-only fine-grained PAT (`models:read` but no profile access) 401s there, so the login won't persist — the tool detects this and fails with a clear message. Use a classic PAT, or a fine-grained token with read access to your profile, for a session that sticks.
- **Don't `close` the session until you're done.** State (consent, conversation) lives in the browser; closing wipes it and forces re-consent/re-login. Use `agent-browser close --all` only at the end (it also clears a wedged session).
- The edge worker may fail to build if deps are stale (`Could not resolve "@hono/zod-openapi"` → run `pnpm install`). The frontend and PAT login work without the edge; model/chat calls that proxy to `:8787` won't.
- Don't fabricate a signed-in state. If `browser-login.mjs` exits non-zero, report the reason — don't claim the app is authenticated.

## Success criteria

The dev servers are up, the app is open at `/web/`, the privacy notice is consented, and either the GitHub session is signed in (sign-in entry point gone) **or** the tool has clearly reported why it couldn't stick. You can then `snapshot`/`console`/`errors`/`network` against the live app to debug.

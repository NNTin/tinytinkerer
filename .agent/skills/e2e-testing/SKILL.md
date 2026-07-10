# e2e-testing

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # OPTIONAL: markdown SOPs (some skills are just SKILL.md + tools/)
  tools/        # deterministic scripts SKILL.md / the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. If it has `workflows/`, scan their **filenames** for a relevant SOP — don't read every file.
3. Follow `SKILL.md` (and the SOP, if any); run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Create Playwright e2e tests in `packages/e2e` that drive a real chat run where **only LiteLLM
inference is mocked** — and mock it with **real captured token streams**, not hand-written tool
calls. The mocked model replays the exact SSE bytes a real model produced against a live frontend,
so the tests verify the true pipeline (edge worker in-process, agent runtime, tool registry,
app-bridge, sandboxed app iframe, media handling, UI) against real model behaviour.

## When to use

- Adding e2e coverage for a feature the model drives through chat (a tool/verb, a plugin flow,
  a media pipeline) — anything where "what would the model actually send?" matters.
- Refreshing existing capture fixtures after a prompt/tool-schema change shifts model behaviour.
- NOT for whiteboard-only interactions with no chat turn — use `fixtures/canvas.ts`'s hermetic
  `openCanvas` (it blocks `/api/**`) and the bridge helpers instead.

## How

1. Read `workflows/create-e2e-test.md` — the end-to-end SOP (design scenario → capture → commit
   fixture → write spec → verify).
2. Capture real inference with `tools/capture-llm-stream.mjs` (see below) against the dev frontend
   or the PR-specific preview. The capture is **anonymous** and the live frontend has **real rate
   limits** — the tool waits through 429/backoff cycles; expect a scenario to take minutes, and do
   not tighten its patience budgets.
3. Commit the fixture JSON under `packages/e2e/fixtures/captures/` and write the spec with
   `installReplayMock` (`packages/e2e/fixtures/mock-litellm.ts`), which serves the captured SSE
   bodies verbatim, in order, with a loud drift check per request.
4. In tests, assume **no rate limits and an unauthenticated (anonymous) run** — that is the
   intrinsic posture of `mock-litellm.ts`: the page's `/api/**` pipes through the REAL edge Hono
   worker in-process (anonymous-tier key provisioning runs for real, `RATE_LIMIT_*_MAX: '0'`), and
   only the edge's outbound LiteLLM calls are answered from the fixture.

## Available tools

- `tools/capture-llm-stream.mjs --scenario <file.json> [--target dev|pr] [--url <base>] [--out <path>]`
  — drives the live frontend headlessly and records every `/api/models/chat` exchange (verbatim
  SSE response body + a compact request digest) into a replayable fixture.
  - `--target dev` (default) → `https://dev.tiny.nntin.xyz`. `--target pr` → builds the preview URL
    from CI convention `https://pr-<number>-<branch-slug>.tiny.preview.nntin.xyz` (PR number +
    branch via `gh pr view`, slashes in the branch slugified to dashes). `--url` overrides both.
  - The scenario file configures the run: which shell (`/canvas/`, `/web/`, `/mobile/`,
    `/widget/`), which Settings toggles/plugins to enable or disable (by their Settings label,
    e.g. `"Show reasoning & activity"`, `"Code execution (run_javascript tool)"`), and the ordered
    steps to perform (send a prompt and wait for the run to settle, click the canvas, press a key,
    wait for text — enough to drive human-in-the-loop tools like interactive `pick`).
  - Rate-limit patience is built in: a 429'd exchange is recorded as skipped and the tool keeps
    waiting for the client's automatic retry instead of failing or re-prompting.

## Constraints

- **Only LiteLLM is mocked in tests.** Never mock the edge worker, the bridge, the iframe, tool
  execution, or the media pipeline; never intercept `/api/**` with anything but the mock's
  edge-piping routes.
- **Capture anonymously; tests run unauthenticated.** Do not wire real tokens/secrets into the
  suite or fixtures.
- **Fixtures are committed** (deterministic CI) and must contain no secrets: the tool stores only
  a request digest (system-prompt prefix, tool-result count, media refs, last user text), never
  headers, cookies, or keys. Eyeball a new fixture before committing anyway.
- **Replay is verbatim except one normalization**: `media:<uuid>#<n>` handles in captured content
  are re-keyed to the replaying run's step uuids (the runtime mints new step ids per session, so
  the captured refs can never match). The swap is length-preserving; every other byte of the
  stream is served as captured.
- Respect the live frontend: keep scenarios short, don't loop captures, and be patient — the
  429 backoff (`retryAfterMs`) is typically 60s.
- The `/canvas/` composer placeholder differs from `/web/` — locate composers by accessible name
  (`Message` textbox, `Send` button), never by placeholder text.
- Capture and replay must line up: the spec must recreate the scenario's environment (same shell,
  same plugins, same prompts in the same order, same human-in-the-loop actions), or the replay
  drift check will fail the run loudly — that failure means the pipeline or the scenario changed,
  not that the check is wrong.

## Success criteria

- The fixture JSON exists under `packages/e2e/fixtures/captures/`, produced by the capture tool
  (its `meta` block says so), with at least one successful exchange per model turn the scenario
  needs.
- The spec passes via `pnpm --filter @tinytinkerer/e2e e2e -- --project=chromium <spec>` with the
  pass count visible in the output (silence is not success), and the full suite stays green.
- Assertions cover both sides: the folded-back tool results in `mock.requestBodies()` (what the
  model context saw) AND the rendered UI (activity panel, transcript media) — not just one.

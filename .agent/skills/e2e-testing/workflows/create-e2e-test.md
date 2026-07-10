# Create an e2e test from a captured inference stream

SOP for adding a Playwright e2e test whose mocked model replays real captured token streams.
Prereq: read `../SKILL.md` for the posture (only LiteLLM mocked, anonymous, no rate limits in
tests) and the constraints.

## 1. Design the scenario

Decide, before touching the live frontend:

- **Shell**: `/canvas/`, `/web/`, `/mobile/`, or `/widget/`. Canvas has the excalidraw verbs;
  web/widget/mobile have the plugin tools (code exec, ask_user, …).
- **Setup**: which Settings toggles the test needs (e.g. `Show reasoning & activity`, a plugin).
  The test must enable the SAME toggles — capture and replay must line up.
- **Prompts**: the exact user message(s). Fewer, more specific prompts → fewer model turns →
  smaller fixture and less rate-limit waiting. Phrase prompts to strongly bias the model toward
  the tool under test ("Use the thumbnail tool…").
- **Human-in-the-loop actions**: if the tool blocks on the user (interactive `pick`, `ask_user`),
  plan the exact click/keypress and encode it as scenario steps between the prompt and the settle.
- **One scenario per test.** A fixture is one conversation; a test replays that whole
  conversation. Don't share a conversation across tests.

Write the scenario JSON (see existing files under `scenarios/` next to the fixtures, or the tool's
`--help`):

```json
{
  "name": "canvas-thumbnail",
  "shell": "/canvas/",
  "settings": ["Show reasoning & activity"],
  "steps": [
    {
      "prompt": "Draw a red rectangle and a blue ellipse side by side, then take a thumbnail of the canvas and show it to me."
    }
  ]
}
```

Step kinds: `{ "prompt": "…" }` (send + wait for the run to settle; add `"await": false` to skip
the settle when the run will block on a later step), `{ "waitText": "…" }` (wait for text on the
page or inside the app iframe — e.g. a toast), `{ "clickCanvas": "center" }` or
`{ "clickCanvas": { "x": 640, "y": 400 } }` (iframe-relative), `{ "press": "Control+a" }`,
`{ "sleepMs": 1000 }`.

## 2. Capture

```sh
node .agent/skills/e2e-testing/tools/capture-llm-stream.mjs \
  --scenario packages/e2e/fixtures/captures/scenarios/canvas-thumbnail.json \
  --target pr \
  --out packages/e2e/fixtures/captures/canvas-thumbnail.json
```

- `--target pr` needs a PR for the current branch (`gh pr view` must resolve); use `--target dev`
  for `https://dev.tiny.nntin.xyz` or `--url` for anything else.
- **Be patient.** The live frontend rate-limits (429 with `retryAfterMs`, typically 60s); the
  client retries by itself and the tool waits through it. A 3-turn scenario can take several
  minutes. Don't kill and re-run in a loop — that only burns more budget.
- The tool prints each captured exchange as it lands. When it exits, eyeball the fixture: one
  successful exchange per expected model turn (decide/act turns + the final synthesis), sensible
  request digests, no secrets.

## 3. Write the spec

- Open the run with the fixture: on canvas, `openCanvasWithChat(page, fixture)` from
  `fixtures/canvas-chat.ts`; on web/widget/mobile, `installReplayMock(page, fixture)` from
  `fixtures/mock-litellm.ts` + `page.goto(...)`.
- Recreate the scenario environment exactly: same Settings toggles (use the `enable*` helpers),
  same prompts in the same order (import the scenario JSON and reuse its `steps` text — never
  retype prompts), same human-in-the-loop actions.
- Assert on BOTH sides of the pipeline:
  - Model context: `toolResultFor(mock, '<tool>')` / `mock.requestBodies()` — what folded back
    (e.g. `mediaRef` present, no base64, projected fields exact).
  - UI: activity panel entries/images, transcript media (`figure[data-tt-image] img` with a
    `data:` src), toasts. Gate canvas verbs on `data-app-frame-status="ready"`.
- The replay mock enforces per-request drift checks (system-prompt class + folded tool-result
  count). If it throws, the runtime is making different requests than the capture — fix the spec
  or re-capture; don't loosen the check.

## 4. Verify and commit

- `pnpm --filter @tinytinkerer/e2e e2e -- --project=chromium <spec-name>` — confirm the pass count
  in the output.
- Full suite + repo gate before committing (see repo docs); commit the scenario JSON, the fixture,
  and the spec together so a future re-capture has everything it needs.

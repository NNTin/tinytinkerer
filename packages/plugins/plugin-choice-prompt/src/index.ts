import {
  boundedPreview,
  choicePromptInputSchema,
  choicePromptResultSchema,
  type ActivitySummarizer,
  type ActivityView,
  type AgentPlugin,
  type ChoicePromptInput,
  type ChoicePromptResult,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type Tool
} from '@tinytinkerer/contracts'

// Stable id used as the activation key for this plugin.
export const CHOICE_PROMPT_PLUGIN_ID = 'choice-prompt'

// Stable id of the contributed tool. It must stay 'ask_user' so planning, the
// LiteLLM tool descriptor, and the turn-activity panel keep recognising the tool.
export const ASK_USER_TOOL_ID = 'ask_user'

// Longest custom answer the activity panel inlines before truncating. The full
// answer still reaches the model — the panel only needs a readable preview.
const MAX_ANSWER_PREVIEW_CHARS = 300

// Single source of truth for the planner-facing description: the manifest
// descriptor and the runtime tool reference the same string so they cannot drift.
const ASK_USER_DESCRIPTION =
  'Ask the user a question and wait for their answer when you need a decision only ' +
  'they can make — a preference, a disambiguation between options, or missing ' +
  'information you cannot infer. Provide clear, distinct `options`; set ' +
  '`allowCustom` (default true) to also let them type their own answer. Use it ' +
  'sparingly: only when proceeding without the user would be a guess.'

// Choice-prompt presentation owned by the plugin, not the host. Maps the call's
// raw input ({ question, options }) and the result ({ kind, … }) to the host's
// product-agnostic ActivityView so the turn-activity panel renders the durable
// record — the question asked and the answer given — without knowing this plugin
// exists. Pure and React-free (enforced by scripts/check-boundaries.mjs): the host
// renders the returned `value`s as plain text. This is also the DURABLE conversation
// artifact for #85 — the live poll is host-rendered, but the answered poll persists
// and replays through these tool events.
export const summarizeChoicePromptActivity: ActivitySummarizer = (output, input): ActivityView => {
  const question = typeof input?.question === 'string' ? input.question : ''
  const rawOptions = Array.isArray(input?.options) ? input.options : []
  const options = rawOptions.filter((option): option is string => typeof option === 'string')

  const sections: ActivityView['sections'] = []
  if (question.length > 0) {
    sections.push({ kind: 'text', label: 'Question', value: question })
  }
  if (options.length > 0) {
    sections.push({ kind: 'text', label: 'Options', value: options.join('\n') })
  }

  const result = (output ?? {}) as Partial<ChoicePromptResult> & { value?: unknown; text?: unknown }
  let answer: string
  let status: ActivityView['status']
  switch (result.kind) {
    case 'option':
      answer = typeof result.value === 'string' ? result.value : ''
      status = 'ok'
      break
    case 'custom':
      answer =
        typeof result.text === 'string'
          ? `${boundedPreview(result.text, MAX_ANSWER_PREVIEW_CHARS)} (typed)`
          : ''
      status = 'ok'
      break
    case 'dismissed':
      // The user declined to answer — a normal outcome, not an error, but worth
      // the neutral 'warn' cue so the timeline shows the poll went unanswered.
      answer = '(dismissed)'
      status = 'warn'
      break
    default:
      answer = ''
      status = 'unknown'
  }
  sections.push({ kind: 'text', label: 'Answer', value: answer })

  return { title: 'Asked the user', status, sections }
}

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from contracts; this plugin ships its own copy and tool descriptor.
// No `defaultEnabled`: the first interactive human-in-the-loop tool blocks the run
// on the user, so it ships OFF and the user opts in via Settings (D5). It appears
// in the generic plugin-activation list like every other plugin.
export const choicePromptPluginManifest: PluginManifest = {
  id: CHOICE_PROMPT_PLUGIN_ID,
  label: 'Choice prompt (ask you a question)',
  description:
    'Let the assistant ask you a question with selectable options — and, when ' +
    'allowed, a free-text answer — then continue the conversation with your ' +
    'choice. Makes the chat two-way. Needs a host that can prompt you (the browser ' +
    'app); off by default.',
  toolDescriptors: [
    {
      id: ASK_USER_TOOL_ID,
      description: ASK_USER_DESCRIPTION,
      // Canonical schema (issue #287): the SAME Zod schema the tool validates input
      // against (see createAskUserTool). The host generates the planner-visible JSON
      // Schema from it, so the descriptor can never drift from the runtime contract.
      schema: choicePromptInputSchema,
      summarizeActivity: summarizeChoicePromptActivity
    }
  ]
}

// Builds the ask_user tool against the host's choice-prompt capability. The host
// owns the live poll UI; this tool only forwards its parsed input to the host and
// returns the user's answer as the tool result. It stays product-agnostic — no
// browser APIs, no React, no app-browser imports.
const createAskUserTool = (
  requestUserChoice: NonNullable<PluginHost['requestUserChoice']>
): Tool<ChoicePromptInput, ChoicePromptResult> => ({
  id: ASK_USER_TOOL_ID,
  description: ASK_USER_DESCRIPTION,
  schema: choicePromptInputSchema,
  // Output contract (issue #287): the runtime re-validates the host-produced result
  // before the inspector/timeline/model consume it. `dismissed` is part of the
  // union, so a user who declines is a valid result, not a tool failure.
  outputSchema: choicePromptResultSchema,
  // This tool BLOCKS on a human (issue #85). The flag tells the runtime to grant it
  // the human-input budget instead of the 10s machine timeout, and to treat it as
  // self-gating (exempt from the permission gate) — see Tool.awaitsHumanInput.
  awaitsHumanInput: true,
  async execute(input) {
    // The request IS the input — `{ question, options, allowCustom }` is everything
    // the host needs to render the poll. The host resolves with the user's answer.
    return requestUserChoice(input)
  }
})

// The choice-prompt plugin. Contributes a single ask_user tool built against the
// host's choice-prompt capability; needs no activate/deactivate lifecycle. A host
// that cannot prompt a human (headless/edge) simply gets no tool — the plugin
// tolerates the capability's absence rather than contributing a tool that can never
// be answered, exactly mirroring how web-search tolerates a missing edgeFetch.
export const choicePromptPlugin = (): AgentPlugin => ({
  id: CHOICE_PROMPT_PLUGIN_ID,
  createTools: (host): Tool<unknown, unknown>[] =>
    host.requestUserChoice ? [createAskUserTool(host.requestUserChoice)] : []
})

// PluginModule contract surface: the named exports a host discovers dynamically.
// `manifest` and `createPlugin` are the only members the host relies on.
export const manifest: PluginManifest = choicePromptPluginManifest
export const createPlugin: PluginModule['createPlugin'] = choicePromptPlugin

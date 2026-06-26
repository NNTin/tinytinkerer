import {
  choicePromptInputSchema,
  choicePromptResultSchema,
  isPluginModule,
  toolInputJsonSchema,
  type ChoicePromptResult,
  type HumanPromptResult,
  type PluginHost
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as choicePromptModule from '../src/index'
import {
  ASK_USER_TOOL_ID,
  CHOICE_PROMPT_PLUGIN_ID,
  choicePromptPlugin,
  choicePromptPluginManifest,
  summarizeChoicePromptActivity
} from '../src/index'

const hostWith = (requestHumanInput: NonNullable<PluginHost['requestHumanInput']>): PluginHost => ({
  capture: vi.fn(),
  requestHumanInput
})

// A host whose single human-input prompt resolves with the given answer.
const choiceFor = (result: HumanPromptResult) =>
  vi.fn<NonNullable<PluginHost['requestHumanInput']>>().mockResolvedValue(result)

const askInput = { question: 'Pick a colour', options: ['Red', 'Blue'], allowCustom: true }

describe('choicePromptPlugin', () => {
  it('is a valid, discoverable plugin module', () => {
    expect(isPluginModule(choicePromptModule)).toBe(true)
    expect(choicePromptPluginManifest.id).toBe(CHOICE_PROMPT_PLUGIN_ID)
    // First HITL tool ships OFF — it blocks the run on the user (D5).
    expect(choicePromptPluginManifest.defaultEnabled).toBeUndefined()
  })

  it('exposes the ask_user tool only when the host can prompt a human', () => {
    const withCapability = choicePromptPlugin().createTools?.(
      hostWith(choiceFor({ kind: 'dismissed' }))
    )
    expect(withCapability?.map((tool) => tool.id)).toEqual([ASK_USER_TOOL_ID])

    // A headless host omits requestHumanInput → no tool (graceful degradation),
    // mirroring web-search tolerating a missing edgeFetch.
    const withoutCapability = choicePromptPlugin().createTools?.({ capture: vi.fn() })
    expect(withoutCapability).toEqual([])
  })

  it('builds the poll view and maps a picked option back to a choice result', async () => {
    const requestHumanInput = choiceFor({ kind: 'action', id: 'Blue' })
    const [tool] = choicePromptPlugin().createTools?.(hostWith(requestHumanInput)) ?? []

    expect(tool?.awaitsHumanInput).toBe(true)
    expect(tool?.schema).toBe(choicePromptInputSchema)
    expect(tool?.outputSchema).toBe(choicePromptResultSchema)

    const result = await tool?.execute(askInput)

    // The plugin owns the view: a dialog poll whose options become actions, the
    // question is the body, free text is allowed, and a Skip dismiss is offered.
    expect(requestHumanInput).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'dialog',
        ariaLabel: 'Assistant question',
        description: 'Pick a colour',
        allowCustom: true,
        actions: [
          { id: 'Red', label: 'Red' },
          { id: 'Blue', label: 'Blue' }
        ],
        dismissAction: { label: 'Skip' }
      })
    )
    // A picked action maps back: the action id IS the option value.
    expect(result).toEqual({ kind: 'option', value: 'Blue' })
  })

  it('maps a typed custom answer and a dismissal back to choice results', async () => {
    const [customTool] =
      choicePromptPlugin().createTools?.(hostWith(choiceFor({ kind: 'custom', text: 'teal' }))) ??
      []
    expect(await customTool?.execute(askInput)).toEqual({ kind: 'custom', text: 'teal' })

    const [dismissedTool] =
      choicePromptPlugin().createTools?.(hostWith(choiceFor({ kind: 'dismissed' }))) ?? []
    expect(await dismissedTool?.execute(askInput)).toEqual({ kind: 'dismissed' })
  })
})

describe('choice-prompt canonical schema (issue #287)', () => {
  const descriptor = choicePromptPluginManifest.toolDescriptors?.[0]

  it('descriptor schema is the SAME schema the runtime tool validates against', () => {
    const [tool] =
      choicePromptPlugin().createTools?.(hostWith(choiceFor({ kind: 'dismissed' }))) ?? []
    expect(descriptor?.id).toBe(ASK_USER_TOOL_ID)
    expect(descriptor?.schema).toBe(choicePromptInputSchema)
    expect(descriptor?.schema).toBe(tool?.schema)
  })

  it('generates a strict-acceptable JSON Schema with the required fields', () => {
    const json = toolInputJsonSchema(descriptor!.schema)
    expect(json.type).toBe('object')
    expect(json).toHaveProperty('properties')
    // question + options are required; allowCustom has a default so it is optional.
    expect(json.required).toContain('question')
    expect(json.required).toContain('options')
    expect(json.required).not.toContain('allowCustom')
  })
})

describe('choicePromptResultSchema', () => {
  it('accepts the three terminal outcomes, including dismissed', () => {
    const valid: ChoicePromptResult[] = [
      { kind: 'option', value: 'Red' },
      { kind: 'custom', text: 'teal' },
      { kind: 'dismissed' }
    ]
    for (const result of valid) {
      expect(choicePromptResultSchema.safeParse(result).success).toBe(true)
    }
  })

  it('rejects an unknown outcome kind', () => {
    expect(choicePromptResultSchema.safeParse({ kind: 'other' }).success).toBe(false)
  })
})

describe('summarizeChoicePromptActivity', () => {
  it('renders the question, options and the chosen option as the durable record', async () => {
    const view = await summarizeChoicePromptActivity({ kind: 'option', value: 'Blue' }, askInput)
    expect(view.title).toBe('Asked the user')
    expect(view.status).toBe('ok')
    const labels = view.sections.map((section) => section.label)
    expect(labels).toEqual(['Question', 'Options', 'Answer'])
    const answer = view.sections.find((section) => section.label === 'Answer')
    expect(answer?.kind === 'text' && answer.value).toBe('Blue')
  })

  it('marks a typed custom answer and a dismissal distinctly', async () => {
    const custom = await summarizeChoicePromptActivity({ kind: 'custom', text: 'teal' }, askInput)
    const customAnswer = custom.sections.find((section) => section.label === 'Answer')
    expect(customAnswer?.kind === 'text' && customAnswer.value).toContain('teal')
    expect(customAnswer?.kind === 'text' && customAnswer.value).toContain('typed')

    const dismissed = await summarizeChoicePromptActivity({ kind: 'dismissed' }, askInput)
    expect(dismissed.status).toBe('warn')
    const dismissedAnswer = dismissed.sections.find((section) => section.label === 'Answer')
    expect(dismissedAnswer?.kind === 'text' && dismissedAnswer.value).toBe('(dismissed)')
  })
})

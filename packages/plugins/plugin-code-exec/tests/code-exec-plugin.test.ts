import {
  isPluginModule,
  PluginCaptureError,
  type PluginHost,
  type SandboxExecutionResult
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as codeExecModule from '../src/index'
import {
  CODE_EXEC_PLUGIN_ID,
  CodeExecHostError,
  codeExecInputSchema,
  codeExecPlugin,
  codeExecPluginManifest,
  summarizeCodeExecActivity
} from '../src/index'

const okResult: SandboxExecutionResult = {
  ok: true,
  result: 4,
  logs: ['hello'],
  timedOut: false
}

const hostWithSandbox = (
  executeSandboxedCode: NonNullable<PluginHost['executeSandboxedCode']>
): PluginHost => ({ capture: vi.fn(), executeSandboxedCode })

describe('codeExecPlugin', () => {
  it('is a valid, discoverable plugin module that is off by default', () => {
    expect(isPluginModule(codeExecModule)).toBe(true)
    expect(codeExecPluginManifest.id).toBe(CODE_EXEC_PLUGIN_ID)
    expect(codeExecPlugin().id).toBe(codeExecPluginManifest.id)
    // No defaultEnabled → the host treats it as off until the user opts in.
    expect(codeExecPluginManifest.defaultEnabled).toBeFalsy()
  })

  it('exposes a run_javascript tool when the host can run a sandbox', () => {
    const tools = codeExecPlugin().createTools?.(hostWithSandbox(vi.fn())) ?? []
    expect(tools.map((t) => t.id)).toEqual(['run_javascript'])
  })

  it('contributes no tool when the host cannot run a sandbox', () => {
    const host: PluginHost = { capture: vi.fn() }
    const tools = codeExecPlugin().createTools?.(host) ?? []
    expect(tools).toEqual([])
  })

  it('forwards code and input to the host executor and returns its result verbatim', async () => {
    const executeSandboxedCode = vi.fn(() => Promise.resolve(okResult))
    const [tool] = codeExecPlugin().createTools?.(hostWithSandbox(executeSandboxedCode)) ?? []

    const result = await tool!.execute({ code: 'return 2 + 2', input: { a: 1 } })

    expect(executeSandboxedCode).toHaveBeenCalledWith({
      code: 'return 2 + 2',
      input: { a: 1 },
      timeoutMs: 8_000
    })
    expect(result).toEqual(okResult)
  })

  it('omits input when none is supplied', async () => {
    const executeSandboxedCode = vi.fn(() => Promise.resolve(okResult))
    const [tool] = codeExecPlugin().createTools?.(hostWithSandbox(executeSandboxedCode)) ?? []

    await tool!.execute({ code: 'return 1' })

    expect(executeSandboxedCode).toHaveBeenCalledWith({ code: 'return 1', timeoutMs: 8_000 })
  })

  it('requests a sandbox budget below the runtime tool timeout so a graceful timedOut result wins the race', async () => {
    // The runtime wraps every tool call in `withTimeout(..., toolTimeoutMs)`
    // (10s in agent-runtime-base). The sandbox must time out first and resolve a
    // `{ timedOut: true }` result the model can react to, instead of the runtime
    // aborting the whole tool with a generic error. Pin the requested budget so a
    // future tweak that closes the gap fails here. See finding 1.1.
    const RUNTIME_TOOL_TIMEOUT_MS = 10_000
    let requested = Infinity
    const executeSandboxedCode = (request: { timeoutMs?: number }) => {
      requested = request.timeoutMs ?? Infinity
      return Promise.resolve(okResult)
    }
    const [tool] = codeExecPlugin().createTools?.(hostWithSandbox(executeSandboxedCode)) ?? []

    await tool!.execute({ code: 'return 1' })

    // Leave headroom for sandbox iframe load + the host backstop (budget + 500).
    expect(requested).toBeLessThan(RUNTIME_TOOL_TIMEOUT_MS - 1_000)
  })

  it('returns a failed run (timeout / thrown user error) to the agent rather than throwing', async () => {
    const failed: SandboxExecutionResult = {
      ok: false,
      logs: [],
      timedOut: true,
      error: 'execution timed out'
    }
    const [tool] =
      codeExecPlugin().createTools?.(hostWithSandbox(() => Promise.resolve(failed))) ?? []

    await expect(tool!.execute({ code: 'while(true){}' })).resolves.toEqual(failed)
  })

  it('throws a capturable CodeExecHostError when the executor itself fails', async () => {
    const executeSandboxedCode = vi.fn(() => Promise.reject(new Error('boom')))
    const [tool] = codeExecPlugin().createTools?.(hostWithSandbox(executeSandboxedCode)) ?? []

    const error = await tool!.execute({ code: 'return 1' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CodeExecHostError)
    expect(error).toBeInstanceOf(PluginCaptureError)
    // The report never carries the user code or output.
    expect((error as CodeExecHostError).report).toMatchObject({
      pluginId: CODE_EXEC_PLUGIN_ID,
      kind: 'host_error',
      level: 'error'
    })
    expect(JSON.stringify((error as CodeExecHostError).report)).not.toContain('return 1')
  })
})

describe('summarizeCodeExecActivity', () => {
  it('is wired onto the run_javascript tool descriptor', () => {
    const descriptor = codeExecPluginManifest.toolDescriptors?.find(
      (d) => d.id === 'run_javascript'
    )
    expect(descriptor?.summarizeActivity).toBe(summarizeCodeExecActivity)
  })

  it('summarizes a successful run as ok with a Result and Logs section', () => {
    const view = summarizeCodeExecActivity({
      ok: true,
      result: 314061,
      logs: [],
      timedOut: false
    })
    expect(view).toEqual({
      title: 'Ran JavaScript',
      status: 'ok',
      sections: [
        { label: 'Result', value: '314061' },
        { label: 'Logs', value: '0 lines' }
      ]
    })
  })

  it('pluralizes the log count and omits Result when there is none', () => {
    const view = summarizeCodeExecActivity({ ok: true, logs: ['a', 'b'], timedOut: false })
    expect(view.status).toBe('ok')
    expect(view.sections).toEqual([{ label: 'Logs', value: '2 lines' }])
  })

  it('marks a timeout as warn with a Timed out section', () => {
    const view = summarizeCodeExecActivity({ ok: false, logs: [], timedOut: true })
    expect(view.status).toBe('warn')
    expect(view.sections).toContainEqual({
      label: 'Timed out',
      value: 'Execution exceeded the time limit'
    })
  })

  it('marks a thrown error as error with an Error section', () => {
    const view = summarizeCodeExecActivity({
      ok: false,
      logs: [],
      timedOut: false,
      error: 'ReferenceError: x is not defined'
    })
    expect(view.status).toBe('error')
    expect(view.sections).toContainEqual({
      label: 'Error',
      value: 'ReferenceError: x is not defined'
    })
  })

  it('truncates a large result preview', () => {
    const view = summarizeCodeExecActivity({
      ok: true,
      result: '1'.repeat(500),
      logs: [],
      timedOut: false
    })
    const result = view.sections.find((s) => s.label === 'Result')
    expect(result?.value.endsWith('…')).toBe(true)
    expect(result?.value.length).toBe(121)
  })

  it('tolerates malformed output without throwing', () => {
    const view = summarizeCodeExecActivity(undefined)
    expect(view.title).toBe('Ran JavaScript')
    expect(view.status).toBe('error')
    expect(view.sections).toEqual([{ label: 'Logs', value: '0 lines' }])
  })
})

describe('codeExecInputSchema', () => {
  it('rejects empty code', () => {
    expect(codeExecInputSchema.safeParse({ code: '' }).success).toBe(false)
  })

  it('rejects code larger than the 1 MB cap', () => {
    const tooBig = 'a'.repeat(1_000_001)
    expect(codeExecInputSchema.safeParse({ code: tooBig }).success).toBe(false)
  })

  it('accepts code with an optional object input', () => {
    const parsed = codeExecInputSchema.safeParse({ code: 'return input.x', input: { x: 1 } })
    expect(parsed.success).toBe(true)
  })

  it('accepts a top-level array as input', () => {
    const parsed = codeExecInputSchema.safeParse({ code: 'return input.length', input: [1, 2, 3] })
    expect(parsed.success).toBe(true)
  })
})

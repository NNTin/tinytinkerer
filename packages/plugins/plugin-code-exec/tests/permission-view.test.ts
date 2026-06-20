import { describe, expect, it } from 'vitest'
import type { PermissionView, PermissionViewSection } from '@tinytinkerer/contracts'
import { summarizeCodeExecPermission } from '../src/permission-view'
import { codeExecPluginManifest } from '../src/index'

const codeSection = (view: PermissionView): Extract<PermissionViewSection, { kind: 'code' }> => {
  const section = view.sections.find((s): s is Extract<PermissionViewSection, { kind: 'code' }> => {
    return s.kind === 'code'
  })
  if (!section) {
    throw new Error('expected a code section')
  }
  return section
}

describe('summarizeCodeExecPermission', () => {
  it('is wired onto the run_javascript descriptor', () => {
    const descriptor = codeExecPluginManifest.toolDescriptors?.find(
      (d) => d.id === 'run_javascript'
    )
    expect(descriptor?.summarizePermission).toBe(summarizeCodeExecPermission)
  })

  it('pretty-prints minified code into a multiline javascript code section', async () => {
    const view = await summarizeCodeExecPermission({
      code: 'const a=1;const b=2;const c=3;return {a,b,c,sum:a+b+c};'
    })

    const section = codeSection(view)
    expect(section.language).toBe('javascript')
    // Re-spaced and split across lines; no trailing empty line.
    expect(section.code).toBe(
      'const a = 1\nconst b = 2\nconst c = 3\nreturn { a, b, c, sum: a + b + c }'
    )
    expect(view.report).toBeUndefined()
  })

  it('renders any non-code input fields as a json section', async () => {
    const view = await summarizeCodeExecPermission({
      code: 'return 1',
      input: { x: 1 }
    })

    const json = view.sections.find((s) => s.kind === 'json')
    expect(json).toEqual({ kind: 'json', label: 'Input', value: { input: { x: 1 } } })
  })

  it('fails open with the raw source and a report when the code is not valid JS', async () => {
    const broken = 'const a = ;;; this is not ) valid('
    const view = await summarizeCodeExecPermission({ code: broken })

    // The raw, unformatted source is still shown so the prompt is never blocked.
    expect(codeSection(view).code).toBe(broken)
    expect(view.report?.kind).toBe('format_failure')
    expect(view.report?.level).toBe('warning')
    // Enough context to reproduce: the offending source travels in the report.
    expect(view.report?.contexts?.run_javascript_format_failure?.code).toBe(broken)
  })

  it('falls back to a plain json view when code is not a string', async () => {
    const view = await summarizeCodeExecPermission({ notCode: true })
    expect(view.sections).toEqual([{ kind: 'json', label: 'Input', value: { notCode: true } }])
    expect(view.report).toBeUndefined()
  })
})

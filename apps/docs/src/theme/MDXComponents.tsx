import MDXComponentsOriginal from '@theme-original/MDXComponents'
import { LabReset, LiveLab, LiveSessionGate } from '../live-lab'

// `@theme-original/MDXComponents` is a Docusaurus webpack alias with no real type
// declarations, so it resolves to `any` — cast it once here, and annotate the
// merged export explicitly, so this stays a plain string-keyed map instead of TS
// narrowing the spread down to only the three keys added below.
const originalComponents = MDXComponentsOriginal as Record<string, unknown>

// Registers the reusable MDX live-lab framework (issue #451) as global MDX
// components, so any docs page can drop `<LiveLab>`, `<LiveSessionGate>`, and
// `<LabReset>` straight into its content with no per-page import.
const components: Record<string, unknown> = {
  ...originalComponents,
  LiveLab,
  LiveSessionGate,
  LabReset
}

export default components

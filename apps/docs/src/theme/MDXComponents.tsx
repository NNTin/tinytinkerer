import MDXComponentsOriginal from '@theme-original/MDXComponents'
import {
  ExecutionTraceLab,
  LabReset,
  LiveLab,
  LiveSessionGate,
  PixelAgentsLab,
  PluginToolPickerLab
} from '../live-lab'
import { RichContentPlayground } from '../playground'

// `@theme-original/MDXComponents` is a Docusaurus webpack alias with no real type
// declarations, so it resolves to `any` — cast it once here, and annotate the
// merged export explicitly, so this stays a plain string-keyed map instead of TS
// narrowing the spread down to only the three keys added below.
const originalComponents = MDXComponentsOriginal as Record<string, unknown>

// Registers the reusable MDX live-lab framework (issue #451), the
// rich-content renderer playground (issue #455), the Pixel Agents lab (issue
// #452), the live agent execution trace lab (issue #454), and the plugin &
// tool-picker impact lab (issue #453) as global MDX components, so any docs
// page can drop `<LiveLab>`, `<LiveSessionGate>`, `<LabReset>`,
// `<RichContentPlayground>`, `<PixelAgentsLab>`, `<ExecutionTraceLab>`, and
// `<PluginToolPickerLab>` straight into its content with no per-page import.
const components: Record<string, unknown> = {
  ...originalComponents,
  LiveLab,
  LiveSessionGate,
  LabReset,
  RichContentPlayground,
  PixelAgentsLab,
  ExecutionTraceLab,
  PluginToolPickerLab
}

export default components

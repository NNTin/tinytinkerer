import {
  PluginCaptureError,
  type ActivitySummarizer,
  type ActivityView,
  type AgentPlugin,
  type DomQuery,
  type DomReader,
  type DomReadResult,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type Tool
} from '@tinytinkerer/contracts'
import { z } from 'zod'

// Stable id used as the activation key and the manifest id surfaced in the
// Settings Modal. The contributed tool id is `read_dom`.
export const BROWSER_STATE_PLUGIN_ID = 'browser-state'

// Host ceilings mirrored here so the model gets a clean validation error for an
// out-of-range request before it reaches the host. The host re-clamps every
// value independently, so these bounds only ever tighten what is forwarded.
const MAX_NODES = 100
const MAX_CHARS = 20_000

// Largest subtree depth the tool will request. The host clamps this to its own
// ceiling independently.
const MAX_DEPTH = 8

// Input contract for the read_dom tool. All fields are optional and resolve to one
// of three modes: `region` (elements ordered by where they sit on the page), an
// omitted `selector` (a structural outline of the page tree), or a `selector`
// (matched elements, optionally with their descendants nested via `depth`).
// Product-agnostic — no browser types leak here.
export const readDomInputSchema = z.object({
  selector: z.string().min(1).max(2_000).optional(),
  include: z.array(z.enum(['html', 'text', 'attributes', 'rect'])).optional(),
  depth: z.number().int().min(0).max(MAX_DEPTH).optional(),
  region: z.enum(['top', 'bottom']).optional(),
  maxNodes: z.number().int().positive().max(MAX_NODES).optional(),
  maxChars: z.number().int().positive().max(MAX_CHARS).optional()
})

export type ReadDomInput = z.infer<typeof readDomInputSchema>

// Longest single value the summary will inline before truncating, so a long URL
// never floods the activity panel. The full result still reaches the model.
const MAX_SUMMARY_VALUE = 120

const previewValue = (value: string): string =>
  value.length > MAX_SUMMARY_VALUE ? `${value.slice(0, MAX_SUMMARY_VALUE)}…` : value

// read_dom presentation owned by the plugin, not the host. Maps the DomReadResult
// to the host's product-agnostic ActivityView. A read that matched something is
// `ok`; a read that matched nothing is `warn` (likely a selector that needs
// fixing). Pure and React-free (enforced by scripts/check-boundaries.mjs) — the
// host renders the returned values as plain text.
export const summarizeReadDomActivity: ActivitySummarizer = (output): ActivityView => {
  const value = (output ?? {}) as Partial<DomReadResult>
  const matchedCount = typeof value.matchedCount === 'number' ? value.matchedCount : 0
  const returned = Array.isArray(value.nodes) ? value.nodes.length : 0

  const sections: ActivityView['sections'] = [
    { label: 'Matched', value: String(matchedCount) },
    { label: 'Returned', value: String(returned) }
  ]
  if (typeof value.url === 'string' && value.url.length > 0) {
    sections.push({ label: 'URL', value: previewValue(value.url) })
  }
  if (value.truncated === true) {
    sections.push({ label: 'Truncated', value: 'Some matches or content were omitted' })
  }

  return {
    title: 'Read page DOM',
    status: matchedCount > 0 ? 'ok' : 'warn',
    sections
  }
}

// UI + planner metadata for the host. No `defaultEnabled`, so it is OFF by
// default — the user opts in via Settings. `summarizeActivity` carries the
// plugin's own activity-panel presentation (see summarizeReadDomActivity).
export const browserStatePluginManifest: PluginManifest = {
  id: BROWSER_STATE_PLUGIN_ID,
  label: 'Browser state (read_dom tool)',
  description:
    'Let the assistant read the page you are currently viewing so it can answer ' +
    'questions about what is on screen and debug rendering issues (e.g. a diagram ' +
    'that is not showing). It reads the page through narrow queries — never the whole ' +
    'page at once — and the host redacts form-field values, so text you have typed but ' +
    'not sent is not included. Off by default.',
  capabilities: ['tools'],
  toolDescriptors: [
    {
      id: 'read_dom',
      description:
        'Read the current page. Three ways to call it: (1) with no selector, get page ' +
        'meta plus a STRUCTURAL OUTLINE of the page tree (tag/id/classes/childCount + a ' +
        'short text preview, nested to `depth`) — most apps mount their whole UI under a ' +
        'single <div id="root">, so the outline is how you discover that subtree and pick ' +
        'a selector; (2) with `region`:"bottom" or "top", get the rendered elements ordered ' +
        'by where they sit on the page (use this for "what is at the bottom/top of the page"); ' +
        '(3) with a CSS `selector`, get the matched elements as plain data (tag, id, classes, ' +
        'and optionally html/text/attributes/layout box), and set `depth` to also nest their ' +
        'descendants. Use include:["html"] to inspect rendered markup such as an SVG when ' +
        'debugging why something is not showing. This tool\'s own output is deliberately ' +
        'narrow and truncated — use it for a quick look and to pick selectors. Separately, ' +
        'every call also snapshots the FULL sanitized page into a structured tree that the ' +
        'run_javascript tool receives automatically as its `dom` binding (no need to pass ' +
        'anything), so to count, search, or extract across the whole page, read_dom once and ' +
        'then do the heavy work in run_javascript.',
      inputSchema: {
        selector: {
          type: 'string',
          description:
            'CSS selector to match elements. Omit it for a structural outline of the page ' +
            'tree (or combine it with `region` to order just the matched elements).'
        },
        region: {
          type: 'string',
          description:
            'Either "bottom" or "top": return rendered elements ordered by their vertical ' +
            'position on the page. Best for "what is at the bottom/top of the page" questions.'
        },
        depth: {
          type: 'number',
          description:
            'How many levels of descendants to include (0–8). For an outline it sets how deep ' +
            'the tree goes (default 4); for a selector it nests each match\'s children (default 0).'
        },
        include: {
          type: 'array',
          description:
            'Which per-node fields to return for selector/region queries: any of "html", "text", ' +
            '"attributes", "rect". Defaults to ["text","attributes","rect"]; add "html" for markup.'
        },
        maxNodes: {
          type: 'number',
          description: 'Max number of elements to return (1–100, default 25).'
        },
        maxChars: {
          type: 'number',
          description: 'Max characters per html/text field before truncation (default 4000).'
        }
      },
      summarizeActivity: summarizeReadDomActivity
    }
  ]
}

// Thrown when the host DOM-read capability itself fails unexpectedly. Reading the
// page is non-destructive and the host returns an empty result for a bad selector
// rather than throwing, so reaching here means the capability broke. Carries a
// PluginReport so the registry routes it to the host capture sink (Sentry in the
// browser) and rethrows. The report intentionally carries NO page content.
export class BrowserStateHostError extends PluginCaptureError {
  constructor(message: string) {
    super(
      {
        pluginId: BROWSER_STATE_PLUGIN_ID,
        kind: 'host_error',
        level: 'error',
        // Only the failure message — never any page content read from the DOM.
        message: 'DOM reader failed'
      },
      message
    )
    this.name = 'BrowserStateHostError'
  }
}

// Builds the read_dom tool against the host's DOM-read capability. The host owns
// all DOM access, capping, and redaction; this tool only validates input and
// shapes the query. It stays product-agnostic — no browser APIs, no telemetry
// SDK, no app-browser imports.
const createReadDomTool = (readDom: DomReader): Tool<ReadDomInput, DomReadResult> => ({
  id: 'read_dom',
  description:
    'Read the current page (narrow, truncated output); also snapshots the full sanitized ' +
    'page into the `dom` binding that run_javascript can compute over.',
  schema: readDomInputSchema,
  async execute(input) {
    // Build the query without explicit `undefined` properties so it satisfies the
    // contract's exact-optional shape.
    const query: DomQuery = {}
    if (input.selector !== undefined) {
      query.selector = input.selector
    }
    if (input.include !== undefined) {
      query.include = input.include
    }
    if (input.depth !== undefined) {
      query.depth = input.depth
    }
    if (input.region !== undefined) {
      query.region = input.region
    }
    if (input.maxNodes !== undefined) {
      query.maxNodes = input.maxNodes
    }
    if (input.maxChars !== undefined) {
      query.maxChars = input.maxChars
    }
    try {
      return await readDom(query)
    } catch (error) {
      // The capability returns an empty result for normal misses, so reaching
      // here means it broke. Capture it and surface a tool failure to the runtime.
      throw new BrowserStateHostError(error instanceof Error ? error.message : 'unknown error')
    }
  }
})

// The browser-state plugin. Contributes a single read_dom tool built against the
// host DOM-read capability; needs no activate/deactivate lifecycle. A host without
// a DOM capability simply gets no tool (the plugin tolerates the capability's
// absence rather than contributing a tool that cannot run).
export const browserStatePlugin = (): AgentPlugin => ({
  id: BROWSER_STATE_PLUGIN_ID,
  createTools: (host: PluginHost): Tool<unknown, unknown>[] =>
    host.readDom ? [createReadDomTool(host.readDom)] : []
})

// PluginModule contract surface: the named exports a host discovers dynamically.
export const manifest: PluginManifest = browserStatePluginManifest
export const createPlugin: PluginModule['createPlugin'] = browserStatePlugin

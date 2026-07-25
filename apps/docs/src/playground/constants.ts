// Curated markdown examples for the rich-content renderer playground
// (issue #455). Every example is real markdown, parsed and rendered through
// the actual @tinytinkerer/content-markdown + content-react + specialized
// renderer plugin stack (see ../../../../packages/app/app-browser/src/content-playground.tsx)
// — nothing here is a mock or a hand-built AST. Image examples use an inline
// `data:image/svg+xml,` URI so the playground never issues a network request.

export type PlaygroundExampleCategory =
  | 'markdown'
  | 'mermaid'
  | 'wireframe'
  | 'code'
  | 'callout'
  | 'link-card'
  | 'table'
  | 'image'
  | 'malformed'

export type PlaygroundExample = {
  readonly id: string
  readonly label: string
  readonly category: PlaygroundExampleCategory
  readonly description: string
  readonly markdown: string
}

// Renderer-exception demo language: never a real content type, exists only so
// this playground can prove that a genuine render-time throw from a plugin is
// contained by the real runtime instead of crashing the page. Must match
// PLAYGROUND_ERROR_DEMO_LANGUAGE in @tinytinkerer/app-browser's
// content-playground.tsx (kept as a literal here, not an import, so this data
// module stays free of any workspace dependency).
export const RENDERER_EXCEPTION_LANGUAGE = 'tt-playground-throw'

const MASCOT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">' +
  '<rect width="320" height="160" rx="12" fill="#f59e0b"/>' +
  '<text x="160" y="88" font-family="sans-serif" font-size="26" fill="#2f2923" text-anchor="middle">TinyTinkerer</text>' +
  '</svg>'
const MASCOT_DATA_URI = `data:image/svg+xml,${encodeURIComponent(MASCOT_SVG)}`

export const PLAYGROUND_EXAMPLES: readonly PlaygroundExample[] = [
  {
    id: 'markdown',
    label: 'Markdown basics',
    category: 'markdown',
    description: 'Headings, emphasis, lists, blockquotes, and links map one-for-one to the AST.',
    markdown: [
      '# Rich content playground',
      '',
      'This editor parses through `@tinytinkerer/content-markdown` and renders through the',
      'real React content runtime — the same one the product chat surface uses.',
      '',
      '- **Bold**, *italic*, and `inline code` all become inline AST nodes',
      '- Edit the source on the left; the semantic document and preview update immediately',
      '',
      '> Blockquotes become `BlockquoteNode`s, unless they start with a `[!KIND]` marker',
      '> — try the callout example.',
      '',
      '---',
      '',
      'Pick another example above to see a specialized renderer plugin take over.'
    ].join('\n')
  },
  {
    id: 'mermaid',
    label: 'Mermaid diagram',
    category: 'mermaid',
    description: 'A ```mermaid fence dispatches to @tinytinkerer/content-mermaid.',
    markdown: [
      '```mermaid',
      'flowchart TD',
      '    A[Start] --> B{Ready to ship?}',
      '    B -- Yes --> C[Deploy]',
      '    B -- No --> D[Iterate]',
      '    D --> B',
      '```'
    ].join('\n')
  },
  {
    id: 'wireframe',
    label: 'Wireframe mockup',
    category: 'wireframe',
    description:
      'A ```wireframe fence dispatches to @tinytinkerer/content-wireframe (sandboxed iframe).',
    markdown: [
      '```wireframe',
      '<div style="font-family: sans-serif; padding: 16px;">',
      '  <h1 style="margin: 0 0 8px; font-size: 18px;">Dashboard</h1>',
      '  <div style="display: flex; gap: 8px;">',
      '    <div style="flex: 1; border: 1px solid #ccc; padding: 8px;">Widget A</div>',
      '    <div style="flex: 1; border: 1px solid #ccc; padding: 8px;">Widget B</div>',
      '  </div>',
      '</div>',
      '```'
    ].join('\n')
  },
  {
    id: 'code',
    label: 'Editable code block',
    category: 'code',
    description: 'Any other fenced language dispatches to @tinytinkerer/content-code.',
    markdown: [
      '```ts',
      'export const greet = (name: string): string => `Hello, ${name}!`',
      '```'
    ].join('\n')
  },
  {
    id: 'callout',
    label: 'Callout',
    category: 'callout',
    description:
      'A blockquote whose first line matches [!KIND] dispatches to @tinytinkerer/content-callout.',
    markdown: [
      '> [!TIP]',
      '> Callouts use GitHub-style `[!KIND]` markers inside a blockquote.'
    ].join('\n')
  },
  {
    id: 'link-card',
    label: 'Link card',
    category: 'link-card',
    description:
      'A paragraph that is only a link dispatches to @tinytinkerer/content-link-card instead of a plain anchor.',
    markdown: 'https://github.com/NNTin/tinytinkerer'
  },
  {
    id: 'table',
    label: 'Table',
    category: 'table',
    description:
      'GFM tables dispatch to @tinytinkerer/content-table (sticky header, CSV/markdown export).',
    markdown: [
      '| Renderer | Package | Trigger |',
      '| --- | --- | --- |',
      '| Mermaid | `content-mermaid` | ` ```mermaid ` fence |',
      '| Wireframe | `content-wireframe` | ` ```wireframe ` fence |',
      '| Table | `content-table` | GFM table syntax |'
    ].join('\n')
  },
  {
    id: 'image',
    label: 'Image',
    category: 'image',
    description:
      'A standalone image paragraph dispatches to @tinytinkerer/content-image. This example is an inline SVG data URI, so it needs no network request.',
    markdown: `![TinyTinkerer mascot](${MASCOT_DATA_URI})`
  },
  {
    id: 'malformed-mermaid',
    label: 'Invalid Mermaid',
    category: 'malformed',
    description:
      'Broken Mermaid syntax stays contained: the renderer falls back to the raw source instead of crashing.',
    markdown: ['```mermaid', 'flowchart TD', '    A -->', '```'].join('\n')
  },
  {
    id: 'empty-wireframe',
    label: 'Empty wireframe',
    category: 'malformed',
    description:
      'An empty wireframe fence falls back to a plain code block instead of an empty iframe.',
    markdown: ['```wireframe', '```'].join('\n')
  },
  {
    id: 'unknown-language',
    label: 'Unrecognized language',
    category: 'malformed',
    description:
      'A fence in a language nothing specializes in still renders — it dispatches to the generic code renderer.',
    markdown: [
      '```made-up-lang',
      'this fence has no specialized or CodeMirror-aware renderer',
      '```'
    ].join('\n')
  },
  {
    id: 'renderer-exception',
    label: 'Renderer exception',
    category: 'malformed',
    description:
      'Playground-only demo: this fenced language always throws inside its renderer, showing that a real plugin exception is contained instead of crashing the page.',
    markdown: [`\`\`\`${RENDERER_EXCEPTION_LANGUAGE}`, 'this renderer always throws', '```'].join(
      '\n'
    )
  }
]

export const DEFAULT_PLAYGROUND_EXAMPLE_ID = PLAYGROUND_EXAMPLES[0].id

export const findPlaygroundExample = (id: string | null): PlaygroundExample | undefined =>
  id ? PLAYGROUND_EXAMPLES.find((example) => example.id === id) : undefined

/** The answer prompt's first line: who the assistant is. An app may replace it. */
export const DEFAULT_ASSISTANT_IDENTITY = 'You are tinytinkerer, a warm, practical assistant.'

export const SYSTEM_STYLE_PROMPT = `${DEFAULT_ASSISTANT_IDENTITY}
Do not reveal private chain-of-thought; give concise operational summaries.

## UI rendering

GitHub Flavored Markdown (incl. tables, task lists, strikethrough) renders natively.

Images render from an absolute \`https://\` URL or a base64 data URI (\`data:image/...;base64,...\`); relative and protocol-relative URLs (\`/img.png\`, \`//host/img.png\`) do not. A title becomes the caption. SVG also renders as a percent-encoded (\`data:image/svg+xml,%3Csvg...\`) or raw (\`data:image/svg+xml,<svg ...>\`) data URI — raw is sanitized and mounted inline. When a tool result carries a \`media\` item with a \`mediaRef\`, show it to the user by embedding \`![caption](<mediaRef>)\` in your reply — never paste raw image data.

Fenced code blocks are syntax-highlighted source. Specialized fences:
- \`\`\`mermaid — diagrams (flowchart, sequence, class, …)
- \`\`\`wireframe — sandboxed HTML/CSS preview: emit one self-contained HTML document, HTML+CSS only (inline or a \`<style>\` block, \`data:\` images). No JS, no external resources (scripts, remote images, fonts, stylesheets) — it must render without them.
- \`\`\`diff — colored unified diff
- \`\`\`json — highlighted with a Format/Compact toggle
- \`\`\`yaml, \`\`\`http, \`\`\`sql, \`\`\`bash — highlighted
Use a plain fence (e.g. \`\`\`html) to show code as source instead of rendering it.

Blockquotes starting with \`[!NOTE]\`, \`[!TIP]\`, \`[!WARNING]\`, \`[!IMPORTANT]\`, or \`[!CAUTION]\` render as styled callouts.

A paragraph that is only a single link or bare URL renders as a preview card — use it for references and citations.`

/**
 * The answer (synthesis) prompt with `identity` in place of its first line
 * (issue #518, F6). Only that line changes: the rendering rules below it
 * describe what this UI can render, whoever the assistant is. A blank or
 * omitted identity keeps the default, so an app that sets none sends a
 * byte-identical prompt.
 */
export const systemStylePrompt = (identity?: string): string => {
  const line = identity?.replace(/\s+/g, ' ').trim()
  return line
    ? `${line}${SYSTEM_STYLE_PROMPT.slice(DEFAULT_ASSISTANT_IDENTITY.length)}`
    : SYSTEM_STYLE_PROMPT
}

/**
 * Appends an app's own instructions to one of the three model-facing system
 * prompts (issue #478).
 *
 * The documentation assistant needs the model told, at every reasoning boundary,
 * that returned Markdown is reference material rather than instructions. That
 * policy belongs to `apps/docs`, not to this shared prompt — so each boundary
 * composes here instead of growing an app-specific paragraph, and an app that
 * contributes nothing sends a byte-identical prompt to the one it sent before.
 *
 * One system message rather than two: providers vary in how they treat a second
 * system turn, and a boundary the model reads as lower-priority is exactly the
 * wrong place for a grounding rule.
 */
export const composeSystemPrompt = (base: string, appInstructions?: string): string =>
  appInstructions && appInstructions.trim().length > 0
    ? `${base}\n\n${appInstructions.trim()}`
    : base

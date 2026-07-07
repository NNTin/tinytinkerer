import type { BlockNode, ContentDocument } from '@tinytinkerer/content-core'
import {
  cloneMarkdownParseState,
  createMarkdownParseState,
  findDecodedSvgClose,
  parseMarkdownFragment,
  type MarkdownParseState
} from './parse-markdown-content'

export type MarkdownContentSnapshot = {
  source: string
  document: ContentDocument
}

export type MarkdownContentSession = {
  append: (chunk: string) => MarkdownContentSnapshot
  replace: (source: string) => MarkdownContentSnapshot
  snapshot: () => MarkdownContentSnapshot
}

// A line of `pending`, sliced out with its offsets. `text` excludes the
// terminating `\n` but keeps a trailing `\r` (so `\r\n` is handled by the blank
// test); `end` is the index just past the `\n` (or the string end for an
// unterminated final line) — i.e. the split point a blank line offers.
// `terminated` is false for the final line when `pending` has no trailing `\n`:
// that line is still being typed, so we cannot yet trust its shape.
type PendingLine = { start: number; text: string; end: number; terminated: boolean }

const BLANK_LINE = /^[ \t]*\r?$/
// A list-item start, OR a bare marker char that is about to become one. The
// trailing `[ \t]|$` matters: mid-stream a second list item can arrive as just
// `-` (no space yet), and treating that as "a new non-list block" would split a
// loose list into two — so a lone marker char counts as a potential list start.
const LIST_ITEM_START = /^([-+*]|\d{1,9}[.)])([ \t]|$)/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

const stripCr = (text: string): string => text.replace(/\r$/, '')

const splitPendingLines = (pending: string): PendingLine[] => {
  const lines: PendingLine[] = []
  let index = 0
  while (index < pending.length) {
    const newline = pending.indexOf('\n', index)
    if (newline === -1) {
      lines.push({
        start: index,
        text: pending.slice(index),
        end: pending.length,
        terminated: false
      })
      break
    }
    lines.push({
      start: index,
      text: pending.slice(index, newline),
      end: newline + 1,
      terminated: true
    })
    index = newline + 1
  }
  return lines
}

// A fenced code block closes on a `^ {0,3}` line of at least as many of the same
// marker char as the opener, followed by whitespace only. Kept deliberately
// close to CommonMark; when a line is ambiguous we err towards "still open"
// (return false) so a boundary is never taken inside a fence.
const isFenceClose = (text: string, marker: string, openLength: number): boolean => {
  const stripped = stripCr(text)
  const indent = /^( {0,3})/.exec(stripped)?.[1]?.length ?? 0
  if (indent > 3) return false
  let count = 0
  let cursor = indent
  while (cursor < stripped.length && stripped[cursor] === marker) {
    count += 1
    cursor += 1
  }
  if (count < openLength) return false
  return stripped.slice(cursor).trim() === ''
}

// Any `data:image/svg+xml,` occurrence whose raw-or-percent-encoded `</svg>`
// close does not land strictly before `p` means an SVG data URI straddles the
// candidate split. Splitting there would let a prefix-only parse see an
// unterminated `<svg` (which `extractRawSvgImages` bails on, degrading it to
// text) while a full parse extracts it — so the fragments would diverge. We
// check EVERY occurrence, not just the last, because an earlier unterminated
// `<svg` could otherwise be masked by a later block's close.
const hasUnterminatedRawSvg = (pending: string, p: number): boolean => {
  const scheme = /data:image\/svg\+xml,/gi
  const prefix = pending.slice(0, p)
  for (const match of prefix.matchAll(scheme)) {
    const close = findDecodedSvgClose(pending, match.index + match[0].length)
    if (close === null || close.end > p) {
      return true
    }
  }
  return false
}

// HTML constructs that can legally span a blank line: comments and the raw-text
// elements. If the prefix opens one without closing it, a blank line inside it
// is not a real block boundary, so reject. Conservative substring checks — a
// false positive only delays stabilization (the tail keeps growing, parsed in
// full each delta), never a correctness bug.
const RAW_TEXT_TAGS = ['pre', 'script', 'style', 'textarea']
const hasUnterminatedHtmlBlock = (prefix: string): boolean => {
  const lower = prefix.toLowerCase()
  if (lower.lastIndexOf('<!--') > lower.lastIndexOf('-->')) {
    return true
  }
  for (const tag of RAW_TEXT_TAGS) {
    const open = lower.lastIndexOf(`<${tag}`)
    if (open !== -1 && lower.lastIndexOf(`</${tag}`) < open) {
      return true
    }
  }
  return false
}

const firstNonBlankAfter = (lines: PendingLine[], fromIndex: number): PendingLine | null => {
  for (let index = fromIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line && !BLANK_LINE.test(line.text)) {
      return line
    }
  }
  return null
}

/**
 * The last index in `pending` at which it is provably safe to commit everything
 * before it as a stable prefix — i.e. where `parse(prefix) ++ parse(rest)`
 * reproduces `parse(prefix + rest)` exactly. Returns `null` when no such point
 * exists yet (the whole of `pending` stays volatile — correct, just re-parsed
 * in full until a boundary appears).
 *
 * A candidate is the position immediately after a blank line. It is accepted
 * only when ALL hold:
 *  1. it is not inside an open fenced code block;
 *  2. the next non-blank line exists, is fully arrived (terminated by `\n`, so
 *     its shape can no longer change), and clearly starts a new block — it
 *     begins at column 0 with a non-space/tab char and is not a list-item
 *     marker (so we never split a loose list, a list-item/indented-code
 *     continuation, or a block we cannot yet see the successor of);
 *  3. no SVG data URI straddles it (see {@link hasUnterminatedRawSvg});
 *  4. no blank-line-spanning HTML block is open across it (see
 *     {@link hasUnterminatedHtmlBlock}).
 *
 * The mdast→ContentDocument conversion has no backward cross-block dependencies
 * (definitions/link-references/footnotes are ignored, degrading to text), so a
 * blank-line block boundary that satisfies the above cannot change how earlier
 * text parses — which is what makes prefix-committing sound.
 */
export const findStableBoundary = (pending: string): number | null => {
  const lines = splitPendingLines(pending)
  let fenceMarker: string | null = null
  let fenceLength = 0
  let lastAccepted: number | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    const stripped = stripCr(line.text)

    if (fenceMarker === null) {
      const open = FENCE_OPEN.exec(stripped)
      if (open?.[1]) {
        fenceMarker = open[1][0] ?? null
        fenceLength = open[1].length
        continue
      }
    } else {
      if (isFenceClose(line.text, fenceMarker, fenceLength)) {
        fenceMarker = null
        fenceLength = 0
      }
      continue
    }

    if (!BLANK_LINE.test(line.text)) {
      continue
    }

    const p = line.end
    const next = firstNonBlankAfter(lines, index + 1)
    // The next block's first line must be fully arrived: while it is the last,
    // unterminated line of `pending` it can still grow into a list marker, a
    // setext underline, an indent, etc. — any of which would change whether
    // this really is a block boundary.
    if (!next || !next.terminated) {
      continue
    }
    const nextText = stripCr(next.text)
    if (/^[ \t]/.test(nextText) || LIST_ITEM_START.test(nextText)) {
      continue
    }
    if (hasUnterminatedRawSvg(pending, p) || hasUnterminatedHtmlBlock(pending.slice(0, p))) {
      continue
    }
    lastAccepted = p
  }

  return lastAccepted
}

type ParseFragment = typeof parseMarkdownFragment

// Injectable parse function so tests can account for parse work (call count and
// input sizes) without wall-clock timing. `createMarkdownContentSession` is the
// production binding.
export const createMarkdownContentSessionWith =
  (parseFragment: ParseFragment) =>
  (initialSource = ''): MarkdownContentSession => {
    // Everything before `pending` is settled: its nodes are parsed once, keep
    // their object identity forever, and `committedState` carries the threaded
    // id/occurrence counters up to that point. Only `pending` (the growing tail)
    // is re-parsed per append, and always on a CLONE of `committedState` so a
    // volatile tail never advances the committed counters.
    let stableSource = ''
    let stableNodes: BlockNode[] = []
    let committedState: MarkdownParseState = createMarkdownParseState()
    let pending = ''
    let currentDocument: ContentDocument = { nodes: [] }

    const stabilizeAndParse = () => {
      let boundary = findStableBoundary(pending)
      while (boundary !== null) {
        const prefix = pending.slice(0, boundary)
        // Commit the prefix into the shared state (mutates `committedState`),
        // appending its nodes to the stable list without ever rebuilding the
        // ones already there.
        const committedNodes = parseFragment(prefix, committedState)
        stableNodes = [...stableNodes, ...committedNodes]
        stableSource += prefix
        pending = pending.slice(boundary)
        boundary = findStableBoundary(pending)
      }
      const tailNodes = parseFragment(pending, cloneMarkdownParseState(committedState))
      currentDocument = { nodes: [...stableNodes, ...tailNodes] }
    }

    const reset = (source: string) => {
      stableSource = ''
      stableNodes = []
      committedState = createMarkdownParseState()
      pending = source
      stabilizeAndParse()
    }

    const snapshot = (): MarkdownContentSnapshot => ({
      source: stableSource + pending,
      document: currentDocument
    })

    reset(initialSource)

    return {
      append(chunk) {
        pending += chunk
        stabilizeAndParse()
        return snapshot()
      },
      replace(nextSource) {
        reset(nextSource)
        return snapshot()
      },
      snapshot
    }
  }

export const createMarkdownContentSession = createMarkdownContentSessionWith(parseMarkdownFragment)

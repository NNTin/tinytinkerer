import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { displayNameFor, elementMap } from './normalization'
import { truncateUtf8 } from './payload'

// Deterministic, LLM-free descriptions for the images `thumbnail`/`preview` attach
// to their result as display-only `media` (see the shared `ToolResultImageMedia`
// contract): the model reads this text in place of the base64 `dataUrl`, so it
// must be a compact, factual stand-in for "what the picture shows" — built purely
// from element type counts and a few display labels, never a model call. Bounded
// to a short byte budget so a scene with many distinct labels can't blow up the
// result payload.
const MAX_DESCRIPTION_BYTES = 240
// Cap on how many elements' display labels are quoted, across the whole
// description — not per type — so a scene with dozens of labeled elements still
// yields a short, skimmable sentence.
const MAX_LABELS = 4

// Friendly singular/plural names for the element `type`s `normalization.ts`
// recognizes. A type with no entry here falls back to the raw type name plus a
// naive "s" plural.
const TYPE_NAMES: Record<string, { singular: string; plural: string }> = {
  rectangle: { singular: 'rectangle', plural: 'rectangles' },
  ellipse: { singular: 'ellipse', plural: 'ellipses' },
  diamond: { singular: 'diamond', plural: 'diamonds' },
  text: { singular: 'text label', plural: 'text labels' },
  line: { singular: 'line', plural: 'lines' },
  arrow: { singular: 'arrow', plural: 'arrows' },
  freedraw: { singular: 'freehand drawing', plural: 'freehand drawings' },
  image: { singular: 'image', plural: 'images' },
  frame: { singular: 'frame', plural: 'frames' },
  magicframe: { singular: 'frame', plural: 'frames' },
  embeddable: { singular: 'embed', plural: 'embeds' },
  iframe: { singular: 'embed', plural: 'embeds' }
}

const typeName = (type: string, count: number): string => {
  const names = TYPE_NAMES[type]
  if (names) return count === 1 ? names.singular : names.plural
  return count === 1 ? type : `${type}s`
}

// A bound label (a `text` element captioning another element via `containerId`,
// e.g. the text inside a labeled rectangle) is a shape's caption, not an
// independent thing to describe: its content already surfaces through the
// container's own `displayNameFor` lookup below. Counting/quoting it AGAIN as
// its own "text" element would double every shape label onto a phantom text
// element with the same words, so it is excluded from the described set.
// Mirrors the `target.type === 'text' && target.containerId` check
// `hasRelationship` (normalization.ts) uses for the same bound-label concept.
const isBoundLabel = (element: OrderedExcalidrawElement): boolean =>
  element.type === 'text' && element.containerId !== null

// Describes a rendered scene/subset for a `thumbnail` image: element type counts
// (in first-appearance order, bound labels folded into their container) plus up
// to `MAX_LABELS` display labels attributed to their type group, e.g. "PNG of 7
// elements: 3 rectangles (labeled 'Laptop 1', 'Laptop 2', 'Laptop 3'), 1 ellipse
// ('Router'), 3 arrows; 512×384px."
export const describeScene = (
  elements: readonly OrderedExcalidrawElement[],
  image: { width: number; height: number }
): string => {
  const dimensions = `${image.width}×${image.height}px`
  // `byId` is built from the FULL element set (bound labels included) so
  // `displayNameFor`'s label lookup still resolves; only the described set below
  // drops them.
  const byId = elementMap(elements)
  const described = elements.filter((element) => !isBoundLabel(element))
  if (described.length === 0)
    return truncateUtf8(`PNG of an empty scene; ${dimensions}.`, MAX_DESCRIPTION_BYTES)

  const order: string[] = []
  const counts = new Map<string, number>()
  for (const element of described) {
    if (!counts.has(element.type)) order.push(element.type)
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1)
  }

  // Walk the described elements once more, in order, collecting up to
  // MAX_LABELS display labels grouped by the type they belong to.
  const labelsByType = new Map<string, string[]>()
  let labelCount = 0
  for (const element of described) {
    if (labelCount >= MAX_LABELS) break
    const label = displayNameFor(element, byId)
    if (!label) continue
    const group = labelsByType.get(element.type) ?? []
    group.push(label)
    labelsByType.set(element.type, group)
    labelCount += 1
  }

  const groups = order.map((type) => {
    const count = counts.get(type)!
    const phrase = `${count} ${typeName(type, count)}`
    const labels = labelsByType.get(type)
    if (!labels || labels.length === 0) return phrase
    const quoted = labels.map((label) => `'${label}'`).join(', ')
    return labels.length === 1 ? `${phrase} (${quoted})` : `${phrase} (labeled ${quoted})`
  })

  const summary = `PNG of ${described.length} element${described.length === 1 ? '' : 's'}: ${groups.join(', ')}; ${dimensions}.`
  return truncateUtf8(summary, MAX_DESCRIPTION_BYTES)
}

// Describes a `preview` dry-run's rendered image: the verb plus its patch
// summary counts, e.g. "Preview of edit: 0 added, 3 updated, 0 deleted;
// 512×384px." — the image shows the hypothetical result, so the description
// leads with what changed rather than the resulting scene's contents.
export const describePreview = (
  verb: string,
  summary: { adds: number; updates: number; deletes: number },
  image: { width: number; height: number }
): string =>
  truncateUtf8(
    `Preview of ${verb}: ${summary.adds} added, ${summary.updates} updated, ${summary.deletes} deleted; ${image.width}×${image.height}px.`,
    MAX_DESCRIPTION_BYTES
  )

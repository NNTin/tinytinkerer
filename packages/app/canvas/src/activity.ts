import {
  partitionToolResultMedia,
  type ActivityStatus,
  type ActivitySummarizer,
  type ActivityView,
  type ActivityViewSection
} from '@tinytinkerer/app-shell'
import type { CanvasMethod } from './controller-handle'

type ResultRecord = Record<string, unknown>
type ActivityRule = {
  title: string
  warns(value: ResultRecord): boolean
}

const recordFrom = (output: unknown): ResultRecord =>
  typeof output === 'object' && output !== null && !Array.isArray(output)
    ? (output as ResultRecord)
    : {}

const nestedRecord = (value: unknown): ResultRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ResultRecord)
    : undefined

const isTruncated = (value: ResultRecord): boolean =>
  nestedRecord(value.truncation)?.truncated === true

const hasMissingIds = (value: ResultRecord): boolean =>
  Array.isArray(value.missingIds) && value.missingIds.length > 0

const zero = (value: ResultRecord, key: string): boolean =>
  typeof value[key] === 'number' && value[key] === 0

const mutationWarns = (value: ResultRecord): boolean => zero(value, 'updated') || isTruncated(value)

const rules: Record<CanvasMethod, ActivityRule> = {
  draw: { title: 'Drew on canvas', warns: (value) => zero(value, 'drawn') },
  search: {
    title: 'Searched canvas',
    warns: (value) => zero(value, 'matched') || isTruncated(value)
  },
  inspect: {
    title: 'Inspected canvas',
    warns: (value) => hasMissingIds(value) || isTruncated(value)
  },
  read: {
    title: 'Read canvas elements',
    warns: (value) => hasMissingIds(value) || isTruncated(value)
  },
  edit: { title: 'Edited canvas elements', warns: mutationWarns },
  clear: { title: 'Cleared canvas', warns: () => false },
  group: { title: 'Changed canvas grouping', warns: mutationWarns },
  duplicate: {
    title: 'Duplicated canvas elements',
    warns: (value) => zero(value, 'created') || isTruncated(value)
  },
  delete: { title: 'Deleted canvas elements', warns: (value) => zero(value, 'deleted') },
  align: { title: 'Aligned canvas elements', warns: mutationWarns },
  distribute: { title: 'Distributed canvas elements', warns: mutationWarns },
  stack: { title: 'Stacked canvas elements', warns: mutationWarns },
  order: { title: 'Reordered canvas elements', warns: mutationWarns },
  transform: { title: 'Transformed canvas elements', warns: mutationWarns },
  bind: { title: 'Updated connector bindings', warns: mutationWarns },
  audit: {
    title: 'Audited connector bindings',
    warns: (value) =>
      (typeof value.flagged === 'number' && value.flagged > 0) ||
      hasMissingIds(value) ||
      isTruncated(value)
  },
  snap: { title: 'Snapped canvas elements', warns: mutationWarns },
  place: { title: 'Placed canvas elements', warns: mutationWarns },
  arrange: { title: 'Arranged canvas elements', warns: mutationWarns },
  survey: {
    title: 'Surveyed canvas layout',
    warns: (value) =>
      (Array.isArray(value.findings) && value.findings.length > 0) ||
      hasMissingIds(value) ||
      isTruncated(value)
  },
  preset: { title: 'Inserted canvas preset', warns: (value) => zero(value, 'drawn') },
  icon: { title: 'Inserted canvas icon', warns: (value) => zero(value, 'drawn') },
  preview: {
    title: 'Previewed canvas changes',
    warns: (value) =>
      value.wouldChange === false || value.thumbnailReason === 'over-budget' || isTruncated(value)
  },
  thumbnail: {
    title: 'Rendered canvas thumbnail',
    warns: (value) =>
      hasMissingIds(value) || (Array.isArray(value.media) && value.media.length === 0)
  },
  pick: {
    title: 'Read canvas selection',
    warns: (value) => value.timedOut === true || zero(value, 'selectedCount') || isTruncated(value)
  }
}

const countFields: ReadonlyArray<readonly [string, string]> = [
  ['drawn', 'Drawn'],
  ['matched', 'Matched'],
  ['updated', 'Updated'],
  ['created', 'Created'],
  ['deleted', 'Deleted'],
  ['healthy', 'Healthy'],
  ['flagged', 'Flagged'],
  ['selectedCount', 'Selected'],
  ['elementCount', 'Elements']
]

const sectionsFor = (value: ResultRecord): ActivityViewSection[] => {
  const { media } = partitionToolResultMedia(value)
  const sections: ActivityViewSection[] = media.map((item) => ({
    kind: 'image',
    label: 'Image',
    dataUrl: item.dataUrl,
    alt: item.description,
    width: item.width,
    height: item.height
  }))
  for (const [key, label] of countFields) {
    if (typeof value[key] === 'number') {
      sections.push({ kind: 'text', label, value: String(value[key]) })
    }
  }
  const summary = nestedRecord(value.summary)
  if (typeof summary?.total === 'number') {
    sections.push({ kind: 'text', label: 'Proposed changes', value: String(summary.total) })
  }
  if (Array.isArray(value.missingIds) && value.missingIds.length > 0) {
    sections.push({
      kind: 'text',
      label: 'Missing IDs',
      value: value.missingIds.filter((id): id is string => typeof id === 'string').join(', ')
    })
  }
  if (value.timedOut === true) {
    sections.push({ kind: 'text', label: 'Timed out', value: 'No selection was received' })
  }
  if (typeof value.wouldChange === 'boolean') {
    sections.push({
      kind: 'text',
      label: 'Would change',
      value: value.wouldChange ? 'Yes' : 'No'
    })
  }
  if (typeof value.thumbnailReason === 'string') {
    sections.push({ kind: 'text', label: 'Preview image', value: value.thumbnailReason })
  }
  if (isTruncated(value)) {
    sections.push({ kind: 'text', label: 'Partial result', value: 'Result was truncated' })
  }
  if (typeof value.sceneVersion === 'number') {
    sections.push({ kind: 'text', label: 'Scene version', value: String(value.sceneVersion) })
  }
  if (sections.length === 0) {
    sections.push({ kind: 'text', label: 'Completed', value: value.ok === true ? 'Yes' : 'No' })
  }
  return sections
}

const summarizerFor =
  (method: CanvasMethod): ActivitySummarizer =>
  (output): ActivityView => {
    const value = recordFrom(output)
    const rule = rules[method]
    const status: ActivityStatus = value.ok !== true ? 'error' : rule.warns(value) ? 'warn' : 'ok'
    return {
      title: rule.title,
      status,
      sections: sectionsFor(value)
    }
  }

export const canvasActivitySummarizers = Object.fromEntries(
  (Object.keys(rules) as CanvasMethod[]).map((method) => [method, summarizerFor(method)])
) as Record<CanvasMethod, ActivitySummarizer>

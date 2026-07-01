import { describe, expect, it } from 'vitest'
import {
  alignInputSchema,
  arrangeInputSchema,
  auditInputSchema,
  bindInputSchema,
  clearInputSchema,
  deleteInputSchema,
  distributeInputSchema,
  drawInputSchema,
  duplicateInputSchema,
  editInputSchema,
  excalidrawLibraryImportContract,
  excalidrawSnapshotRestoreContract,
  excalidrawSnapshotSchema,
  excalidrawVerbContracts,
  EXCALIDRAW_DEFAULT_BINDING_GAP,
  EXCALIDRAW_LIBRARY_IMPORT_VERB,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_SNAPSHOT_VERSION,
  EXCALIDRAW_VERBS,
  isAllowedLibraryUrl,
  groupInputSchema,
  inspectInputSchema,
  orderInputSchema,
  placeInputSchema,
  readInputSchema,
  readElementSchema,
  searchInputSchema,
  snapInputSchema,
  stackInputSchema,
  surveyInputSchema,
  transformInputSchema
} from '../src/index'

describe('excalidraw protocol', () => {
  it('accepts the model-facing draw vocabulary', () => {
    expect(
      drawInputSchema.parse({
        elements: [
          { id: 'start', type: 'rectangle', x: 10, y: 20, width: 120, height: 80, text: 'Start' },
          { type: 'arrow', x: 130, y: 60, strokeColor: '#111' }
        ],
        connectors: [
          {
            id: 'start-to-end',
            from: { elementId: 'start', side: 'right' },
            to: { x: 240, y: 60 },
            routing: 'horizontal',
            rowY: 60
          }
        ],
        replace: true
      })
    ).toMatchObject({ replace: true, connectors: [{ id: 'start-to-end', routing: 'horizontal' }] })
  })

  it('rejects empty, unknown, and malformed draw elements', () => {
    expect(drawInputSchema.safeParse({ elements: [] }).success).toBe(false)
    expect(drawInputSchema.safeParse({ elements: [{ type: 'image', x: 0, y: 0 }] }).success).toBe(
      false
    )
    expect(
      drawInputSchema.safeParse({ elements: [{ type: 'text', x: Number.NaN, y: 0 }] }).success
    ).toBe(false)
    expect(
      drawInputSchema.safeParse({
        elements: [{ id: 'same', type: 'rectangle', x: 0, y: 0 }],
        connectors: [{ id: 'same', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }]
      }).success
    ).toBe(false)
  })

  it('defaults and bounds candidate search', () => {
    expect(searchInputSchema.parse({})).toEqual({
      scope: 'all',
      offset: 0,
      limit: 20,
      detail: 'standard'
    })
    expect(
      searchInputSchema.parse({
        query: 'router',
        types: ['rectangle', 'text'],
        scope: 'viewport',
        limit: 10
      })
    ).toMatchObject({ query: 'router', scope: 'viewport', limit: 10 })
    expect(searchInputSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(searchInputSchema.safeParse({ types: ['text', 'text'] }).success).toBe(false)
  })

  it('supports scene inspection and requires ids for full reads', () => {
    expect(inspectInputSchema.safeParse({}).success).toBe(true)
    expect(inspectInputSchema.safeParse({ elementIds: ['shape-1'] }).success).toBe(true)
    expect(inspectInputSchema.safeParse({ elementIds: [] }).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1'] }).success).toBe(true)
    expect(readInputSchema.safeParse({}).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1', 'shape-1'] }).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1'], offset: 1 }).success).toBe(false)
    expect(
      readInputSchema.parse({
        elementIds: ['shape-1'],
        offset: 1,
        expectedSceneVersion: 7,
        detail: 'full'
      })
    ).toMatchObject({ offset: 1, expectedSceneVersion: 7, detail: 'full' })
  })

  it('requires versioned, unique, non-empty edit patches', () => {
    expect(
      editInputSchema.parse({
        edits: [
          {
            id: 'shape-1',
            expectedVersion: 3,
            changes: { x: 100, strokeColor: '#111', locked: false }
          }
        ]
      })
    ).toMatchObject({ edits: [{ id: 'shape-1', expectedVersion: 3 }] })

    expect(
      editInputSchema.safeParse({
        edits: [{ id: 'shape-1', expectedVersion: 3, changes: {} }]
      }).success
    ).toBe(false)
    expect(
      editInputSchema.safeParse({
        edits: [
          { id: 'shape-1', expectedVersion: 3, changes: { opacity: 50 } },
          { id: 'shape-1', expectedVersion: 3, changes: { opacity: 75 } }
        ]
      }).success
    ).toBe(false)
    expect(
      editInputSchema.safeParse({
        edits: [{ id: 'shape-1', expectedVersion: 3, changes: { opacity: 101 } }]
      }).success
    ).toBe(false)
  })

  it('requires clear payloads to be empty objects', () => {
    expect(clearInputSchema.safeParse({}).success).toBe(true)
    expect(clearInputSchema.safeParse({ extra: true }).success).toBe(false)
  })

  it('defaults and validates structural editing verbs', () => {
    // Selection fallback: omitting `elements` stays valid and un-versioned.
    expect(groupInputSchema.parse({ operation: 'group' })).toEqual({ operation: 'group' })
    expect(groupInputSchema.safeParse({ operation: 'merge' }).success).toBe(false)
    expect(alignInputSchema.parse({ axis: 'y', position: 'center' })).toEqual({
      axis: 'y',
      position: 'center'
    })
    expect(stackInputSchema.parse({ direction: 'horizontal' })).toMatchObject({
      spacing: 20,
      align: 'center'
    })
    expect(orderInputSchema.safeParse({ operation: 'front' }).success).toBe(true)
    expect(orderInputSchema.safeParse({ operation: 'sideways' }).success).toBe(false)
    expect(distributeInputSchema.safeParse({ axis: 'z' }).success).toBe(false)
    // duplicate/delete are always explicit + versioned.
    expect(
      duplicateInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        expectedSceneVersion: 5
      })
    ).toMatchObject({ offset: { x: 10, y: 10 } })
    expect(duplicateInputSchema.safeParse({ elements: [], expectedSceneVersion: 5 }).success).toBe(
      false
    )
    expect(
      duplicateInputSchema.safeParse({ elements: [{ id: 'a', expectedVersion: 1 }] }).success
    ).toBe(false)
    expect(
      deleteInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        expectedSceneVersion: 5
      })
    ).toMatchObject({ includeRelated: false })
    expect(
      deleteInputSchema.safeParse({
        elements: [
          { id: 'a', expectedVersion: 1 },
          { id: 'a', expectedVersion: 2 }
        ],
        expectedSceneVersion: 5
      }).success
    ).toBe(false)
  })

  it('versions explicit structural operands by default', () => {
    // Explicit elements require a per-element expectedVersion AND expectedSceneVersion.
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        axis: 'x',
        position: 'start'
      }).success
    ).toBe(false)
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a' }],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: 3
      }).success
    ).toBe(false)
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: 3
      }).success
    ).toBe(true)
    // single-element explicit align is allowed by the schema (handled as a no-op)
    expect(
      orderInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        operation: 'front'
      }).success
    ).toBe(false)
  })

  it('requires versioned, non-empty transform geometry changes', () => {
    expect(
      transformInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 2, move: { dx: 5, dy: -5 } }]
      })
    ).toMatchObject({ elements: [{ id: 'a', expectedVersion: 2 }] })
    expect(
      transformInputSchema.safeParse({ elements: [{ id: 'a', expectedVersion: 2 }] }).success
    ).toBe(false)
    expect(
      transformInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 2, resize: {} }]
      }).success
    ).toBe(false)
    expect(
      transformInputSchema.safeParse({
        elements: [
          { id: 'a', expectedVersion: 1, move: { dx: 1, dy: 1 } },
          { id: 'a', expectedVersion: 1, move: { dx: 2, dy: 2 } }
        ]
      }).success
    ).toBe(false)
  })

  it('defaults transform reflow off and accepts the opt-in', () => {
    expect(
      transformInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 2, move: { dx: 5, dy: -5 } }]
      })
    ).toMatchObject({ reflowConnectors: false })
    expect(
      transformInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 2, resize: { width: 50 } }],
        reflowConnectors: true
      })
    ).toMatchObject({ reflowConnectors: true })
  })

  it('validates connector bind input and anchor defaults', () => {
    // Attaching defaults the anchor to a centered, gapped edge.
    expect(
      bindInputSchema.parse({
        connector: { id: 'link', expectedVersion: 3 },
        start: { action: 'attach', target: { id: 'box', expectedVersion: 1 } },
        expectedSceneVersion: 9
      })
    ).toMatchObject({
      start: { action: 'attach', anchor: { focus: 0, gap: EXCALIDRAW_DEFAULT_BINDING_GAP } }
    })
    // Detach needs no target.
    expect(
      bindInputSchema.safeParse({
        connector: { id: 'link', expectedVersion: 3 },
        end: { action: 'detach' },
        expectedSceneVersion: 9
      }).success
    ).toBe(true)
    // At least one endpoint change is required.
    expect(
      bindInputSchema.safeParse({
        connector: { id: 'link', expectedVersion: 3 },
        expectedSceneVersion: 9
      }).success
    ).toBe(false)
    // focus is clamped to [-1, 1].
    expect(
      bindInputSchema.safeParse({
        connector: { id: 'link', expectedVersion: 3 },
        start: {
          action: 'attach',
          target: { id: 'box', expectedVersion: 1 },
          anchor: { focus: 2 }
        },
        expectedSceneVersion: 9
      }).success
    ).toBe(false)
    // Unknown action is rejected.
    expect(
      bindInputSchema.safeParse({
        connector: { id: 'link', expectedVersion: 3 },
        start: { action: 'move' },
        expectedSceneVersion: 9
      }).success
    ).toBe(false)
  })

  it('validates connector audit paging', () => {
    expect(auditInputSchema.parse({})).toMatchObject({ offset: 0, limit: 20, detail: 'standard' })
    expect(auditInputSchema.safeParse({ connectorIds: ['a', 'a'] }).success).toBe(false)
    expect(auditInputSchema.safeParse({ offset: 1 }).success).toBe(false)
    expect(auditInputSchema.safeParse({ offset: 1, expectedSceneVersion: 4 }).success).toBe(true)
  })

  it('validates the layout helper verbs', () => {
    // snap: selection fallback stays valid; gridSize must be positive.
    expect(snapInputSchema.parse({})).toMatchObject({ snapSize: false })
    expect(snapInputSchema.safeParse({ gridSize: 0 }).success).toBe(false)
    expect(
      snapInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        gridSize: 10
      }).success
    ).toBe(false) // explicit elements need expectedSceneVersion
    // place: defaults gap/align; requires anchor + relation + versioned elements.
    expect(
      placeInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        anchor: { elementId: 'box' },
        relation: 'below',
        expectedSceneVersion: 4
      })
    ).toMatchObject({ gap: 20, align: 'center' })
    expect(
      placeInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        anchor: { groupId: 'g1' },
        relation: 'sideways',
        expectedSceneVersion: 4
      }).success
    ).toBe(false)
    // arrange: discriminated grid/circle layout.
    expect(
      arrangeInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        layout: { pattern: 'grid', columns: 2 },
        expectedSceneVersion: 4
      })
    ).toMatchObject({ layout: { pattern: 'grid', gapX: 20, gapY: 20 } })
    expect(
      arrangeInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        layout: { pattern: 'spiral' },
        expectedSceneVersion: 4
      }).success
    ).toBe(false)
    // survey: paging + unique checks.
    expect(surveyInputSchema.parse({})).toMatchObject({ offset: 0, limit: 20, detail: 'standard' })
    expect(surveyInputSchema.safeParse({ checks: ['overlap', 'overlap'] }).success).toBe(false)
    expect(surveyInputSchema.safeParse({ checks: [] }).success).toBe(false)
    expect(surveyInputSchema.safeParse({ offset: 1 }).success).toBe(false)
  })

  it('uses an independently owned app contract version', () => {
    expect(EXCALIDRAW_PROTOCOL_VERSION).toBe(6)
  })

  it('defines input and result contracts for every advertised verb', () => {
    expect(Object.keys(excalidrawVerbContracts)).toEqual(EXCALIDRAW_VERBS)
    expect(EXCALIDRAW_VERBS).toEqual([
      'draw',
      'search',
      'inspect',
      'read',
      'edit',
      'clear',
      'group',
      'duplicate',
      'delete',
      'align',
      'distribute',
      'stack',
      'order',
      'transform',
      'bind',
      'audit',
      'snap',
      'place',
      'arrange',
      'survey'
    ])
    expect(
      excalidrawVerbContracts.draw.resultSchema.safeParse({
        ok: true,
        drawn: 2,
        replaced: false,
        connectors: []
      }).success
    ).toBe(true)
    expect(excalidrawVerbContracts.clear.resultSchema.safeParse({ ok: false }).success).toBe(false)
    expect(
      excalidrawVerbContracts.bind.resultSchema.safeParse({
        ok: true,
        updated: 2,
        sceneVersion: 7,
        receipts: [{ id: 'link', version: 2 }],
        elements: [],
        truncation: {
          truncated: false,
          fields: [],
          omittedElements: 0,
          serializedBytes: 10,
          budgetBytes: 65536
        },
        connectorId: 'link',
        start: { bound: true, targetId: 'box', focus: 0, gap: 4 },
        end: { bound: false, targetId: null, focus: null, gap: null }
      }).success
    ).toBe(true)
    expect(
      excalidrawVerbContracts.audit.resultSchema.safeParse({
        ok: true,
        detail: 'standard',
        sceneVersion: 7,
        connectors: [
          {
            id: 'link',
            type: 'arrow',
            version: 2,
            start: { bound: true, targetId: 'box', status: 'ok', focus: 0, gap: 4 },
            end: { bound: false, targetId: null, status: 'unbound', focus: null, gap: null },
            issues: [],
            repairs: []
          }
        ],
        healthy: 1,
        flagged: 0,
        missingIds: [],
        page: { offset: 0, limit: 20, returned: 1, total: 1, nextOffset: null },
        truncation: {
          truncated: false,
          fields: [],
          omittedElements: 0,
          serializedBytes: 10,
          budgetBytes: 65536
        }
      }).success
    ).toBe(true)
    expect(
      excalidrawVerbContracts.survey.resultSchema.safeParse({
        ok: true,
        detail: 'standard',
        sceneVersion: 7,
        findings: [
          {
            kind: 'overlap',
            elementIds: ['a', 'b'],
            message: 'elements "a" and "b" overlap',
            suggestion: 'separate them or snap them to a grid'
          }
        ],
        overlaps: 1,
        labelIssues: 0,
        arrowIssues: 0,
        missingIds: [],
        page: { offset: 0, limit: 20, returned: 1, total: 1, nextOffset: null },
        truncation: {
          truncated: false,
          fields: [],
          omittedElements: 0,
          serializedBytes: 10,
          budgetBytes: 65536
        }
      }).success
    ).toBe(true)
    expect(
      excalidrawVerbContracts.arrange.resultSchema.safeParse({
        ok: true,
        updated: 3,
        sceneVersion: 9,
        receipts: [{ id: 'a', version: 2 }],
        elements: [],
        truncation: {
          truncated: false,
          fields: [],
          omittedElements: 0,
          serializedBytes: 10,
          budgetBytes: 65536
        }
      }).success
    ).toBe(true)
  })

  it('version-guards the persistence snapshot and keeps restore out of the verb set', () => {
    // The restore contract is intentionally not part of the model-facing verb set.
    expect(EXCALIDRAW_VERBS).not.toContain('app:restore')
    expect(
      excalidrawSnapshotSchema.safeParse({
        version: EXCALIDRAW_SNAPSHOT_VERSION,
        elements: [{ id: 'a', type: 'rectangle' }],
        appState: { scrollX: 1, zoom: { value: 1 } }
      }).success
    ).toBe(true)
    // A snapshot from another schema version fails closed (harness → empty scene).
    expect(excalidrawSnapshotSchema.safeParse({ version: 999, elements: [] }).success).toBe(false)
    expect(
      excalidrawSnapshotRestoreContract.resultSchema.safeParse({ ok: true, restored: 3 }).success
    ).toBe(true)
    expect(
      excalidrawSnapshotRestoreContract.inputSchema.safeParse({
        version: EXCALIDRAW_SNAPSHOT_VERSION,
        elements: []
      }).success
    ).toBe(true)
    // Imported library items round-trip through the snapshot.
    expect(
      excalidrawSnapshotSchema.safeParse({
        version: EXCALIDRAW_SNAPSHOT_VERSION,
        elements: [],
        libraryItems: [{ id: 'lib-1' }]
      }).success
    ).toBe(true)
  })

  it('defines the library import system verb outside the model-facing set', () => {
    expect(EXCALIDRAW_VERBS).not.toContain(EXCALIDRAW_LIBRARY_IMPORT_VERB)
    expect(
      excalidrawLibraryImportContract.inputSchema.safeParse({ content: '{"libraryItems":[]}' })
        .success
    ).toBe(true)
    // Empty content is rejected at the wire.
    expect(excalidrawLibraryImportContract.inputSchema.safeParse({ content: '' }).success).toBe(
      false
    )
    expect(
      excalidrawLibraryImportContract.resultSchema.safeParse({ ok: true, imported: 2 }).success
    ).toBe(true)
  })

  it('allow-lists only https excalidraw.com library URLs', () => {
    expect(isAllowedLibraryUrl('https://libraries.excalidraw.com/x.excalidrawlib')).toBe(true)
    expect(isAllowedLibraryUrl('https://excalidraw.com/x.excalidrawlib')).toBe(true)
    expect(isAllowedLibraryUrl('http://libraries.excalidraw.com/x.excalidrawlib')).toBe(false)
    expect(isAllowedLibraryUrl('https://evil.example.com/x.excalidrawlib')).toBe(false)
    // No substring/suffix spoofing of the host.
    expect(isAllowedLibraryUrl('https://excalidraw.com.evil.example/x')).toBe(false)
    expect(isAllowedLibraryUrl('not a url')).toBe(false)
  })

  it('rejects impossible discriminated element records', () => {
    const common = {
      id: 'a',
      version: 1,
      zIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      angleDegrees: 0,
      style: {
        strokeColor: '#000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      },
      locked: false,
      groupIds: [],
      frameId: null,
      link: null,
      boundElements: [],
      capabilities: { editableFields: ['locked'], requiresUnlock: false, restrictions: [] }
    }
    expect(
      readElementSchema.safeParse({
        ...common,
        kind: 'text',
        type: 'text',
        linear: { points: [], startBinding: null, endBinding: null }
      }).success
    ).toBe(false)
    expect(
      readElementSchema.safeParse({
        ...common,
        kind: 'unsupported',
        type: 'laser',
        unsupportedType: 'laser'
      }).success
    ).toBe(true)
  })
})

import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type {
  DrawConnector,
  IconInput,
  IconType,
  PresetInput
} from '@tinytinkerer/excalidraw-protocol'
import { drawFromSkeletons } from './create'
import { uniqueId } from './ids'
import { sceneVersionOf } from './normalization'
import { assertRequestBudget } from './query'

// Diagram-semantics behavior: build ready-made diagram scaffolds and infrastructure
// icon glyphs as Excalidraw element skeletons, then commit them through the shared
// `drawFromSkeletons` engine so each insertion is one atomic, undoable scene update.
// Everything here is encoded locally — no shape is fetched from an external library
// at runtime, so presets and icons work offline and inside the sandboxed iframe.
//
// Builders are pure: they turn an input into an intermediate `Build` (primitives +
// declarative links keyed by local names). The executors mint collision-free ids and
// group ids, translate the build into skeletons + connectors, version-check the scene,
// and commit once.

type ShapeType = 'rectangle' | 'ellipse' | 'diamond'
type PrimType = ShapeType | 'text' | 'line'
type Side = 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center'

// One drawable primitive in a build, addressed by a local `key`. Primitives that
// share a `group` become one Excalidraw group so a node/icon moves as a unit.
type Prim = {
  key: string
  group?: string
  type: PrimType
  x: number
  y: number
  width?: number
  height?: number
  label?: string // centered, container-bound caption (shapes only)
  text?: string // content for a standalone `text` primitive
  points?: Array<[number, number]>
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
}

type Endpoint = { key: string; side?: Side } | { x: number; y: number }
type Link = {
  from: Endpoint
  to: Endpoint
  type?: 'arrow' | 'line'
  routing?: 'auto' | 'horizontal' | 'vertical'
  rowY?: number
  trunkX?: number
  text?: string
  strokeColor?: string
}
type Build = { primitives: Prim[]; links: Link[] }
type IconMeta = { type: IconType; label: string; group: string; keys: string[] }

const INK = '#1e1e1e'
const NET_FILL = '#e7f5ff'
const DEVICE_FILL = '#e9ecef'
const SERVER_FILL = '#fff3bf'
const PAPER_FILL = '#ffffff'
const UI_FILL = '#f1f3f5'
const DIM_FILL = '#dee2e6'
const OK_FILL = '#40c057'

// Icon glyph geometry: a WxGLYPH_H glyph with a caption below.
const ICON_W = 88
const GLYPH_H = 52

// Rough monospace-ish width estimate so a standalone caption reads roughly centered
// under its glyph. Excalidraw re-measures the real width on convert; this only picks
// the left origin, so an approximation is fine.
const estimateTextWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.52

const defaultIconLabel = (type: IconType): string =>
  type === 'cloud' ? 'Internet' : `${type[0]!.toUpperCase()}${type.slice(1)}`

const line = (
  key: string,
  group: string | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra: Partial<Prim> = {}
): Prim => ({
  key,
  ...(group !== undefined ? { group } : {}),
  type: 'line',
  x: x1,
  y: y1,
  width: Math.abs(x2 - x1),
  height: Math.abs(y2 - y1),
  points: [
    [0, 0],
    [x2 - x1, y2 - y1]
  ],
  strokeColor: INK,
  ...extra
})

const caption = (
  key: string,
  group: string | undefined,
  cx: number,
  y: number,
  text: string
): Prim => {
  const fontSize = 16
  return {
    key,
    ...(group !== undefined ? { group } : {}),
    type: 'text',
    x: cx - estimateTextWidth(text, fontSize) / 2,
    y,
    text,
    fontSize,
    textAlign: 'center'
  }
}

// The six infrastructure icon factories. Each returns a grouped set of primitives:
// a primary shape keyed `${prefix}-body` (the connector anchor), a few decorative
// primitives, and a centered caption. Reused directly by the network presets.
const iconPrimitives = (
  type: IconType,
  x: number,
  y: number,
  prefix: string,
  group: string,
  label: string
): Prim[] => {
  const body = `${prefix}-body`
  const cap = caption(`${prefix}-cap`, group, x + ICON_W / 2, y + GLYPH_H + 4, label)
  switch (type) {
    case 'router':
      return [
        {
          key: body,
          group,
          type: 'rectangle',
          x,
          y,
          width: ICON_W,
          height: GLYPH_H,
          backgroundColor: NET_FILL,
          strokeColor: INK
        },
        line(
          `${prefix}-x1`,
          group,
          x + ICON_W * 0.3,
          y + GLYPH_H * 0.3,
          x + ICON_W * 0.7,
          y + GLYPH_H * 0.7
        ),
        line(
          `${prefix}-x2`,
          group,
          x + ICON_W * 0.7,
          y + GLYPH_H * 0.3,
          x + ICON_W * 0.3,
          y + GLYPH_H * 0.7
        ),
        cap
      ]
    case 'server':
      return [
        {
          key: body,
          group,
          type: 'rectangle',
          x,
          y,
          width: ICON_W,
          height: GLYPH_H,
          backgroundColor: SERVER_FILL,
          strokeColor: INK
        },
        line(`${prefix}-s1`, group, x + 10, y + GLYPH_H / 3, x + ICON_W - 10, y + GLYPH_H / 3),
        line(
          `${prefix}-s2`,
          group,
          x + 10,
          y + (GLYPH_H * 2) / 3,
          x + ICON_W - 10,
          y + (GLYPH_H * 2) / 3
        ),
        {
          key: `${prefix}-led`,
          group,
          type: 'ellipse',
          x: x + ICON_W - 18,
          y: y + 8,
          width: 8,
          height: 8,
          backgroundColor: OK_FILL,
          fillStyle: 'solid',
          strokeColor: INK
        },
        cap
      ]
    case 'cloud':
      return [
        {
          key: body,
          group,
          type: 'ellipse',
          x,
          y: y + GLYPH_H * 0.35,
          width: ICON_W,
          height: GLYPH_H * 0.6,
          backgroundColor: NET_FILL,
          strokeColor: INK
        },
        {
          key: `${prefix}-bl`,
          group,
          type: 'ellipse',
          x: x + ICON_W * 0.1,
          y: y + GLYPH_H * 0.12,
          width: ICON_W * 0.42,
          height: GLYPH_H * 0.6,
          backgroundColor: NET_FILL,
          strokeColor: INK
        },
        {
          key: `${prefix}-br`,
          group,
          type: 'ellipse',
          x: x + ICON_W * 0.44,
          y,
          width: ICON_W * 0.48,
          height: GLYPH_H * 0.66,
          backgroundColor: NET_FILL,
          strokeColor: INK
        },
        cap
      ]
    case 'laptop':
      return [
        {
          key: body,
          group,
          type: 'rectangle',
          x: x + 10,
          y,
          width: ICON_W - 20,
          height: GLYPH_H - 14,
          backgroundColor: DEVICE_FILL,
          strokeColor: INK
        },
        line(`${prefix}-base`, group, x, y + GLYPH_H - 6, x + ICON_W, y + GLYPH_H - 6),
        cap
      ]
    case 'phone': {
      const pw = 34
      const px = x + ICON_W / 2 - pw / 2
      return [
        {
          key: body,
          group,
          type: 'rectangle',
          x: px,
          y,
          width: pw,
          height: GLYPH_H,
          backgroundColor: DEVICE_FILL,
          strokeColor: INK
        },
        {
          key: `${prefix}-home`,
          group,
          type: 'ellipse',
          x: x + ICON_W / 2 - 4,
          y: y + GLYPH_H - 12,
          width: 8,
          height: 8,
          strokeColor: INK
        },
        cap
      ]
    }
    case 'printer':
      return [
        {
          key: `${prefix}-paper`,
          group,
          type: 'rectangle',
          x: x + ICON_W * 0.2,
          y,
          width: ICON_W * 0.6,
          height: GLYPH_H * 0.32,
          backgroundColor: PAPER_FILL,
          strokeColor: INK
        },
        {
          key: body,
          group,
          type: 'rectangle',
          x,
          y: y + GLYPH_H * 0.28,
          width: ICON_W,
          height: GLYPH_H * 0.72,
          backgroundColor: DIM_FILL,
          strokeColor: INK
        },
        line(
          `${prefix}-slot`,
          group,
          x + ICON_W * 0.15,
          y + GLYPH_H * 0.52,
          x + ICON_W * 0.85,
          y + GLYPH_H * 0.52
        ),
        cap
      ]
  }
}

const buildIcons = (input: IconInput): { build: Build; icons: IconMeta[] } => {
  const primitives: Prim[] = []
  const icons: IconMeta[] = []
  input.icons.forEach((spec, index) => {
    const prefix = `icon${index}`
    const label = spec.label ?? defaultIconLabel(spec.type)
    const prims = iconPrimitives(spec.type, spec.x, spec.y, prefix, prefix, label)
    primitives.push(...prims)
    icons.push({ type: spec.type, label, group: prefix, keys: prims.map((prim) => prim.key) })
  })
  return { build: { primitives, links: [] }, icons }
}

// --- Diagram presets -------------------------------------------------------

const terminal = (key: string, x: number, y: number, w: number, label: string): Prim => ({
  key,
  type: 'ellipse',
  x,
  y,
  width: w,
  height: 46,
  label,
  backgroundColor: '#d3f9d8',
  strokeColor: INK
})
const processBox = (
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
): Prim => ({
  key,
  type: 'rectangle',
  x,
  y,
  width: w,
  height: h,
  label,
  backgroundColor: UI_FILL,
  strokeColor: INK
})

const networkStar = (ox: number, oy: number): Build => {
  const devices: IconType[] = ['server', 'laptop', 'phone', 'printer']
  const rowY = oy + 150
  const primitives: Prim[] = []
  const links: Link[] = []
  const routerX = ox + (devices.length * ICON_W + (devices.length - 1) * 40 - ICON_W) / 2
  primitives.push(...iconPrimitives('router', routerX, oy, 'router', 'router', 'Router'))
  devices.forEach((type, index) => {
    const prefix = `dev${index}`
    const dx = ox + index * (ICON_W + 40)
    primitives.push(...iconPrimitives(type, dx, rowY, prefix, prefix, defaultIconLabel(type)))
    links.push({
      from: { key: 'router-body', side: 'bottom' },
      to: { key: `${prefix}-body`, side: 'top' }
    })
  })
  return { primitives, links }
}

const networkEdge = (ox: number, oy: number): Build => {
  const chain: IconType[] = ['cloud', 'router', 'server']
  const primitives: Prim[] = []
  const links: Link[] = []
  chain.forEach((type, index) => {
    const prefix = `edge${index}`
    const cx = ox + index * (ICON_W + 70)
    primitives.push(...iconPrimitives(type, cx, oy, prefix, prefix, defaultIconLabel(type)))
    if (index > 0)
      links.push({
        from: { key: `edge${index - 1}-body`, side: 'right' },
        to: { key: `${prefix}-body`, side: 'left' },
        routing: 'horizontal',
        rowY: oy + GLYPH_H / 2
      })
  })
  return { primitives, links }
}

const flowchartLinear = (ox: number, oy: number): Build => {
  const w = 150
  const trunkX = ox + w / 2
  return {
    primitives: [
      terminal('start', ox, oy, w, 'Start'),
      processBox('process', ox, oy + 100, w, 60, 'Process'),
      terminal('end', ox, oy + 220, w, 'End')
    ],
    links: [
      {
        from: { key: 'start', side: 'bottom' },
        to: { key: 'process', side: 'top' },
        routing: 'vertical',
        trunkX
      },
      {
        from: { key: 'process', side: 'bottom' },
        to: { key: 'end', side: 'top' },
        routing: 'vertical',
        trunkX
      }
    ]
  }
}

const flowchartDecision = (ox: number, oy: number): Build => {
  const w = 150
  const cx = ox + w / 2
  // Two forward branches: "Yes" continues straight down, "No" exits to the right —
  // both non-degenerate under the shared-row / shared-trunk connector model.
  return {
    primitives: [
      terminal('start', ox, oy, w, 'Start'),
      processBox('process', ox, oy + 90, w, 56, 'Process'),
      {
        key: 'decision',
        type: 'diamond',
        x: ox,
        y: oy + 186,
        width: w,
        height: 96,
        label: 'Approved?',
        backgroundColor: '#fff9db',
        strokeColor: INK
      },
      terminal('end', ox, oy + 336, w, 'Done'),
      terminal('reject', ox + w + 90, oy + 211, w, 'Reject')
    ],
    links: [
      {
        from: { key: 'start', side: 'bottom' },
        to: { key: 'process', side: 'top' },
        routing: 'vertical',
        trunkX: cx
      },
      {
        from: { key: 'process', side: 'bottom' },
        to: { key: 'decision', side: 'top' },
        routing: 'vertical',
        trunkX: cx
      },
      {
        from: { key: 'decision', side: 'bottom' },
        to: { key: 'end', side: 'top' },
        routing: 'vertical',
        trunkX: cx,
        text: 'Yes'
      },
      {
        from: { key: 'decision', side: 'right' },
        to: { key: 'reject', side: 'left' },
        routing: 'horizontal',
        rowY: oy + 234,
        text: 'No',
        strokeColor: '#e8590c'
      }
    ]
  }
}

const classBox = (
  keyPrefix: string,
  x: number,
  y: number,
  name: string,
  attributes: string[],
  methods: string[]
): Prim[] => {
  const w = 180
  const nameH = 32
  const attrH = 52
  const methodH = 52
  const group = keyPrefix
  const textAt = (key: string, ty: number, lines: string[]): Prim => ({
    key,
    group,
    type: 'text',
    x: x + 8,
    y: ty,
    text: lines.join('\n'),
    fontSize: 14
  })
  return [
    {
      key: `${keyPrefix}-box`,
      group,
      type: 'rectangle',
      x,
      y,
      width: w,
      height: nameH + attrH + methodH,
      backgroundColor: UI_FILL,
      strokeColor: INK
    },
    line(`${keyPrefix}-d1`, group, x, y + nameH, x + w, y + nameH),
    line(`${keyPrefix}-d2`, group, x, y + nameH + attrH, x + w, y + nameH + attrH),
    {
      key: `${keyPrefix}-name`,
      group,
      type: 'text',
      x: x + w / 2 - estimateTextWidth(name, 16) / 2,
      y: y + 8,
      text: name,
      fontSize: 16
    },
    textAt(`${keyPrefix}-attrs`, y + nameH + 8, attributes),
    textAt(`${keyPrefix}-methods`, y + nameH + attrH + 8, methods)
  ]
}

const umlClass = (ox: number, oy: number): Build => ({
  primitives: [
    ...classBox(
      'clsA',
      ox,
      oy,
      'Account',
      ['- balance: number', '- owner: string'],
      ['+ deposit(n)', '+ withdraw(n)']
    ),
    ...classBox(
      'clsB',
      ox + 260,
      oy,
      'Customer',
      ['- name: string', '- id: string'],
      ['+ open()', '+ close()']
    )
  ],
  links: [
    {
      from: { key: 'clsB-box', side: 'left' },
      to: { key: 'clsA-box', side: 'right' },
      routing: 'horizontal',
      text: 'owns'
    }
  ]
})

const umlSequence = (ox: number, oy: number): Build => {
  const lifelineBottom = oy + 240
  const objectHead = (prefix: string, x: number, label: string): Prim[] => [
    {
      key: `${prefix}-head`,
      group: prefix,
      type: 'rectangle',
      x,
      y: oy,
      width: 120,
      height: 40,
      label,
      backgroundColor: UI_FILL,
      strokeColor: INK
    },
    line(`${prefix}-life`, prefix, x + 60, oy + 40, x + 60, lifelineBottom, {
      strokeStyle: 'dashed'
    })
  ]
  const ax = ox
  const bx = ox + 240
  return {
    primitives: [...objectHead('objA', ax, ':User'), ...objectHead('objB', bx, ':Service')],
    links: [
      {
        from: { x: ax + 60, y: oy + 90 },
        to: { x: bx + 60, y: oy + 90 },
        routing: 'horizontal',
        text: 'request()'
      },
      {
        from: { x: bx + 60, y: oy + 160 },
        to: { x: ax + 60, y: oy + 160 },
        routing: 'horizontal',
        text: 'response()'
      }
    ]
  }
}

const actorFigure = (ox: number, oy: number): Prim[] => {
  const group = 'actor'
  const cx = ox + 20
  return [
    {
      key: 'actor-head',
      group,
      type: 'ellipse',
      x: cx - 12,
      y: oy,
      width: 24,
      height: 24,
      strokeColor: INK
    },
    line('actor-body', group, cx, oy + 24, cx, oy + 60),
    line('actor-arms', group, cx - 18, oy + 36, cx + 18, oy + 36),
    line('actor-legL', group, cx, oy + 60, cx - 15, oy + 84),
    line('actor-legR', group, cx, oy + 60, cx + 15, oy + 84),
    caption('actor-cap', group, cx, oy + 90, 'User')
  ]
}

const umlUsecase = (ox: number, oy: number): Build => {
  const oval = (key: string, y: number, label: string): Prim => ({
    key,
    type: 'ellipse',
    x: ox + 140,
    y,
    width: 150,
    height: 60,
    label,
    backgroundColor: UI_FILL,
    strokeColor: INK
  })
  return {
    primitives: [
      ...actorFigure(ox, oy + 10),
      oval('uc-login', oy, 'Log in'),
      oval('uc-checkout', oy + 90, 'Checkout')
    ],
    links: [
      {
        from: { key: 'actor-body', side: 'right' },
        to: { key: 'uc-login', side: 'left' },
        type: 'line'
      },
      {
        from: { key: 'actor-body', side: 'right' },
        to: { key: 'uc-checkout', side: 'left' },
        type: 'line'
      }
    ]
  }
}

const button = (key: string, group: string, x: number, y: number, label: string): Prim => ({
  key,
  group,
  type: 'rectangle',
  x,
  y,
  width: 120,
  height: 40,
  label,
  backgroundColor: '#a5d8ff',
  strokeColor: INK
})

const wireframeScreen = (ox: number, oy: number): Build => {
  const group = 'screen'
  const w = 300
  return {
    primitives: [
      {
        key: 'frame',
        group,
        type: 'rectangle',
        x: ox,
        y: oy,
        width: w,
        height: 460,
        strokeColor: INK
      },
      {
        key: 'nav',
        group,
        type: 'rectangle',
        x: ox,
        y: oy,
        width: w,
        height: 48,
        label: 'App',
        backgroundColor: DIM_FILL,
        strokeColor: INK
      },
      {
        key: 'input',
        group,
        type: 'rectangle',
        x: ox + 20,
        y: oy + 80,
        width: w - 40,
        height: 40,
        label: 'Search…',
        backgroundColor: PAPER_FILL,
        strokeColor: INK
      },
      button('btn-cancel', group, ox + 20, oy + 140, 'Cancel'),
      button('btn-ok', group, ox + 160, oy + 140, 'OK'),
      {
        key: 'card',
        group,
        type: 'rectangle',
        x: ox + 20,
        y: oy + 200,
        width: w - 40,
        height: 220,
        label: 'Card',
        backgroundColor: UI_FILL,
        strokeColor: INK
      }
    ],
    links: []
  }
}

const wireframeModal = (ox: number, oy: number): Build => {
  const group = 'modal'
  return {
    primitives: [
      {
        key: 'backdrop',
        group,
        type: 'rectangle',
        x: ox,
        y: oy,
        width: 360,
        height: 300,
        backgroundColor: DIM_FILL,
        fillStyle: 'solid',
        strokeColor: INK
      },
      {
        key: 'dialog',
        group,
        type: 'rectangle',
        x: ox + 60,
        y: oy + 70,
        width: 240,
        height: 160,
        backgroundColor: PAPER_FILL,
        strokeColor: INK
      },
      {
        key: 'dialog-title',
        group,
        type: 'text',
        x: ox + 76,
        y: oy + 84,
        text: 'Confirm',
        fontSize: 18
      },
      {
        key: 'dialog-body',
        group,
        type: 'text',
        x: ox + 76,
        y: oy + 120,
        text: 'Are you sure?',
        fontSize: 14
      },
      button('modal-cancel', group, ox + 70, oy + 178, 'Cancel'),
      button('modal-ok', group, ox + 200, oy + 178, 'OK')
    ],
    links: []
  }
}

const buildPreset = (input: PresetInput): Build => {
  const ox = input.x
  const oy = input.y
  let build: Build
  switch (input.kind) {
    case 'network':
      build = input.variant === 'edge' ? networkEdge(ox, oy) : networkStar(ox, oy)
      break
    case 'flowchart':
      build = input.variant === 'decision' ? flowchartDecision(ox, oy) : flowchartLinear(ox, oy)
      break
    case 'uml':
      build =
        input.variant === 'sequence'
          ? umlSequence(ox, oy)
          : input.variant === 'usecase'
            ? umlUsecase(ox, oy)
            : umlClass(ox, oy)
      break
    case 'wireframe':
      build = input.variant === 'modal' ? wireframeModal(ox, oy) : wireframeScreen(ox, oy)
      break
  }
  if (input.title !== undefined)
    build.primitives.unshift({
      key: 'preset-title',
      type: 'text',
      x: ox,
      y: oy - 44,
      text: input.title,
      fontSize: 22
    })
  return build
}

// --- Commit -----------------------------------------------------------------

const primToSkeleton = (
  prim: Prim,
  idByKey: ReadonlyMap<string, string>,
  groupIdByKey: ReadonlyMap<string, string>
): Record<string, unknown> => {
  const base: Record<string, unknown> = { id: idByKey.get(prim.key)!, x: prim.x, y: prim.y }
  if (prim.group) base.groupIds = [groupIdByKey.get(prim.group)!]
  if (prim.strokeColor) base.strokeColor = prim.strokeColor
  if (prim.backgroundColor) base.backgroundColor = prim.backgroundColor
  if (prim.fillStyle) base.fillStyle = prim.fillStyle
  if (prim.strokeStyle) base.strokeStyle = prim.strokeStyle
  if (prim.type === 'text') {
    return {
      ...base,
      type: 'text',
      text: prim.text ?? '',
      ...(prim.fontSize ? { fontSize: prim.fontSize } : {}),
      ...(prim.textAlign ? { textAlign: prim.textAlign } : {})
    }
  }
  if (prim.type === 'line') {
    const width = prim.width ?? 0
    const height = prim.height ?? 0
    return {
      ...base,
      type: 'line',
      width,
      height,
      points: prim.points ?? [
        [0, 0],
        [width, height]
      ]
    }
  }
  return {
    ...base,
    type: prim.type,
    width: prim.width ?? 100,
    height: prim.height ?? 60,
    ...(prim.label ? { label: { text: prim.label } } : {})
  }
}

const linkToConnector = (
  link: Link,
  idByKey: ReadonlyMap<string, string>,
  verb: string
): DrawConnector => {
  const resolve = (endpoint: Endpoint) => {
    if ('key' in endpoint) {
      const elementId = idByKey.get(endpoint.key)
      if (!elementId)
        throw new Error(`${verb}: connector references unknown primitive "${endpoint.key}"`)
      return { elementId, side: endpoint.side ?? ('auto' as const) }
    }
    return { x: endpoint.x, y: endpoint.y }
  }
  return {
    type: link.type ?? 'arrow',
    from: resolve(link.from),
    to: resolve(link.to),
    routing: link.routing ?? 'auto',
    ...(link.rowY !== undefined ? { rowY: link.rowY } : {}),
    ...(link.trunkX !== undefined ? { trunkX: link.trunkX } : {}),
    ...(link.text ? { text: link.text } : {}),
    ...(link.strokeColor ? { strokeColor: link.strokeColor } : {})
  }
}

// `expectedSceneVersion` is a required-but-nullable field (not an optional
// property) so a parsed verb input — whose zod optional widens to
// `number | undefined` — assigns cleanly under exactOptionalPropertyTypes.
type CommitCtl = { replace: boolean; expectedSceneVersion: number | undefined }
type Committed = {
  drawn: number
  replaced: boolean
  sceneVersion: number
  groupIds: string[]
  createdIds: string[]
  connectors: ReturnType<typeof drawFromSkeletons>['connectors']
  idByKey: Map<string, string>
  groupIdByKey: Map<string, string>
}

// Mint collision-free ids + group ids for the build, version-check the current
// scene, and commit the skeletons + connectors in exactly one atomic, undoable
// update. Rejects (before any write) if the caller's `expectedSceneVersion` no
// longer matches the live scene.
const commitBuild = (
  api: ExcalidrawImperativeAPI,
  verb: 'preset' | 'icon',
  build: Build,
  ctl: CommitCtl
): Committed => {
  const current = api.getSceneElements()
  const sceneVersion = sceneVersionOf(current)
  if (ctl.expectedSceneVersion !== undefined && ctl.expectedSceneVersion !== sceneVersion)
    throw new Error(
      `${verb}: scene changed (expected scene version ${ctl.expectedSceneVersion}, current version ${sceneVersion}); read it again before retrying`
    )
  if (build.primitives.length === 0) throw new Error(`${verb}: nothing to insert`)

  const reserve = new Set<string>(current.map(({ id }) => id))
  const idByKey = new Map<string, string>()
  for (const prim of build.primitives) {
    if (idByKey.has(prim.key)) throw new Error(`${verb}: duplicate primitive key "${prim.key}"`)
    idByKey.set(prim.key, uniqueId('tt-preset', reserve))
  }
  const groupIdByKey = new Map<string, string>()
  for (const prim of build.primitives)
    if (prim.group && !groupIdByKey.has(prim.group))
      groupIdByKey.set(prim.group, uniqueId('tt-group', reserve))

  const elementSkeletons = build.primitives.map((prim) =>
    primToSkeleton(prim, idByKey, groupIdByKey)
  )
  const connectors = build.links.map((link) => linkToConnector(link, idByKey, verb))
  const commit = drawFromSkeletons(api, {
    elementSkeletons,
    connectors,
    replace: ctl.replace,
    usedIds: reserve
  })
  const committedScene: OrderedExcalidrawElement[] = [...commit.existing, ...commit.converted]
  return {
    drawn: commit.drawn,
    replaced: commit.replaced,
    sceneVersion: sceneVersionOf(committedScene),
    groupIds: [...groupIdByKey.values()],
    createdIds: build.primitives.map((prim) => idByKey.get(prim.key)!),
    connectors: commit.connectors,
    idByKey,
    groupIdByKey
  }
}

export const executePreset = (api: ExcalidrawImperativeAPI, input: PresetInput) => {
  assertRequestBudget('preset', input)
  const build = buildPreset(input)
  const committed = commitBuild(api, 'preset', build, {
    replace: input.replace,
    expectedSceneVersion: input.expectedSceneVersion
  })
  return {
    ok: true as const,
    drawn: committed.drawn,
    replaced: committed.replaced,
    sceneVersion: committed.sceneVersion,
    groupIds: committed.groupIds,
    createdIds: committed.createdIds,
    connectors: committed.connectors,
    kind: input.kind,
    variant: input.variant
  }
}

export const executeIcon = (api: ExcalidrawImperativeAPI, input: IconInput) => {
  assertRequestBudget('icon', input)
  const { build, icons } = buildIcons(input)
  const committed = commitBuild(api, 'icon', build, {
    replace: input.replace,
    expectedSceneVersion: input.expectedSceneVersion
  })
  return {
    ok: true as const,
    drawn: committed.drawn,
    replaced: committed.replaced,
    sceneVersion: committed.sceneVersion,
    groupIds: committed.groupIds,
    createdIds: committed.createdIds,
    connectors: committed.connectors,
    icons: icons.map((icon) => ({
      type: icon.type,
      label: icon.label,
      groupId: committed.groupIdByKey.get(icon.group)!,
      elementIds: icon.keys.map((key) => committed.idByKey.get(key)!)
    }))
  }
}

// Exposed for unit tests: the pure builders, independent of the Excalidraw runtime.
export const __presetInternals = { buildPreset, buildIcons, iconPrimitives }

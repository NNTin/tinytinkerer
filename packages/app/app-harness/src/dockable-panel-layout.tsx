import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type DockablePanel = { id: string; title: string; content: ReactNode }
export type DockableLayoutPreset = 'a' | 'b' | 'c' | 'd'
type ActiveLayout = DockableLayoutPreset | 'custom'
export type DockablePanelLayoutProps = {
  panels: [DockablePanel, DockablePanel, DockablePanel]
  storageKey: string
  defaultPreset?: DockableLayoutPreset
  className?: string
}
type LayoutState = {
  preset: ActiveLayout
  assignments: Record<DockableLayoutPreset, string[]>
  sizes: Record<DockableLayoutPreset, [number, number]>
  custom?: {
    basePreset: DockableLayoutPreset
    assignments: string[]
    sizes: [number, number]
  }
}
const LABELS: Record<DockableLayoutPreset, string> = {
  a: 'A · Split workspace',
  b: 'B · Editor first',
  c: 'C · Three columns',
  d: 'D · Assistant first'
}
const assignmentsFor = (panels: DockablePanel[]): LayoutState['assignments'] => {
  const editor = panels.find((panel) => panel.id === 'editor')?.id ?? panels[0]?.id ?? ''
  const preview = panels.find((panel) => panel.id === 'preview')?.id ?? panels[1]?.id ?? ''
  const assistant = panels.find((panel) => panel.id === 'assistant')?.id ?? panels[2]?.id ?? ''
  return {
    a: [preview, editor, assistant],
    b: [editor, preview, assistant],
    c: [editor, preview, assistant],
    d: [assistant, preview, editor]
  }
}
const fallbackState = (panels: DockablePanel[], preset: DockableLayoutPreset): LayoutState => ({
  preset,
  assignments: assignmentsFor(panels),
  sizes: { a: [58, 52], b: [46, 50], c: [32, 67], d: [42, 50] }
})
const loadState = (
  panels: DockablePanel[],
  key: string,
  preset: DockableLayoutPreset
): LayoutState => {
  const fallback = fallbackState(panels, preset)
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as LayoutState | null
    if (!parsed || (parsed.preset !== 'custom' && !(parsed.preset in LABELS))) return fallback
    const ids = new Set(panels.map((panel) => panel.id))
    for (const name of Object.keys(LABELS) as DockableLayoutPreset[]) {
      const values = parsed.assignments?.[name]
      if (!values || values.length !== 3 || values.some((id) => !ids.has(id))) return fallback
    }
    if (parsed.preset === 'custom') {
      const custom = parsed.custom
      if (
        !custom ||
        !(custom.basePreset in LABELS) ||
        custom.assignments.length !== 3 ||
        custom.assignments.some((id) => !ids.has(id))
      ) {
        return fallback
      }
      return { ...fallback, preset: 'custom', custom }
    }

    // Layouts persisted by the pre-custom implementation may have modified a
    // named preset in place. Preserve that work, but correctly identify it as
    // custom instead of claiming it is still the canonical preset.
    const canonical = fallback.assignments[parsed.preset]
    const defaultSizes = fallback.sizes[parsed.preset]
    const storedAssignments = parsed.assignments[parsed.preset]
    const storedSizes = parsed.sizes[parsed.preset]
    const differs =
      storedAssignments.some((id, index) => id !== canonical[index]) ||
      storedSizes.some((value, index) => value !== defaultSizes[index])
    return differs
      ? {
          ...fallback,
          preset: 'custom',
          custom: {
            basePreset: parsed.preset,
            assignments: [...storedAssignments],
            sizes: [...storedSizes]
          }
        }
      : fallback
  } catch {
    return fallback
  }
}
type Rect = { left: number; top: number; width: number; height: number }
type Separator = { axis: 'x' | 'y'; value: number; start: number; length: number; index: 0 | 1 }
const geometry = (
  preset: DockableLayoutPreset | 'narrow',
  sizes: [number, number]
): { rects: Rect[]; separators: Separator[] } => {
  const [a, b] = sizes
  if (preset === 'narrow')
    return {
      rects: [
        { left: 0, top: 0, width: 100, height: a },
        { left: 0, top: a, width: 100, height: b - a },
        { left: 0, top: b, width: 100, height: 100 - b }
      ],
      separators: []
    }
  if (preset === 'a')
    return {
      rects: [
        { left: 0, top: 0, width: a, height: b },
        { left: 0, top: b, width: a, height: 100 - b },
        { left: a, top: 0, width: 100 - a, height: 100 }
      ],
      separators: [
        { axis: 'x', value: a, start: 0, length: 100, index: 0 },
        { axis: 'y', value: b, start: 0, length: a, index: 1 }
      ]
    }
  if (preset === 'b' || preset === 'd')
    return {
      rects: [
        { left: 0, top: 0, width: 100, height: a },
        { left: 0, top: a, width: b, height: 100 - a },
        { left: b, top: a, width: 100 - b, height: 100 - a }
      ],
      separators: [
        { axis: 'y', value: a, start: 0, length: 100, index: 0 },
        { axis: 'x', value: b, start: a, length: 100 - a, index: 1 }
      ]
    }
  return {
    rects: [
      { left: 0, top: 0, width: a, height: 100 },
      { left: a, top: 0, width: b - a, height: 100 },
      { left: b, top: 0, width: 100 - b, height: 100 }
    ],
    separators: [
      { axis: 'x', value: a, start: 0, length: 100, index: 0 },
      { axis: 'x', value: b, start: 0, length: 100, index: 1 }
    ]
  }
}
const clamp = (
  preset: DockableLayoutPreset,
  sizes: [number, number],
  index: 0 | 1,
  value: number
): [number, number] => {
  const next: [number, number] = [...sizes]
  next[index] =
    preset === 'c'
      ? index === 0
        ? Math.max(20, Math.min(value, next[1] - 20))
        : Math.max(next[0] + 20, Math.min(value, 80))
      : Math.max(25, Math.min(value, 75))
  return next
}

export const DockablePanelLayout = ({
  panels,
  storageKey,
  defaultPreset = 'a',
  className
}: DockablePanelLayoutProps) => {
  const [state, setState] = useState(() => loadState(panels, storageKey, defaultPreset))
  const [narrow, setNarrow] = useState(() => window.innerWidth < 720)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth < 720)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* optional */
    }
  }, [state, storageKey])
  const basePreset =
    state.preset === 'custom' ? (state.custom?.basePreset ?? defaultPreset) : state.preset
  const activeLayout = narrow ? 'narrow' : state.preset
  const ids = narrow
    ? assignmentsFor(panels).d
    : state.preset === 'custom'
      ? (state.custom?.assignments ?? state.assignments[basePreset])
      : state.assignments[state.preset]
  const activeSizes =
    state.preset === 'custom'
      ? (state.custom?.sizes ?? state.sizes[basePreset])
      : state.sizes[state.preset]
  const layout = geometry(narrow ? 'narrow' : basePreset, narrow ? [34, 67] : activeSizes)
  const byId = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels])
  const swap = (sourceId: string, targetId: string) => {
    if (narrow || sourceId === targetId) return
    setState((current) => {
      const currentPreset =
        current.preset === 'custom' ? (current.custom?.basePreset ?? defaultPreset) : current.preset
      const next = [
        ...(current.preset === 'custom'
          ? (current.custom?.assignments ?? current.assignments[currentPreset])
          : current.assignments[currentPreset])
      ]
      const source = next.indexOf(sourceId)
      const target = next.indexOf(targetId)
      if (source < 0 || target < 0) return current
      const held = next[source] ?? ''
      next[source] = next[target] ?? ''
      next[target] = held
      return {
        ...current,
        preset: 'custom',
        custom: {
          basePreset: currentPreset,
          assignments: next,
          sizes:
            current.preset === 'custom'
              ? (current.custom?.sizes ?? current.sizes[currentPreset])
              : current.sizes[currentPreset]
        }
      }
    })
  }
  const updateSize = (index: 0 | 1, value: number) =>
    setState((current) => {
      const currentPreset =
        current.preset === 'custom' ? (current.custom?.basePreset ?? defaultPreset) : current.preset
      const currentSizes =
        current.preset === 'custom'
          ? (current.custom?.sizes ?? current.sizes[currentPreset])
          : current.sizes[currentPreset]
      return {
        ...current,
        preset: 'custom',
        custom: {
          basePreset: currentPreset,
          assignments:
            current.preset === 'custom'
              ? (current.custom?.assignments ?? current.assignments[currentPreset])
              : current.assignments[currentPreset],
          sizes: clamp(currentPreset, currentSizes, index, value)
        }
      }
    })

  const choosePreset = (preset: DockableLayoutPreset) => {
    const defaults = fallbackState(panels, preset)
    setState((current) => ({
      ...current,
      preset,
      assignments: {
        ...current.assignments,
        [preset]: defaults.assignments[preset]
      },
      sizes: { ...current.sizes, [preset]: defaults.sizes[preset] }
    }))
  }

  const finishDrag = () => {
    draggedIdRef.current = null
    setDraggedId(null)
    setDropTargetId(null)
  }
  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, separator: Separator) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      updateSize(
        separator.index,
        separator.axis === 'x'
          ? ((moveEvent.clientX - rect.left) / rect.width) * 100
          : ((moveEvent.clientY - rect.top) / rect.height) * 100
      )
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  return (
    <div className={['app-dock-workspace', className].filter(Boolean).join(' ')}>
      <div className="app-dock-toolbar">
        <strong>Mermaid workspace</strong>
        <label>
          Layout{' '}
          <select
            value={state.preset}
            onChange={(event) => choosePreset(event.target.value as DockableLayoutPreset)}
          >
            {state.preset === 'custom' ? <option value="custom">Custom</option> : null}
            {(Object.keys(LABELS) as DockableLayoutPreset[]).map((preset) => (
              <option key={preset} value={preset}>
                {LABELS[preset]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setState(fallbackState(panels, defaultPreset))}>
          Reset layout
        </button>
      </div>
      <div
        ref={rootRef}
        className="app-dock-canvas"
        data-layout={activeLayout}
        data-layout-base={basePreset}
      >
        {ids.map((id, index) => {
          const panel = byId.get(id)
          const rect = layout.rects[index]
          if (!panel || !rect) return null
          const style: CSSProperties = {
            left: `${rect.left}%`,
            top: `${rect.top}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`
          }
          return (
            <section
              key={panel.id}
              className="app-dock-panel"
              style={style}
              aria-label={panel.title}
              data-panel-id={panel.id}
              data-drop-target={dropTargetId === panel.id ? 'true' : 'false'}
              onDragEnter={(event) => {
                event.preventDefault()
                if (draggedIdRef.current && draggedIdRef.current !== panel.id) {
                  setDropTargetId(panel.id)
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTargetId((current) => (current === panel.id ? null : current))
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourceId =
                  event.dataTransfer.getData('text/plain') || draggedIdRef.current || draggedId
                if (sourceId) swap(sourceId, panel.id)
                finishDrag()
              }}
            >
              <header
                draggable={!narrow}
                data-panel-drag-handle={panel.id}
                onDragStart={(event) => {
                  draggedIdRef.current = panel.id
                  setDraggedId(panel.id)
                  event.dataTransfer.setData('text/plain', panel.id)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={finishDrag}
              >
                <span className="app-dock-grip" aria-hidden="true">
                  ⠿
                </span>
                <strong>{panel.title}</strong>
                <label className="app-dock-move-label">
                  <span className="sr-only">Move {panel.title}</span>
                  <select
                    aria-label={`Move ${panel.title}`}
                    value={panel.id}
                    onChange={(event) => swap(panel.id, event.target.value)}
                    disabled={narrow}
                    draggable={false}
                  >
                    {ids.map((targetId, targetIndex) => (
                      <option key={targetId} value={targetId}>
                        Position {targetIndex + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
              <div className="app-dock-panel-body">{panel.content}</div>
            </section>
          )
        })}
        {!narrow &&
          layout.separators.map((separator, index) => {
            const style: CSSProperties =
              separator.axis === 'x'
                ? {
                    left: `${separator.value}%`,
                    top: `${separator.start}%`,
                    height: `${separator.length}%`
                  }
                : {
                    top: `${separator.value}%`,
                    left: `${separator.start}%`,
                    width: `${separator.length}%`
                  }
            return (
              <button
                key={`${separator.axis}-${index}`}
                type="button"
                className={`app-dock-separator app-dock-separator-${separator.axis}`}
                style={style}
                role="separator"
                aria-label={`Resize workspace ${index + 1}`}
                aria-orientation={separator.axis === 'x' ? 'vertical' : 'horizontal'}
                aria-valuemin={20}
                aria-valuemax={80}
                aria-valuenow={Math.round(separator.value)}
                onPointerDown={(event) => beginResize(event, separator)}
                onKeyDown={(event) => {
                  const delta =
                    event.key === 'Home'
                      ? -100
                      : event.key === 'End'
                        ? 100
                        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                          ? -2
                          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                            ? 2
                            : 0
                  if (!delta) return
                  event.preventDefault()
                  updateSize(
                    separator.index,
                    event.key === 'Home' ? 20 : event.key === 'End' ? 80 : separator.value + delta
                  )
                }}
              />
            )
          })}
      </div>
    </div>
  )
}

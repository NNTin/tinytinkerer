const STORAGE_KEY = 'tinytinkerer:host-layout:v1'
const DEFAULT_WIDTH = 400
const DEFAULT_HEIGHT = 680
const MIN_WIDTH = 320
const MIN_HEIGHT = 420
const MINIMIZED_SIZE = 64
const SAFE_MARGIN = 24

const widgetWindow = document.getElementById('widget-window')
const widgetFrame = document.getElementById('widget-frame')
const widgetGrip = document.getElementById('widget-grip')
const widgetResizeHandle = document.getElementById('widget-resize-handle')
const resetButton = document.getElementById('reset-widget-layout')
const webFrame = document.getElementById('web-frame')
const mobileFrame = document.getElementById('mobile-frame')

if (
  !(widgetWindow instanceof HTMLDivElement) ||
  !(widgetFrame instanceof HTMLIFrameElement) ||
  !(widgetGrip instanceof HTMLButtonElement) ||
  !(widgetResizeHandle instanceof HTMLButtonElement) ||
  !(resetButton instanceof HTMLButtonElement) ||
  !(webFrame instanceof HTMLIFrameElement) ||
  !(mobileFrame instanceof HTMLIFrameElement)
) {
  throw new Error('Expected the host compositor DOM to be available.')
}

const gripHeight = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--widget-grip-height')
) || 14

const createSurfaceUrl = (relativePath) => new URL(relativePath, window.location.href)

const configureStandaloneLinks = () => {
  for (const link of document.querySelectorAll('[data-standalone-link]')) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue
    }

    const app = link.dataset.standaloneLink
    if (!app) {
      continue
    }

    link.href = createSurfaceUrl(`./${app}/`).href
  }
}

webFrame.src = createSurfaceUrl('./web/').href
mobileFrame.src = createSurfaceUrl('./mobile/').href
configureStandaloneLinks()

const defaultLayout = () => {
  const x = Math.round((window.innerWidth - DEFAULT_WIDTH) / 2)
  const y = Math.round(window.innerHeight - DEFAULT_HEIGHT - gripHeight - 32)

  return clampLayout({
    x,
    y,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minimized: false
  })
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const getBox = (layout) => ({
  width: layout.minimized ? MINIMIZED_SIZE : layout.width,
  height: (layout.minimized ? MINIMIZED_SIZE : layout.height) + gripHeight
})

function clampLayout(layout) {
  const width = clamp(Math.round(layout.width), MIN_WIDTH, window.innerWidth - SAFE_MARGIN * 2)
  const height = clamp(
    Math.round(layout.height),
    MIN_HEIGHT,
    window.innerHeight - SAFE_MARGIN * 2 - gripHeight
  )

  const draft = {
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width,
    height,
    minimized: Boolean(layout.minimized)
  }

  const box = getBox(draft)

  return {
    ...draft,
    x: clamp(draft.x, SAFE_MARGIN, Math.max(SAFE_MARGIN, window.innerWidth - box.width - SAFE_MARGIN)),
    y: clamp(draft.y, SAFE_MARGIN, Math.max(SAFE_MARGIN, window.innerHeight - box.height - SAFE_MARGIN))
  }
}

const saveLayout = (layout) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
}

const loadLayout = () => {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    return defaultLayout()
  }

  try {
    const parsed = JSON.parse(stored)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return defaultLayout()
    }

    return clampLayout({
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      minimized: parsed.minimized === true
    })
  } catch {
    return defaultLayout()
  }
}

let layout = loadLayout()

const createWidgetSrc = (minimized) => {
  const url = createSurfaceUrl('./widget/')
  url.searchParams.set('view', 'host')

  if (minimized) {
    url.searchParams.set('mode', 'minimized')
  }

  return url.href
}

widgetFrame.src = createWidgetSrc(layout.minimized)

const applyLayout = () => {
  const box = getBox(layout)

  widgetWindow.dataset.minimized = String(layout.minimized)
  widgetWindow.style.left = `${layout.x}px`
  widgetWindow.style.top = `${layout.y}px`
  widgetWindow.style.width = `${box.width}px`
  widgetWindow.style.height = `${box.height}px`
}

const updateLayout = (nextLayout) => {
  layout = clampLayout(nextLayout)
  applyLayout()
  saveLayout(layout)
}

applyLayout()

widgetGrip.addEventListener('pointerdown', (event) => {
  const startLayout = { ...layout }
  const startX = event.clientX
  const startY = event.clientY

  widgetWindow.dataset.dragging = 'true'
  widgetGrip.setPointerCapture(event.pointerId)

  const handleMove = (moveEvent) => {
    const box = getBox(layout)
    const nextX = clamp(
      startLayout.x + (moveEvent.clientX - startX),
      SAFE_MARGIN,
      Math.max(SAFE_MARGIN, window.innerWidth - box.width - SAFE_MARGIN)
    )
    const nextY = clamp(
      startLayout.y + (moveEvent.clientY - startY),
      SAFE_MARGIN,
      Math.max(SAFE_MARGIN, window.innerHeight - box.height - SAFE_MARGIN)
    )

    layout = { ...layout, x: Math.round(nextX), y: Math.round(nextY) }
    applyLayout()
  }

  const handleEnd = () => {
    widgetWindow.dataset.dragging = 'false'
    widgetGrip.removeEventListener('pointermove', handleMove)
    widgetGrip.removeEventListener('pointerup', handleEnd)
    widgetGrip.removeEventListener('pointercancel', handleEnd)
    saveLayout(layout)
  }

  widgetGrip.addEventListener('pointermove', handleMove)
  widgetGrip.addEventListener('pointerup', handleEnd)
  widgetGrip.addEventListener('pointercancel', handleEnd)
})

widgetResizeHandle.addEventListener('pointerdown', (event) => {
  if (layout.minimized) {
    return
  }

  const startLayout = { ...layout }
  const startX = event.clientX
  const startY = event.clientY

  widgetResizeHandle.setPointerCapture(event.pointerId)

  const handleMove = (moveEvent) => {
    updateLayout({
      ...layout,
      x: startLayout.x,
      y: startLayout.y,
      width: startLayout.width + (moveEvent.clientX - startX),
      height: startLayout.height + (moveEvent.clientY - startY)
    })
  }

  const handleEnd = () => {
    widgetResizeHandle.removeEventListener('pointermove', handleMove)
    widgetResizeHandle.removeEventListener('pointerup', handleEnd)
    widgetResizeHandle.removeEventListener('pointercancel', handleEnd)
  }

  widgetResizeHandle.addEventListener('pointermove', handleMove)
  widgetResizeHandle.addEventListener('pointerup', handleEnd)
  widgetResizeHandle.addEventListener('pointercancel', handleEnd)
})

resetButton.addEventListener('click', () => {
  window.localStorage.removeItem(STORAGE_KEY)
  layout = defaultLayout()
  widgetFrame.src = createWidgetSrc(false)
  applyLayout()
  saveLayout(layout)
})

window.addEventListener('resize', () => {
  updateLayout(layout)
})

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) {
    return
  }

  const data = event.data
  if (
    !data ||
    typeof data !== 'object' ||
    data.type !== 'tinytinkerer.widget.state' ||
    (data.mode !== 'minimized' && data.mode !== 'expanded')
  ) {
    return
  }

  updateLayout({
    ...layout,
    minimized: data.mode === 'minimized'
  })
})

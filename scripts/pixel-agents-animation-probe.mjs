export const renderPixelAgentsAnimationProbe = () => `(() => {
  // This classic script runs before ANY upstream module code (same injection
  // seam as the bridge), so checking the flag HERE — rather than deferring to
  // a later hook — keeps production and normal dev usage a complete no-op: no
  // prototype patch, no window.__ttAnimationProbe global, zero runtime cost.
  // window.__PIXEL_AGENTS_E2E is set via Playwright's addInitScript before any
  // navigation, so it is already true by the time this script executes in e2e.
  if (window.__PIXEL_AGENTS_E2E !== true) return

  // Bounded so a long-running dev session (or a stuck e2e run) can never grow
  // this without limit; old records are overwritten in place (true ring
  // buffer), not shifted, so recording stays O(1) per draw call.
  const RING_SIZE = 20000
  const ring = new Array(RING_SIZE)
  let writeIndex = 0
  let ringCount = 0
  // Separate from ringCount: these must keep counting even after the ring
  // wraps, since the T2 liveness check polls them for "strictly increasing"
  // across the whole run, not just within one ring's worth of frames.
  let drawImageCallCount = 0
  let fillRectCallCount = 0

  const pushRecord = (record) => {
    ring[writeIndex] = record
    writeIndex = (writeIndex + 1) % RING_SIZE
    ringCount = Math.min(ringCount + 1, RING_SIZE)
  }

  // The sprite cache (webview-ui/src/office/sprites/spriteCache.ts) is a
  // WeakMap keyed per (state, direction, frame, palette, hueShift): the SAME
  // cached canvas object is reused across frames whenever the sprite is
  // unchanged, and a DIFFERENT object appears the instant the animation state
  // changes. Assigning each distinct source object a small stable integer id
  // turns "did the sprite change" into an equality check on this id, without
  // ever reading a pixel. One counter per kind of object (draw source vs.
  // destination canvas) so ids stay small and independently meaningful.
  const sourceIds = new WeakMap()
  let nextSourceId = 1
  const sourceIdFor = (image) => {
    let id = sourceIds.get(image)
    if (id === undefined) {
      id = nextSourceId
      nextSourceId += 1
      sourceIds.set(image, id)
    }
    return id
  }

  const canvasIds = new WeakMap()
  let nextCanvasId = 1
  const canvasIdFor = (canvas) => {
    let id = canvasIds.get(canvas)
    if (id === undefined) {
      id = nextCanvasId
      nextCanvasId += 1
      canvasIds.set(canvas, id)
    }
    return id
  }

  // Every draw source in this codebase is an HTMLCanvasElement (spriteCache's
  // getCachedSprite/getOutlineSprite), which has no naturalWidth/naturalHeight
  // — but falling back to width/height also covers HTMLImageElement/
  // ImageBitmap sources defensively, without importing anything.
  const sourceDimensions = (image) => ({
    w: image.naturalWidth ?? image.width,
    h: image.naturalHeight ?? image.height
  })

  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    try {
      const image = args[0]
      let sx = 0
      let sy = 0
      let sw
      let sh
      let dx
      let dy
      let dw
      let dh
      if (args.length <= 5) {
        // drawImage(image, dx, dy) or drawImage(image, dx, dy, dw, dh): there
        // is no explicit source rectangle, so the source IS the whole image —
        // its natural dimensions are sw/sh.
        const dims = sourceDimensions(image)
        sw = dims.w
        sh = dims.h
        dx = args[1]
        dy = args[2]
        dw = args.length === 5 ? args[3] : sw
        dh = args.length === 5 ? args[4] : sh
      } else {
        // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
        sx = args[1]
        sy = args[2]
        sw = args[3]
        sh = args[4]
        dx = args[5]
        dy = args[6]
        dw = args[7]
        dh = args[8]
      }
      drawImageCallCount += 1
      pushRecord({
        t: Date.now(),
        canvasId: canvasIdFor(this.canvas),
        sourceId: sourceIdFor(image),
        sx,
        sy,
        sw,
        sh,
        dx,
        dy,
        dw,
        dh
      })
    } catch {
      // A recording failure must never break the real draw call below.
    }
    return originalDrawImage.apply(this, args)
  }

  // Matrix spawn/despawn effects bypass drawImage entirely (per-pixel
  // fillRect — see webview-ui/src/office/engine/matrixEffect.ts), so they are
  // only countable in aggregate, not per-draw like drawImage above.
  const originalFillRect = CanvasRenderingContext2D.prototype.fillRect
  CanvasRenderingContext2D.prototype.fillRect = function (...args) {
    fillRectCallCount += 1
    return originalFillRect.apply(this, args)
  }

  window.__ttAnimationProbe = {
    drawLog: () =>
      ringCount < RING_SIZE
        ? ring.slice(0, ringCount)
        : ring.slice(writeIndex).concat(ring.slice(0, writeIndex)),
    totals: () => ({ drawImageCalls: drawImageCallCount, fillRectCalls: fillRectCallCount }),
    reset: () => {
      writeIndex = 0
      ringCount = 0
      drawImageCallCount = 0
      fillRectCallCount = 0
      // sourceIds/canvasIds are intentionally NOT cleared: a reset happens
      // mid-run (see selectPersistentAgent + resetAnimationProbe in
      // pixel-agents.e2e.ts), and sprite/canvas identity must stay comparable
      // across that boundary, or every post-reset id would spuriously look
      // "new" even for a sprite object that was already cached before reset.
    }
  }
})()
`

export const injectPixelAgentsAnimationProbe = (html) => {
  const moduleScript = /<script\s+type=["']module["']/
  if (!moduleScript.test(html)) {
    throw new Error('Pixel Agents webview index does not contain a module entry script')
  }
  return html.replace(
    moduleScript,
    '<script src="./tinytinkerer-animation-probe.js"></script>\n    <script type="module"'
  )
}

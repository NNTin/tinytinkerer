// Purely presentational easter-egg animation for the Konami cheat code (issue
// #399): visible chrome elements shake, fall off screen, then the SAME
// animations play in reverse — rising and un-shaking back into place — leaving
// no lasting DOM/state change. `runKonamiAnimation` resolves once every
// animation (forward + reverse) has finished.

const ANIMATION_DURATION_MS = 1400
const MAX_DELAY_MS = 300
const MAX_TARGETS = 40
const FALL_DISTANCE_VH = 110
const FALL_ROTATE_DEG = 35

// The e2e hook: konami.e2e.ts asserts this attribute appears while the
// animation runs and is gone once it completes. It is the ONLY thing this
// module persists on the DOM — everything else (the animated transforms) is
// restored automatically by the Web Animations API because every animation
// uses `fill: 'none'` (see animateElement below).
const KONAMI_DATA_ATTR = 'konami'

const isVisible = (element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return false
  }
  // Intersects the viewport (not merely non-zero size somewhere off-page).
  return (
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  )
}

const collectTargets = (): HTMLElement[] => {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], h1, h2, h3, input, textarea, img, a'
    )
  )
  return candidates.filter(isVisible).slice(0, MAX_TARGETS)
}

// 0%→60%: a short shake (small alternating translate/rotate wiggles). 60%→100%:
// fall off the bottom of the screen, easing 'ease-in' (set as the per-keyframe
// easing on the 60% keyframe, which the Web Animations API applies to the
// interval running FROM that keyframe TO the next one). `rotateSign` varies the
// fall's rotation direction per element so a whole row doesn't spin in lockstep.
const buildKeyframes = (rotateSign: 1 | -1): Keyframe[] => [
  { transform: 'translate(0px, 0) rotate(0deg)', offset: 0 },
  { transform: 'translate(-4px, 0) rotate(-2deg)', offset: 0.1 },
  { transform: 'translate(4px, 0) rotate(2deg)', offset: 0.2 },
  { transform: 'translate(-4px, 0) rotate(-2deg)', offset: 0.3 },
  { transform: 'translate(4px, 0) rotate(2deg)', offset: 0.4 },
  { transform: 'translate(-3px, 0) rotate(-1deg)', offset: 0.5 },
  { transform: 'translate(0px, 0) rotate(0deg)', offset: 0.6, easing: 'ease-in' },
  {
    transform: `translateY(${FALL_DISTANCE_VH}vh) rotate(${FALL_ROTATE_DEG * rotateSign}deg)`,
    offset: 1
  }
]

// Animates one element forward (shake+fall) then reverses it (rises and
// un-shakes back to its start). Only `transform` is touched — purely
// presentational, no layout mutation — and `fill: 'none'` means the browser
// restores the original computed style the instant the animation isn't
// running, so there is no cleanup step and nothing left behind in state.
//
// If the element unmounts mid-flight, `finished` REJECTS (the animation is
// cancelled). That must not take down the whole run — the whole point is that
// every OTHER element's animation still completes and reverses — so failures
// here are caught and swallowed rather than propagated.
const animateElement = (element: HTMLElement): Promise<void> => {
  const rotateSign: 1 | -1 = Math.random() < 0.5 ? -1 : 1
  const delay = Math.random() * MAX_DELAY_MS

  const animation = element.animate(buildKeyframes(rotateSign), {
    duration: ANIMATION_DURATION_MS,
    delay,
    easing: 'ease-in-out',
    fill: 'none'
  })

  return animation.finished
    .then(() => {
      animation.reverse()
      return animation.finished
    })
    .then(() => undefined)
    .catch(() => undefined)
}

const runFullAnimation = async (): Promise<void> => {
  const targets = collectTargets()
  await Promise.all(targets.map((element) => animateElement(element)))
}

// Reduced-motion fallback: a single subtle opacity pulse instead of the full
// shake-and-fall, respecting `prefers-reduced-motion`. Still marks the
// `data-konami` attribute for the duration (the e2e hook is the same either
// way) — only the visual is toned down.
const runReducedMotionFeedback = async (): Promise<void> => {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  const animation = root.animate([{ opacity: 1 }, { opacity: 0.85 }, { opacity: 1 }], {
    duration: 600,
    easing: 'ease-in-out'
  })
  await animation.finished.catch(() => undefined)
}

export const runKonamiAnimation = async (): Promise<void> => {
  document.documentElement.dataset[KONAMI_DATA_ATTR] = 'active'
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await runReducedMotionFeedback()
      return
    }
    await runFullAnimation()
  } finally {
    delete document.documentElement.dataset[KONAMI_DATA_ATTR]
  }
}

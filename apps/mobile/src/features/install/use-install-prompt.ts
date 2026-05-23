import { useEffect, useMemo, useState } from 'react'

type InstallPromptOutcome = {
  outcome: 'accepted' | 'dismissed'
  platform: string
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallPromptOutcome>
}

const isIosDevice = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

const isStandaloneDisplay = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      const nextEvent = event as BeforeInstallPromptEvent
      nextEvent.preventDefault()
      setDeferredPrompt(nextEvent)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  const canInstall = deferredPrompt !== null
  const showIosHint = useMemo(() => !canInstall && isIosDevice() && !isStandaloneDisplay(), [canInstall])

  const promptToInstall = async () => {
    if (!deferredPrompt) {
      return 'dismissed' as const
    }

    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return choice.outcome
  }

  return {
    canInstall,
    showIosHint,
    promptToInstall
  }
}

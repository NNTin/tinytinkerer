import type { ComponentType } from 'react'
import type { ChatMode } from '@tinytinkerer/app-browser'
import {
  MobileBootScreen,
  MobileChatLoading,
  MobilePanelLoading,
  MobileRouteLoading,
  WebBootScreen,
  WebChatLoading,
  WebPanelLoading,
  WebRouteLoading,
  WidgetBootScreen,
  WidgetChatLoading,
  WidgetRouteLoading
} from './app/loading-screens'

export type PresentationId = 'web' | 'widget' | 'mobile'

// One descriptor per URL endpoint. This is the ONLY place the three presentations
// diverge: the shared ChatApp props they select, their loading chrome, and whether
// they own the service worker. Everything else (chat, auth, settings, morph) is the
// one shared surface in @tinytinkerer/app-browser. Keep divergence in this table —
// not as `if (id === 'mobile')` branches scattered through the shell.
export type ShellPresentation = {
  id: PresentationId
  // Only the mobile presentation registers the PWA service worker (its scope is the
  // serving path, /mobile/, so /web and /widget must not register it — see
  // createBrowserShellRoot's registerServiceWorker gate).
  registersServiceWorker: boolean
  BootScreen: ComponentType<{ error?: string }>
  RouteLoading: ComponentType
  ChatLoading: ComponentType<{ error?: string }>
  // Settings Suspense fallback; web + mobile supply one, the widget does not.
  PanelLoading?: ComponentType
  // Shared ChatApp configuration.
  mode: ChatMode
  // Absent means the ChatApp default (true → dock/undock morph offered).
  morphable?: boolean
  sizeVariant?: 'comfortable' | 'mobile'
  storageKey: string
  // Developer context-inspector toggle + viewer button (web + widget).
  supportsInspector: boolean
  // PWA install banner slot (mobile).
  supportsInstall: boolean
}

const WEB: ShellPresentation = {
  id: 'web',
  registersServiceWorker: false,
  BootScreen: WebBootScreen,
  RouteLoading: WebRouteLoading,
  ChatLoading: WebChatLoading,
  PanelLoading: WebPanelLoading,
  mode: 'sidebar',
  morphable: false,
  sizeVariant: 'comfortable',
  storageKey: 'tinytinkerer:web-layout:v1',
  supportsInspector: true,
  supportsInstall: false
}

const WIDGET: ShellPresentation = {
  id: 'widget',
  registersServiceWorker: false,
  BootScreen: WidgetBootScreen,
  RouteLoading: WidgetRouteLoading,
  ChatLoading: WidgetChatLoading,
  mode: 'floating',
  storageKey: 'tinytinkerer:widget-layout:v1',
  supportsInspector: true,
  supportsInstall: false
}

const MOBILE: ShellPresentation = {
  id: 'mobile',
  registersServiceWorker: true,
  BootScreen: MobileBootScreen,
  RouteLoading: MobileRouteLoading,
  ChatLoading: MobileChatLoading,
  PanelLoading: MobilePanelLoading,
  mode: 'sidebar',
  morphable: false,
  sizeVariant: 'mobile',
  storageKey: 'tinytinkerer:mobile-layout:v1',
  supportsInspector: false,
  supportsInstall: true
}

const PRESENTATIONS: Record<PresentationId, ShellPresentation> = {
  web: WEB,
  widget: WIDGET,
  mobile: MOBILE
}

// Which endpoint served this bundle. The host mounts the same build at /web/,
// /widget/, and /mobile/ (optionally under a TINYTINKERER_DEPLOY_BASE sub-path), so
// match on the path SEGMENTS rather than a prefix. Anything else (including the root
// composition, which never loads this bundle) falls back to web.
export const resolvePresentationId = (pathname: string): PresentationId => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.includes('mobile')) {
    return 'mobile'
  }
  if (segments.includes('widget')) {
    return 'widget'
  }
  return 'web'
}

export const resolvePresentation = (pathname: string): ShellPresentation =>
  PRESENTATIONS[resolvePresentationId(pathname)]

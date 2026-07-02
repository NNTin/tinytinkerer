export type WidgetWindowMode = 'expanded' | 'minimized'

// The widget presentation opens minimized when the embedding page requests it via
// `?mode=minimized`. This is the widget window state, not shell selection (that comes
// from the URL path — see resolvePresentation).
export const resolveWidgetWindowMode = (search: string): WidgetWindowMode =>
  new URLSearchParams(search).get('mode') === 'minimized' ? 'minimized' : 'expanded'

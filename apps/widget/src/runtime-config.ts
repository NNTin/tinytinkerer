export type WidgetViewMode = 'host' | 'standalone'
export type WidgetWindowMode = 'expanded' | 'minimized'

export const resolveWidgetViewMode = (search: string): WidgetViewMode =>
  new URLSearchParams(search).get('view') === 'host' ? 'host' : 'standalone'

export const resolveWidgetWindowMode = (search: string): WidgetWindowMode =>
  new URLSearchParams(search).get('mode') === 'minimized' ? 'minimized' : 'expanded'

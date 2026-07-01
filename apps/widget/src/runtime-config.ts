export type WidgetWindowMode = 'expanded' | 'minimized'

export const resolveWidgetWindowMode = (search: string): WidgetWindowMode =>
  new URLSearchParams(search).get('mode') === 'minimized' ? 'minimized' : 'expanded'

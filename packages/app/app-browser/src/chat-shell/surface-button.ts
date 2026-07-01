// Local replacement for ui's <Button> (app-browser cannot depend on @tinytinkerer/ui;
// see the boundary check + turn-chrome's local-primitive precedent). Mirrors the
// small-size button variants the chat surfaces use; callers pass `extra` to size
// icon-only buttons without class conflicts (we deliberately avoid tailwind-merge).
export const surfaceButtonClass = (variant: 'default' | 'secondary', extra = 'h-9 px-3'): string =>
  [
    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:pointer-events-none disabled:opacity-50',
    variant === 'secondary'
      ? 'bg-stone-800 text-stone-100 hover:bg-stone-700'
      : 'bg-amber-600 text-amber-50 hover:bg-amber-700',
    extra
  ].join(' ')

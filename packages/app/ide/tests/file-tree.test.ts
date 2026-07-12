import { describe, expect, it } from 'vitest'
import { buildIdeFileTree } from '../src/file-tree'

describe('IDE file tree', () => {
  it('creates nested directories and keeps their files together', () => {
    expect(
      buildIdeFileTree(['/src/App.tsx', '/src/components/Button.tsx', '/public/index.html'])
    ).toEqual([
      {
        kind: 'directory',
        name: 'public',
        path: '/public',
        children: [{ kind: 'file', name: 'index.html', path: '/public/index.html' }]
      },
      {
        kind: 'directory',
        name: 'src',
        path: '/src',
        children: [
          {
            kind: 'directory',
            name: 'components',
            path: '/src/components',
            children: [{ kind: 'file', name: 'Button.tsx', path: '/src/components/Button.tsx' }]
          },
          { kind: 'file', name: 'App.tsx', path: '/src/App.tsx' }
        ]
      }
    ])
  })

  it('sorts directories before files and ignores duplicate paths', () => {
    expect(buildIdeFileTree(['/z.ts', '/a/file.ts', '/b.ts', '/a/file.ts'])).toEqual([
      {
        kind: 'directory',
        name: 'a',
        path: '/a',
        children: [{ kind: 'file', name: 'file.ts', path: '/a/file.ts' }]
      },
      { kind: 'file', name: 'b.ts', path: '/b.ts' },
      { kind: 'file', name: 'z.ts', path: '/z.ts' }
    ])
  })
})

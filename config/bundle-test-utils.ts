/**
 * Run an in-process Vite build with the same React transform used by a production
 * CLI build. Vite's `mode: 'production'` does not replace Vitest's NODE_ENV=test,
 * which otherwise leaves jsxDEV metadata (including absolute checkout paths) in
 * measured chunks and makes bundle guards differ between local and CI worktrees.
 */
export const withProductionNodeEnv = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previousNodeEnv = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'production'
    return await operation()
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
}

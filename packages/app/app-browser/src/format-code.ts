// Display-only pretty-printer for a tool's JavaScript `code` argument. This is
// used purely to make the source readable in the permission prompt; the value
// the runtime actually executes is never touched (the caller formats a copy).
//
// prettier + its babel/estree plugins are a sizeable bundle, so they are loaded
// lazily on first use — only when a run_javascript permission prompt is actually
// shown — instead of being pulled into the main app bundle.
//
// Returns the formatted source. Throws if the input is not valid JavaScript or
// prettier otherwise fails — the caller is responsible for falling back to the
// raw source so a formatting failure can never block the permission prompt.
export const formatJavaScriptForDisplay = async (code: string): Promise<string> => {
  const [prettier, babelPlugin, estreePlugin] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    // The estree printer plugin is required alongside the babel *parser* — babel
    // produces an ESTree-shaped AST that this plugin knows how to print.
    import('prettier/plugins/estree')
  ])
  const formatted = await prettier.format(code, {
    parser: 'babel',
    plugins: [babelPlugin, estreePlugin],
    // Match the repo's own prettier.config.mjs so the displayed code reads like
    // the rest of the codebase.
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    printWidth: 100
  })
  // prettier always appends a trailing newline; drop it so the view has no empty
  // final line.
  return formatted.replace(/\n$/, '')
}

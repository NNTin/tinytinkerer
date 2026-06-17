// Prettier configuration for the monorepo.
//
// These options reproduce the repo's pre-existing, hand-written code style so
// that turning on enforcement causes the smallest possible normalization diff —
// they are NOT a new style being imposed:
//   - singleQuote / semi:false / 2-space indent are the de-facto style across
//     apps/, packages/ and scripts/.
//   - trailingComma:'none' matches the existing code (adding trailing commas
//     would have reformatted ~240 files instead of ~177).
//   - printWidth:100 matches the most carefully maintained sources (e.g.
//     packages/shared/contracts/src/content.ts is already clean at 100, and 100
//     produced the smallest reformat across the tree).
//
// ESLint owns code-quality rules; Prettier owns formatting. eslint-config-prettier
// is wired in as the last entry of eslint.config.mjs so the two never fight.
//
// Generated and vendored files are excluded via .prettierignore.
export default {
  singleQuote: true,
  semi: false,
  trailingComma: 'none',
  printWidth: 100
}

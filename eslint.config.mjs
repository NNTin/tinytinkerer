import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Use fetchWithTelemetry from @tinytinkerer/sentry-telemetry (re-exported by @tinytinkerer/app-browser) instead of the global fetch() so 4xx/5xx and network failures are captured for debugging. If a raw fetch is genuinely required (e.g. the wrapper itself or a low-level shim), add an inline eslint-disable-next-line no-restricted-globals with a short justification.'
        }
      ],
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            AssistantContentDocument: {
              message: 'Use ContentDocument from @tinytinkerer/contracts.'
            },
            AssistantBlockNode: { message: 'Use BlockNode from @tinytinkerer/contracts.' },
            AssistantInlineNode: { message: 'Use InlineNode from @tinytinkerer/contracts.' },
            AssistantListItemNode: { message: 'Use ListItemNode from @tinytinkerer/contracts.' },
            AssistantTableCell: { message: 'Use TableCell from @tinytinkerer/contracts.' },
            AssistantTableAlignment: { message: 'Use TableAlignment from @tinytinkerer/contracts.' }
          }
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'TSPropertySignature[optional=true] > TSTypeAnnotation > TSUnionType > TSUndefinedKeyword',
          message:
            'Optional properties already accept missing values under exactOptionalPropertyTypes. Drop `| undefined`. See docs/ARCHITECTURE.md#coding-conventions.'
        },
        {
          selector: 'TSPropertySignature[optional=true] > TSTypeAnnotation > TSUndefinedKeyword',
          message:
            'Optional properties already accept missing values under exactOptionalPropertyTypes. Drop the explicit `undefined` type. See docs/ARCHITECTURE.md#coding-conventions.'
        }
      ]
    }
  },
  {
    // Model decision/planner paths turn an LLM's free-form `content` string into
    // structured data. A raw `JSON.parse` there is brittle: it crashes on the
    // prose-wrapped / single-quoted / trailing-comma output models routinely emit,
    // and (worse) it bypasses the parse_error/schema_error telemetry. Force these
    // files through the shared robust helper (issue #139). This mirrors the
    // fetchWithTelemetry-over-fetch rule above; envelope / tool-result / storage
    // parsers stay on strict JSON.parse and are intentionally NOT in scope.
    files: ['**/runtime/*-planner.ts', '**/runtime/*-decider.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'JSON',
          property: 'parse',
          message:
            'Do not raw-JSON.parse model output. Use parseModelJsonWithTelemetry from @tinytinkerer/sentry-telemetry (re-exported by @tinytinkerer/app-browser): it strips ```json fences, parses robustly (sloppy-but-complete output, never repairing truncation), validates the schema, and captures parse_error/schema_error.'
        }
      ]
    }
  },
  {
    // Tests legitimately exercise real or local servers (and stub/mock the
    // global fetch), so the fetchWithTelemetry restriction does not apply here.
    files: ['**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '**/tests/**'],
    rules: {
      'no-restricted-globals': 'off'
    }
  },
  // Must be LAST: turns off any ESLint rules that would conflict with Prettier
  // so the two never fight. ESLint owns code-quality rules; Prettier owns
  // formatting. See docs/ARCHITECTURE.md#enforcement.
  prettier
)

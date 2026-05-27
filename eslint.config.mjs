import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

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
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            AssistantContentDocument: { message: 'Use ContentDocument from @tinytinkerer/contracts.' },
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
          selector:
            'TSPropertySignature[optional=true] > TSTypeAnnotation > TSUndefinedKeyword',
          message:
            'Optional properties already accept missing values under exactOptionalPropertyTypes. Drop the explicit `undefined` type. See docs/ARCHITECTURE.md#coding-conventions.'
        }
      ]
    }
  }
)

import js from '@eslint/js'
import pluginN from 'eslint-plugin-n'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  { ignores: ['node_modules/'] },
  {
    files: ['**/*.js'],
    extends: [
      js.configs.recommended,
      pluginN.configs['flat/recommended'],
    ],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|next' }],
      'no-console': 'off',
      'n/no-process-exit': 'warn',
      'n/no-unpublished-import': 'off',
    },
  },
])

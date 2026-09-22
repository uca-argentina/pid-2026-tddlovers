import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Vitest corre con `globals: true` (ver vite.config.js), así que en los
    // tests describe/it/expect/vi existen sin importarlos.
    files: ['**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: globals.vitest,
    },
  },
  {
    // vite.config.js lo ejecuta Node, no el browser: ahí `process` existe
    // (lo usa VITE_BACKEND_URL para apuntar el proxy al servicio de compose).
    files: ['vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])

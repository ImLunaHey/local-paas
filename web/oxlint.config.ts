import { defineConfig } from 'oxlint'
import { RECOMMENDED_RULES, TANSTACK_QUERY_RULES } from 'oxlint-plugin-react-doctor'

export default defineConfig({
  plugins: ['typescript', 'react', 'jsx-a11y'],
  categories: {
    correctness: 'error',
  },
  rules: {
    ...RECOMMENDED_RULES,
    ...TANSTACK_QUERY_RULES,
    // This is a client-only Vite application: no server HTML is hydrated.
    'react-doctor/no-locale-format-in-render': 'off',
    'react-doctor/rendering-hydration-mismatch-time': 'off',
    // Native controls and our primitives are not memoized. Allocating an event
    // handler/prop object does not invalidate a memo boundary here. Query and
    // Table data stability are checked by the dedicated rules below.
    'react-doctor/jsx-no-new-function-as-prop': 'off',
    'react-doctor/jsx-no-new-object-as-prop': 'off',
    'react-doctor/jsx-no-new-array-as-prop': 'off',
    'repository/no-handwritten-barrels': 'error',
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/click-events-have-key-events': 'error',
    'jsx-a11y/heading-has-content': 'error',
    'jsx-a11y/html-has-lang': 'error',
    'jsx-a11y/iframe-has-title': 'error',
    'jsx-a11y/label-has-associated-control': [
      'error',
      {
        controlComponents: ['Input', 'Select', 'Textarea'],
        depth: 5,
      },
    ],
    'jsx-a11y/no-autofocus': 'error',
    'jsx-a11y/no-noninteractive-tabindex': 'error',
    'jsx-a11y/no-static-element-interactions': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/tabindex-no-positive': 'error',
    'jsx-a11y/prefer-tag-over-role': 'off',
    'react/set-state-in-effect': 'off',
    'react/purity': 'off',
    'jsx-a11y/control-has-associated-label': [
      'error',
      {
        ignoreElements: ['td', 'th', 'tr'],
      },
    ],
    'one-var': ['error', 'never'],
  },
  ignorePatterns: ['src/generated/**'],
  overrides: [
    {
      files: ['src/main.tsx'],
      // The application entry point mounts React and registers routes; it is not
      // an importable component module or a Fast Refresh boundary.
      rules: { 'react-doctor/only-export-components': 'off' },
    },
  ],
  jsPlugins: [
    { name: 'repository', specifier: './tooling/repository-rules.mjs' },
    {
      name: 'react-doctor',
      specifier: 'oxlint-plugin-react-doctor',
    },
  ],
})

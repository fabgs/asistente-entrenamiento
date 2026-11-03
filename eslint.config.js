// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The design system (PLAN.md §12): every text, size and colour comes from theme.ts and ui.tsx.
const DESIGN_SYSTEM = [
  {
    selector: "Property[key.name=/^(fontSize|fontWeight|lineHeight)$/][value.type='Literal']",
    message: 'Usa la escala tipográfica: type.* de theme.ts o una variante de AppText.',
  },
  {
    selector: 'Literal[value=/^(#[0-9A-Fa-f]{3,8}|rgba?\\()/]',
    message: 'Usa un color de colors en theme.ts.',
  },
  {
    selector: "JSXAttribute[name.name='kind'][value.value='ghost']",
    message: 'No hay enlaces azules: usa kind="text".',
  },
  {
    selector: 'JSXText[value=/[↑↓→←✓]/], Literal[value=/[↑↓→←✓]/]',
    message: 'Usa un Icon en lugar de una flecha o un check escritos.',
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*'],
  },
  {
    // TypeScript already checks imported names; this rule misreads enums re-exported by Expo packages.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'import/namespace': 'off' },
  },
  {
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...DESIGN_SYSTEM],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'react-native', importNames: ['Text'], message: 'Usa AppText o Value de ui.tsx.' }] },
      ],
    },
  },
  {
    // Where the text primitives are built: the components themselves, the share image (sizes in
    // pixels of the image) and the map attribution.
    files: ['src/components/ui.tsx', 'src/components/ShareCard.tsx', 'src/components/RouteMap.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);

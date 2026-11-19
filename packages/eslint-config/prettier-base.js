import organizeImportsPlugin from 'prettier-plugin-organize-imports';

// prettier-plugin-tailwindcss는 플러그인의 `.name`으로 organize-imports가 켜져 있는지 판단한다.
// 그냥 import한 객체에는 `.name`이 없어서, tailwindcss가 이 플러그인과 연결하지 않고 파서 훅을 덮어쓴다.
// 이름을 직접 붙여 둘이 함께 동작하게 한다.
const organizeImports = { ...organizeImportsPlugin, name: 'prettier-plugin-organize-imports' };

/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'auto',
  plugins: [organizeImports],
};

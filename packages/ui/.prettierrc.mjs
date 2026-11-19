import base from '@simai/eslint-config/prettier-base';
import * as tailwind from 'prettier-plugin-tailwindcss';

// 플러그인은 문자열로 적으면 prettier 를 실행한 폴더 기준으로 찾으므로 직접 import 한다.
/** @type {import("prettier").Config} */
export default {
  ...base,
  plugins: [...base.plugins, tailwind],
  tailwindStylesheet: './src/styles/globals.css',
  tailwindFunctions: ['cn', 'cva'],
};

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { devProxy } from './src/lib/devProxy.ts';
import { parseEnv } from './src/lib/parseEnv.ts';

// 빌드할 때 환경변수를 검사한다. 틀린 값으로 만든 빌드는 배포한 뒤에야 빈 화면으로 드러난다.
// 화면을 그리기 전 검사(src/lib/env.ts)와 같은 값(config.env)·같은 기준(isProduction = import.meta.env.PROD)을 쓴다.
const checkEnv = (): Plugin => ({
  name: 'simai-check-env',
  apply: 'build',
  configResolved(config) {
    parseEnv(config.env, { production: config.isProduction });
  },
});

export default defineConfig(({ command, mode, isPreview }) => ({
  plugins: [
    checkEnv(),
    tailwindcss(),
    // react() 보다 앞에 둔다. 라우트 파일을 먼저 변환해야 코드 분할이 된다.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // 개발 서버에 msw 워커를 띄운다. main.tsx 가 DEV 에서만 virtual:msw 를 불러서 빌드에는 들어가지 않는다.
    msw(),
  ],
  resolve: {
    // @ 경로는 tsconfig.json 의 paths 하나에서만 정한다.
    tsconfigPaths: true,
  },
  // 개발 서버·preview 가 /api 를 실서버로 넘긴다(src/lib/devProxy.ts). preview 는 server.proxy 를 물려받는다.
  server:
    command === 'serve'
      ? { proxy: devProxy(loadEnv(mode, import.meta.dirname, ''), { preview: isPreview }) }
      : undefined,
}));

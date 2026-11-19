import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// vite.config.ts 를 가져오지 않는다. 라우터 플러그인이 실행될 때마다 routeTree.gen.ts 를 다시 쓴다.
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    globals: false,
  },
});

import type { ProxyOptions } from 'vite';
import { z } from 'zod';
import { parseEnv } from './parseEnv.ts';

// vite.config.ts 가 상대 경로로 불러서 @ 경로를 쓰지 않는다(parseEnv 와 같다).

const DEFAULT_PROXY_TARGET = 'http://localhost:8080';

const targetSchema = z.url({ protocol: /^https?$/ });

/**
 * 개발 서버(vite dev·preview)가 실서버로 넘길 경로. 화면과 같은 출처로 불러 갱신 쿠키(SameSite=Strict)가 실리고
 * 서버 CORS 설정이 필요 없다.
 * - 개발 서버: mock 을 켜면 VITE_API_REAL 경로만, 끄면 /api 전체를 넘긴다. 모두 mock 이면 넘기지 않는다
 *   (msw 가 HMR 로 잠깐 꺼진 사이 새는 요청이 실서버 401 을 받아 로그아웃되지 않게).
 * - preview: 운영 빌드라 mock 이 없으므로 /api 전체를 넘긴다.
 * 대상(API_PROXY_TARGET)은 VITE_ 가 아니라 브라우저 번들에 들어가지 않는다.
 */
export function devProxy(
  raw: Record<string, string | undefined>,
  { preview = false } = {},
): Record<string, ProxyOptions> {
  const env = parseEnv(raw);
  const target = targetSchema.safeParse(raw.API_PROXY_TARGET || DEFAULT_PROXY_TARGET);
  if (!target.success) {
    throw new Error(`API_PROXY_TARGET: http(s) 주소여야 한다(받은 값: ${raw.API_PROXY_TARGET})`);
  }
  const origin = new URL(target.data).origin;
  const paths = env.VITE_API_MOCK && !preview ? env.VITE_API_REAL : ['/api'];
  const options: ProxyOptions = {
    target: target.data,
    changeOrigin: true,
    // 브라우저 출처(localhost)를 대상 서버의 출처로 바꾼다. 서버가 같은 출처 요청으로 받아 CORS 목록과 상관없이 통과하고,
    // 서버가 나중에 Origin 을 검사해도 깨지지 않는다.
    // 경로는 바꾸지 않는다. 갱신 쿠키의 Path(/api/auth)와 브라우저 경로가 같아야 쿠키가 실린다.
    configure: (proxy) =>
      proxy.on('proxyReq', (request) => {
        if (request.getHeader('origin')) request.setHeader('origin', origin);
      }),
  };
  return Object.fromEntries(paths.map((path) => [path, options]));
}

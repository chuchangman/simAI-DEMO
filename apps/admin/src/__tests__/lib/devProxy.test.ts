import { devProxy } from '@/lib/devProxy';
import type { ProxyOptions } from 'vite';
import { describe, expect, it, vi } from 'vitest';

const env = {
  VITE_API_BASE_URL: '',
  VITE_STOMP_URL: 'ws://localhost:8080/ws',
};

describe('devProxy', () => {
  it('mock 을 끄면 /api 전체, 켜면 VITE_API_REAL 경로만(비우면 없음) 넘긴다', () => {
    expect(Object.keys(devProxy({ ...env, VITE_API_MOCK: 'false' }))).toEqual(['/api']);
    expect(
      Object.keys(
        devProxy({ ...env, VITE_API_MOCK: 'true', VITE_API_REAL: '/api/auth,/api/events' }),
      ),
    ).toEqual(['/api/auth', '/api/events']);
    expect(devProxy({ ...env, VITE_API_MOCK: 'true' })).toEqual({});
  });

  it('preview 는 mock 이 없으므로 /api 전체를 넘긴다', () => {
    expect(Object.keys(devProxy({ ...env, VITE_API_MOCK: 'true' }, { preview: true }))).toEqual([
      '/api',
    ]);
  });

  it('대상은 API_PROXY_TARGET(없으면 로컬 서버)이고 http(s) 주소만 받는다', () => {
    const local = devProxy({ ...env, VITE_API_MOCK: 'false' })['/api'];
    expect(local).toMatchObject({ target: 'http://localhost:8080', changeOrigin: true });
    const remote = devProxy({
      ...env,
      VITE_API_MOCK: 'false',
      API_PROXY_TARGET: 'https://simai.live',
    });
    expect(remote['/api']?.target).toBe('https://simai.live');
    for (const target of ['simai.live', 'ftp://simai.live']) {
      expect(() => devProxy({ ...env, VITE_API_MOCK: 'false', API_PROXY_TARGET: target })).toThrow(
        /API_PROXY_TARGET/,
      );
    }
  });

  it('브라우저 Origin 을 대상 서버의 출처로 바꾸고, 없으면 붙이지 않는다', () => {
    const options = devProxy({
      ...env,
      VITE_API_MOCK: 'false',
      API_PROXY_TARGET: 'https://simai.live/',
    })['/api'] as ProxyOptions;
    let onProxyReq: ((request: unknown) => void) | undefined;
    options.configure?.(
      {
        on: (event: string, listener: (request: unknown) => void) => {
          if (event === 'proxyReq') onProxyReq = listener;
        },
      } as never,
      options,
    );
    const withOrigin = { getHeader: () => 'http://localhost:5173', setHeader: vi.fn() };
    onProxyReq?.(withOrigin);
    expect(withOrigin.setHeader).toHaveBeenCalledExactlyOnceWith('origin', 'https://simai.live');
    const withoutOrigin = { getHeader: () => undefined, setHeader: vi.fn() };
    onProxyReq?.(withoutOrigin);
    expect(withoutOrigin.setHeader).not.toHaveBeenCalled();
  });

  it('환경변수가 틀리면 개발 서버를 띄우지 않는다', () => {
    expect(() => devProxy({ ...env, VITE_API_MOCK: 'true', VITE_API_REAL: 'api/auth' })).toThrow(
      /VITE_API_REAL/,
    );
  });
});

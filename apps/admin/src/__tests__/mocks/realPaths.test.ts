import { withoutRealPaths } from '@/mocks/realPaths';
import { http, HttpResponse } from 'msw/http';
import { describe, expect, it } from 'vitest';

const paths = (list: { info: { path?: unknown } }[]) => list.map((h) => h.info.path);
const ok = () => HttpResponse.json({});

describe('withoutRealPaths', () => {
  const list = [
    http.post('*/api/auth/login', ok),
    http.post('*/api/auth/refresh', ok),
    http.get('*/api/authority', ok),
    http.post('*/api/events/:id/ack', ok),
    http.get('*/api/events', ok),
    http.get('*/api/zones', ok),
  ];

  it('실서버 경로 아래의 mock 만 빼고 나머지는 그대로 둔다', () => {
    expect(paths(withoutRealPaths(list, ['/api/auth']))).toEqual([
      '*/api/authority',
      '*/api/events/:id/ack',
      '*/api/events',
      '*/api/zones',
    ]);
    expect(paths(withoutRealPaths(list, ['/api/auth', '/api/events']))).toEqual([
      '*/api/authority',
      '*/api/zones',
    ]);
    expect(paths(withoutRealPaths(list, []))).toEqual(paths(list));
  });

  it('경로 조각 단위로 맞춘다(/api/auth 는 /api/authority 를 빼지 않는다)', () => {
    expect(paths(withoutRealPaths(list, ['/api/auth']))).toContain('*/api/authority');
  });

  it('문자열이 아닌 경로(RegExp·함수)는 맞출 수 없어 그대로 둔다', () => {
    const regex = http.post(/\/api\/auth\/login$/, ok);
    expect(withoutRealPaths([regex], ['/api/auth'])).toEqual([regex]);
  });
});

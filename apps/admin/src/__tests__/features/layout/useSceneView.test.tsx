import { requestSceneView } from '@/features/layout/api';
import { useSceneOrCurrent } from '@/features/layout/useSceneView';
import type { ViewerSceneStatus } from '@/features/viewer3d';
import { ApiError, createHttp } from '@/lib/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

// 버전을 지정한 Scene 보기(GET /api/scenes/{scene_version}/view, -613). 본문은 뷰어가 해석한다.
const VIEW = { scene_version: 'scene-preview-1', state: 'CANDIDATE', current: false };
const CURRENT = { scene_version: 'scene-demo', state: 'DEFAULT' };
const NOT_FOUND = new ApiError(404, { code: 'SCENE_VERSION_NOT_FOUND' });
const EXPIRED: ViewerSceneStatus = {
  phase: 'EXPIRED',
  sceneVersion: 'scene-preview-1',
  state: 'CANDIDATE',
  calibrationVersion: 'cal-1',
  verification: 'UNCONFIRMED',
  display: 'HIDDEN',
  mismatches: [],
  needsRefetch: true,
  reason: 'HTTP 403',
  boundsWorld: null,
  axisConvention: 'GLTF_Y_UP_ASSUMED',
};

const clients: QueryClient[] = [];
function run<T>(hook: (version: string | null) => T, initial: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ version }) => hook(version), {
    wrapper,
    initialProps: { version: initial },
  });
}
const requestedPaths = () => api.mock.calls.map(([path]) => path);
const advance = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  api
    .mockReset()
    .mockImplementation(async (path: string) => (path.endsWith('/view') ? VIEW : CURRENT));
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('버전을 지정한 Scene 조회', () => {
  it('인증된 HTTP 경로로 GET /api/scenes/{scene_version}/view 를 부르고 버전을 인코딩한다', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(VIEW), { headers: { 'Content-Type': 'application/json' } }),
      );
    const http = createHttp({ baseUrl: 'http://api.test', getToken: () => 'scene-token' });
    expect(await requestSceneView(http, 'scene-preview-1')).toEqual(VIEW);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/scenes/scene-preview-1/view');
    expect(options?.method).toBe('GET');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer scene-token');

    await requestSceneView(http, 'a/b');
    expect(fetch.mock.calls[1]![0]).toBe('http://api.test/api/scenes/a%2Fb/view');
  });

  it('받은 본문(CANDIDATE 포함)을 가공하지 않고 안정된 입력으로 감싼다', async () => {
    const { result, rerender } = run(useSceneOrCurrent, 'scene-preview-1');
    expect(result.current.scene).toBeNull();
    await advance();
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
    expect(requestedPaths()).toEqual(['/api/scenes/scene-preview-1/view']);
    const scene = result.current.scene;
    const callback = result.current.onSceneStatusChange;
    rerender({ version: 'scene-preview-1' });
    expect(result.current.scene).toBe(scene);
    expect(result.current.onSceneStatusChange).toBe(callback);
  });

  it('404 는 뷰어에 "받지 못했다"로 넘기고, 10초마다 다시 받아 보이면 회복한다', async () => {
    api.mockRejectedValueOnce(NOT_FOUND);
    const { result } = run(useSceneOrCurrent, 'scene-preview-1');
    await advance();
    expect(result.current.scene).toEqual({
      ok: false,
      reason: 'SCENE_VERSION_NOT_FOUND',
      httpStatus: 404,
    });
    expect(api).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
    await advance(30_000);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['401', new ApiError(401)],
    ['403', new ApiError(403)],
    ['5xx', new ApiError(503)],
    ['망 끊김', new ApiError(0)],
  ])('%s 실패는 입력을 넘기지 않고 10초 뒤 회복한다', async (_, error) => {
    api.mockRejectedValueOnce(error);
    const { result } = run(useSceneOrCurrent, 'scene-preview-1');
    await advance();
    expect(result.current.scene).toBeNull();
    await advance(10_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
  });

  it('서명 만료 신호에 즉시 다시 받아 새 서명 주소를 넘긴다', async () => {
    const { result } = run(useSceneOrCurrent, 'scene-preview-1');
    await advance();
    const renewed = { ...VIEW, gltf_url: '/scene.glb?signature=renewed' };
    api.mockResolvedValue(renewed);
    act(() => result.current.onSceneStatusChange(EXPIRED));
    await advance();
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.scene).toEqual({ ok: true, raw: renewed });
  });
});

describe('호스트가 그릴 Scene', () => {
  it('버전이 없으면 현재 Scene(/api/scenes/current)을 받는다', async () => {
    const { result } = run(useSceneOrCurrent, null);
    await advance();
    expect(requestedPaths()).toEqual(['/api/scenes/current']);
    expect(result.current.scene).toEqual({ ok: true, raw: CURRENT });
  });

  it('버전을 주면 그 버전(/view)만 받는다', async () => {
    const { result } = run(useSceneOrCurrent, 'scene-setup-1');
    await advance();
    expect(requestedPaths()).toEqual(['/api/scenes/scene-setup-1/view']);
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
  });

  it('받을 버전이 바뀌면 새 본문이 올 때까지 이전 배경을 두고, 오면 교체한다', async () => {
    const { result, rerender } = run(useSceneOrCurrent, 'scene-preview-1');
    await advance();
    const final = { ...VIEW, scene_version: 'scene-setup-1' };
    api.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(final), 500)));
    rerender({ version: 'scene-setup-1' });
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
    await advance(499);
    expect(result.current.scene).toEqual({ ok: true, raw: VIEW });
    await advance(1);
    await advance();
    expect(result.current.scene).toEqual({ ok: true, raw: final });
    expect(requestedPaths()).toEqual([
      '/api/scenes/scene-preview-1/view',
      '/api/scenes/scene-setup-1/view',
    ]);
  });
});

import { requestCurrentScene } from '@/features/layout/api';
import { useCurrentScene } from '@/features/layout/useCurrentScene';
import type { ViewerSceneStatus } from '@/features/viewer3d';
import { ApiError, createHttp } from '@/lib/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

// 앱은 이 본문을 해석하지 않는다. 추가 필드·형식 오류·null 도 뷰어가 판단한다.
const RAW = { scene_version: 'scene-1', extra: { untouched: true } };
const EXPIRED: ViewerSceneStatus = {
  phase: 'EXPIRED',
  sceneVersion: 'scene-1',
  state: 'COMMITTED',
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
function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCurrentScene(), { wrapper });
}
const advance = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  api.mockReset().mockResolvedValue(RAW);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('현재 Scene 조회', () => {
  it('인증된 HTTP 경로로 GET 하고 JSON 본문을 그대로 받는다', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(RAW), { headers: { 'Content-Type': 'application/json' } }),
      );
    const http = createHttp({ baseUrl: 'http://api.test', getToken: () => 'scene-token' });
    const controller = new AbortController();
    expect(await requestCurrentScene(http, controller.signal)).toEqual(RAW);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/scenes/current');
    expect(options?.method).toBe('GET');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer scene-token');
  });

  it.each([{ raw: RAW }, { raw: null }, { raw: ['뷰어가 거부할 본문'] }])(
    '받은 본문(%j)을 가공하지 않고 안정된 입력으로 감싼다',
    async ({ raw }) => {
      api.mockResolvedValue(raw);
      const { result, rerender } = run();
      expect(result.current.scene).toBeNull();
      await advance();
      expect(result.current.scene).toEqual({ ok: true, raw });
      if (result.current.scene?.ok) expect(result.current.scene.raw).toBe(raw);
      const scene = result.current.scene;
      const callback = result.current.onSceneStatusChange;
      rerender();
      expect(result.current.scene).toBe(scene);
      expect(result.current.onSceneStatusChange).toBe(callback);
    },
  );

  it.each([
    ['401', new ApiError(401)],
    ['5xx', new ApiError(503)],
    ['망 끊김', new ApiError(0)],
  ])('%s 실패에는 기본 바닥 입력을 유지하고 10초 뒤 회복한다', async (_, error) => {
    api.mockRejectedValueOnce(error);
    const { result } = run();
    await advance();
    expect(result.current.scene).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.scene).toEqual({ ok: true, raw: RAW });
  });

  it('서명 만료·권한 거부 신호에 즉시 다시 받고, 반복 신호는 10초 간격으로 제한한다', async () => {
    const { result } = run();
    await advance();
    act(() => result.current.onSceneStatusChange(EXPIRED));
    await advance();
    expect(api).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++) {
      act(() => result.current.onSceneStatusChange({ ...EXPIRED }));
    }
    await advance(9_000);
    expect(api).toHaveBeenCalledTimes(2);
    await advance(1_000);
    expect(api).toHaveBeenCalledTimes(3);
    act(() =>
      result.current.onSceneStatusChange({ ...EXPIRED, phase: 'LOADED', needsRefetch: false }),
    );
    await advance(20_000);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('재요청 실패에도 직전 본문을 유지하고 다음 주기에 새 서명 주소를 넘긴다', async () => {
    const { result } = run();
    await advance();
    const before = result.current.scene;
    api.mockRejectedValueOnce(new ApiError(503));
    act(() => result.current.onSceneStatusChange(EXPIRED));
    await advance();
    expect(result.current.scene).toBe(before);
    const updated = { ...RAW, gltf_url: '/scene.glb?signature=renewed' };
    api.mockResolvedValue(updated);
    await advance(10_000);
    expect(result.current.scene).toEqual({ ok: true, raw: updated });
  });

  it('활성 Scene 불일치로 새 자산을 자동 조회하고 해소되면 반복 조회를 멈춘다', async () => {
    const { result } = run();
    await advance();
    const updated = { scene_version: 'scene-2', gltf_url: '/scene-2.glb' };
    api.mockResolvedValue(updated);
    const mismatch: ViewerSceneStatus = {
      ...EXPIRED,
      phase: 'LOADED',
      verification: 'MISMATCH',
      mismatches: ['health.scene.committed_version=scene-2'],
      reason: null,
    };
    act(() => result.current.onSceneStatusChange(mismatch));
    await advance();
    expect(result.current.scene).toEqual({ ok: true, raw: updated });
    expect(api).toHaveBeenCalledTimes(2);
    const verified: ViewerSceneStatus = {
      ...mismatch,
      sceneVersion: 'scene-2',
      verification: 'VERIFIED',
      display: 'FULL',
      mismatches: [],
      needsRefetch: false,
      provisionalBackground: true,
    };
    act(() => result.current.onSceneStatusChange(verified));
    expect(result.current.sceneStatus).toEqual(verified);
    await advance(20_000);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('내려가면 진행 중 요청을 중단하고 재요청 타이머를 해제한다', async () => {
    api.mockImplementation(() => new Promise(() => {}));
    const { unmount } = run();
    const signal = api.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await advance(30_000);
    expect(api).toHaveBeenCalledTimes(1);
  });
});

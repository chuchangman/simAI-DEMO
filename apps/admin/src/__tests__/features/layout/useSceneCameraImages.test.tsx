import { useSceneCameraImages } from '@/features/layout/useSceneCameraImages';
import type { ViewerSceneInput } from '@/features/viewer3d';
import { ApiError } from '@/lib/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const BUNDLE = 'bundle-3f6c2b1a9d8e4f70a1b2c3d4e5f60718';
const scene = (version: string, extra: object = {}): ViewerSceneInput => ({
  ok: true,
  raw: { scene_version: version, ...extra },
});
let signature = 0;
function body(version: string) {
  signature++;
  return {
    scene_version: version,
    bundle_id: BUNDLE,
    expires_at_ms: Date.now() + 300_000,
    images: [{ camera_id: 'cam_A', url: `https://s3.test/${version}/a.jpg?sig=${signature}` }],
  };
}

const clients: QueryClient[] = [];
function run(initial: ViewerSceneInput | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ input }) => useSceneCameraImages(input), {
    wrapper,
    initialProps: { input: initial },
  });
}
const advance = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));
const pathOf = (call: unknown[]) => call[0];

beforeEach(() => {
  vi.useFakeTimers();
  signature = 0;
  api.mockReset().mockImplementation((path: string) => {
    const version = decodeURIComponent(path.split('/')[3] ?? '');
    return Promise.resolve(body(version));
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
});

describe('Scene 입력 카메라 사진 훅', () => {
  it('지금 Scene 버전으로 묻고 카메라 ID → 주소를 주며, 만료 1분 전에 새 주소로 바꾼다', async () => {
    const { result } = run(scene('scene-a'));
    await advance();
    expect(api).toHaveBeenCalledTimes(1);
    expect(pathOf(api.mock.calls[0]!)).toBe('/api/scenes/scene-a/camera-images');
    expect(result.current).toEqual({ cam_A: 'https://s3.test/scene-a/a.jpg?sig=1' });
    const first = result.current;

    await advance(239_000);
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(first);
    await advance(1_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ cam_A: 'https://s3.test/scene-a/a.jpg?sig=2' });
  });

  it('Scene 이 바뀌면 그 Scene 으로 다시 묻고 이전 Scene 사진은 넘기지 않는다', async () => {
    let resolveB: (value: unknown) => void = () => {};
    const { result, rerender } = run(scene('scene-a'));
    await advance();
    expect(result.current).toEqual({ cam_A: 'https://s3.test/scene-a/a.jpg?sig=1' });

    api.mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)));
    rerender({ input: scene('scene-b') });
    expect(result.current).toBeUndefined();
    resolveB(body('scene-b'));
    await advance();
    expect(pathOf(api.mock.calls[1]!)).toBe('/api/scenes/scene-b/camera-images');
    expect(result.current).toEqual({ cam_A: 'https://s3.test/scene-b/a.jpg?sig=2' });
  });

  it('기본 Scene·본문 없음은 묻지 않고, 묶음을 모르거나 404 면 undefined 이고 다시 묻지 않는다', async () => {
    const { result, rerender } = run(scene('scene-demo', { default: true }));
    rerender({ input: null });
    await advance();
    expect(api).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();

    api.mockResolvedValueOnce({
      scene_version: 'scene-setup',
      bundle_id: null,
      expires_at_ms: null,
      images: [],
    });
    rerender({ input: scene('scene-setup') });
    await advance();
    expect(result.current).toBeUndefined();

    api.mockRejectedValueOnce(new ApiError(404));
    rerender({ input: scene('scene-gone') });
    await advance();
    expect(result.current).toBeUndefined();
    const calls = api.mock.calls.length;
    await advance(600_000);
    expect(api).toHaveBeenCalledTimes(calls);
  });
});

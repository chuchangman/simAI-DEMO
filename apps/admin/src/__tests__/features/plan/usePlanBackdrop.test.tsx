import type { FloorPlanData } from '@/features/plan/floorPlanData';
import { floorPlanSchema } from '@/features/plan/floorPlanData';
import { REFRESH_MARGIN_MS, RETRY_MS } from '@/features/plan/floorPlanReload';
import { ROOM_BOUNDS } from '@/features/plan/plan';
import { usePlanBackdrop } from '@/features/plan/usePlanBackdrop';
import { ApiError } from '@/lib/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const T = 1_760_342_400_000;
const TTL = 5 * 60_000;

/** 서명 주소가 요청마다 다른 평면도 응답. */
let issued = 0;
const body = (change: Record<string, unknown> = {}) => ({
  floor_plan_id: 1,
  stale: false,
  pending: false,
  image_url: `https://img.test/plan?sig=${++issued}`,
  image_url_expires_at_ms: Date.now() + TTL,
  raster: {
    width: 100,
    height: 100,
    meters_per_pixel: 0.1,
    world_bounds: { min_xy: [-1, -2], max_xy: [11, 8] },
  },
  room_outline: {
    polygon_xy: [
      [0, 0],
      [10, 0],
      [10, 6],
    ],
  },
  ...change,
});

/** api(http) 대신: 경로를 보고 schema 검사까지 거친 값을 돌려준다. */
function respond(make: () => Record<string, unknown> | ApiError) {
  api.mockImplementation(async (path: string, options: { schema: typeof floorPlanSchema }) => {
    expect(path).toBe('/api/floor-plans/current');
    const value = make();
    if (value instanceof ApiError) throw value;
    return options.schema.parse(value) satisfies FloorPlanData;
  });
}

/** 주소를 받는 즉시(다음 마이크로태스크) 다 받은 것으로 치는 Image. 받은 주소를 모아 둔다. */
const loadedUrls: string[] = [];
let holdLoads = false;
const pending: (() => void)[] = [];
class FakeImage {
  onload: (() => void) | null = null;
  set src(url: string) {
    const done = () => {
      loadedUrls.push(url);
      this.onload?.();
    };
    if (holdLoads) pending.push(done);
    else queueMicrotask(done);
  }
}

const clients: QueryClient[] = [];
function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePlanBackdrop(), { wrapper });
}
const advance = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T);
  vi.stubGlobal('Image', FakeImage);
  issued = 0;
  holdLoads = false;
  loadedUrls.length = 0;
  pending.length = 0;
  api.mockReset();
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('평면도 바탕 훅', () => {
  it('받기 전에는 기본 방 크기이고 바탕이 없다', async () => {
    respond(() => body());
    const { result } = run();
    expect(result.current.bounds).toBe(ROOM_BOUNDS);
    expect(result.current.backdrop).toBeUndefined();
    await advance();
    expect(result.current.bounds).toEqual({ minX: -1, minY: -2, maxX: 11, maxY: 8 });
  });

  it('받은 이미지를 다 불러온 뒤에 주소를 바탕으로 준다', async () => {
    respond(() => body());
    const { result } = run();
    await advance();
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=1');
    expect(result.current.backdrop?.outline).toHaveLength(3);
    expect(result.current.backdrop?.outdated).toBe(false);
  });

  it('404 FLOOR_PLAN_NOT_READY 면 기본 10×10m 로 그리고, 평면도가 생기면 RETRY_MS 뒤에 바꾼다', async () => {
    let ready = false;
    respond(() =>
      ready
        ? body()
        : new ApiError(404, { serverMessage: '아직 없음', code: 'FLOOR_PLAN_NOT_READY' }),
    );
    const { result } = run();
    await advance();
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current.bounds).toBe(ROOM_BOUNDS);
    expect(result.current.backdrop).toBeUndefined();

    ready = true;
    await advance(RETRY_MS - 100);
    expect(api).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.bounds).toEqual({ minX: -1, minY: -2, maxX: 11, maxY: 8 });
    expect(result.current.backdrop?.imageUrl).toBeDefined();
  });

  it('서명 주소가 만료되기 전에 새로 받는다', async () => {
    respond(() => body());
    const { result } = run();
    await advance();
    expect(api).toHaveBeenCalledTimes(1);

    // 만료 1분 전(4분)에 다시 받는다.
    await advance(TTL - REFRESH_MARGIN_MS - 1_000);
    expect(api).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(loadedUrls).toEqual(['https://img.test/plan?sig=1', 'https://img.test/plan?sig=2']);
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=2');

    // 새 주소의 만료도 같은 규칙으로 따른다.
    await advance(TTL - REFRESH_MARGIN_MS);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('새 주소의 이미지를 다 받기 전까지는 이전 이미지를 그대로 보인다', async () => {
    respond(() => body());
    const { result } = run();
    await advance();
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=1');

    holdLoads = true;
    await advance(TTL - REFRESH_MARGIN_MS + 1_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=1');
    await act(async () => pending.splice(0).forEach((done) => done()));
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=2');
  });

  it('만드는 중이면 자주 확인하고, 오래된 평면도는 outdated 로 알린다', async () => {
    respond(() => body({ stale: true, pending: true }));
    const { result } = run();
    await advance();
    expect(result.current.backdrop?.outdated).toBe(true);
    await advance(10_100);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('다시 받기가 실패해도 받아 둔 평면도를 유지한다', async () => {
    let fail = false;
    respond(() => (fail ? new ApiError(500) : body()));
    const { result } = run();
    await advance();
    fail = true;
    await advance(TTL - REFRESH_MARGIN_MS + 1_000);
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.bounds).toEqual({ minX: -1, minY: -2, maxX: 11, maxY: 8 });
    expect(result.current.backdrop?.imageUrl).toBe('https://img.test/plan?sig=1');
  });
});

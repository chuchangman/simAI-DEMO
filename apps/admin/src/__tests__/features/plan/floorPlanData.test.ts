import {
  floorPlanBounds,
  floorPlanOutline,
  floorPlanSchema,
  requestFloorPlan,
  type FloorPlanData,
} from '@/features/plan/floorPlanData';
import {
  MIN_RELOAD_MS,
  nextReloadMs,
  PENDING_RELOAD_MS,
  REFRESH_MARGIN_MS,
  RETRY_MS,
} from '@/features/plan/floorPlanReload';
import { ROOM_BOUNDS, toPlan } from '@/features/plan/plan';
import { createHttp } from '@/lib/http';
import { createFloorPlanMock, IMAGE_URL_TTL_MS } from '@/mocks/floorPlan';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

const mock = createFloorPlanMock({ now: () => T });
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  Object.assign(mock.state, { ready: true, stale: false, pending: false });
});
afterAll(() => server.close());

const http = (token?: string) => createHttp({ baseUrl: 'http://api.test', getToken: () => token });

const plan = (change: Partial<FloorPlanData> = {}): FloorPlanData => ({
  floor_plan_id: 1,
  stale: false,
  pending: false,
  image_url: 'https://img/1',
  image_url_expires_at_ms: T + IMAGE_URL_TTL_MS,
  ...change,
});

const raster = (min: [number, number], max: [number, number]) => ({
  width: 100,
  height: 100,
  meters_per_pixel: 0.1,
  world_bounds: { min_xy: min, max_xy: max },
});

describe('GET /api/floor-plans/current 응답 검사', () => {
  it('mock 응답(서버와 같은 칸)을 받는다', async () => {
    const data = await requestFloorPlan(http('mock-token.viewer'));
    expect(data.stale).toBe(false);
    expect(data.pending).toBe(false);
    expect(data.image_url).toMatch(/^data:image\/svg\+xml/);
    expect(data.image_url_expires_at_ms).toBe(T + IMAGE_URL_TTL_MS);
    expect(data.raster?.world_bounds).toEqual({ min_xy: [-0.5, -0.5], max_xy: [10.5, 10.5] });
    expect(data.room_outline?.polygon_xy).toHaveLength(4);
  });

  it('로그인한 어느 역할이든 읽고 토큰이 없으면 401', async () => {
    for (const id of ['admin', 'foreman', 'viewer']) {
      await expect(requestFloorPlan(http(`mock-token.${id}`))).resolves.toBeTruthy();
    }
    await expect(requestFloorPlan(http())).rejects.toMatchObject({ status: 401 });
  });

  it('만들어진 평면도가 없으면 404 FLOOR_PLAN_NOT_READY', async () => {
    mock.state.ready = false;
    await expect(requestFloorPlan(http('mock-token.admin'))).rejects.toMatchObject({
      status: 404,
      code: 'FLOOR_PLAN_NOT_READY',
    });
  });

  it('stale·pending 을 그대로 받는다', async () => {
    Object.assign(mock.state, { stale: true, pending: true });
    const data = await requestFloorPlan(http('mock-token.admin'));
    expect(data).toMatchObject({ stale: true, pending: true });
    expect(data.calibration_version).not.toBe(data.current_calibration_version);
  });

  it('칸마다 따로 읽어 형식이 틀린 칸만 비운다', () => {
    const parsed = floorPlanSchema.parse({
      floor_plan_id: 3,
      stale: 'yes',
      image_url: 7,
      raster: { width: 0 },
      room_outline: { polygon_xy: [[0, 0]] },
    });
    expect(parsed.stale).toBe(false);
    expect(parsed.image_url).toBeUndefined();
    expect(parsed.raster).toBeUndefined();
    expect(parsed.room_outline).toBeUndefined();
  });
});

describe('방 범위', () => {
  it('이미지가 덮는 world_bounds 를 쓴다', () => {
    const bounds = floorPlanBounds(plan({ raster: raster([-0.5, -1], [12.5, 7]) }));
    expect(bounds).toEqual({ minX: -0.5, minY: -1, maxX: 12.5, maxY: 7 });
  });

  it('world_bounds 가 없으면 방 외곽 폴리곤의 바깥 상자를 쓴다', () => {
    const bounds = floorPlanBounds(
      plan({
        room_outline: {
          polygon_xy: [
            [1, 2],
            [9, 2],
            [9, 6],
            [1, 6],
          ],
        },
      }),
    );
    expect(bounds).toEqual({ minX: 1, minY: 2, maxX: 9, maxY: 6 });
  });

  it('평면도가 없거나 값을 쓸 수 없으면 기본 10×10m', () => {
    expect(floorPlanBounds(undefined)).toBe(ROOM_BOUNDS);
    expect(floorPlanBounds(null)).toBe(ROOM_BOUNDS);
    expect(floorPlanBounds(plan())).toBe(ROOM_BOUNDS);
    // 폭이 0 이거나 터무니없이 큰 값.
    expect(floorPlanBounds(plan({ raster: raster([0, 0], [0, 5]) }))).toBe(ROOM_BOUNDS);
    expect(floorPlanBounds(plan({ raster: raster([0, 0], [9_999, 5]) }))).toBe(ROOM_BOUNDS);
    expect(ROOM_BOUNDS).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('방 외곽은 있을 때만 돌려준다', () => {
    expect(floorPlanOutline(undefined)).toBeUndefined();
    expect(floorPlanOutline(plan())).toBeUndefined();
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ];
    expect(floorPlanOutline(plan({ room_outline: { polygon_xy: polygon } }))).toBe(polygon);
  });

  it('좌표 변환은 범위의 왼쪽 위(min x, max y)를 원점으로 한다', () => {
    const bounds = { minX: -0.5, minY: -1, maxX: 12.5, maxY: 7 };
    expect(toPlan(-0.5, 7, bounds)).toEqual([0, 0]);
    expect(toPlan(12.5, -1, bounds)).toEqual([13, 8]);
    expect(toPlan(2, 3, bounds)).toEqual([2.5, 4]);
    // 범위를 주지 않으면 기본 방과 같다.
    expect(toPlan(2, 3)).toEqual(toPlan(2, 3, ROOM_BOUNDS));
  });
});

describe('다음 조회 시각', () => {
  it('평면도가 없으면 RETRY_MS 뒤에 다시 시도한다', () => {
    expect(nextReloadMs(undefined, T)).toBe(RETRY_MS);
  });

  it('서명 주소가 만료되기 REFRESH_MARGIN_MS 전에 새로 받는다', () => {
    expect(nextReloadMs(plan(), T)).toBe(IMAGE_URL_TTL_MS - REFRESH_MARGIN_MS);
    // 시간이 지나면 그만큼 짧아진다.
    expect(nextReloadMs(plan(), T + 100_000)).toBe(IMAGE_URL_TTL_MS - REFRESH_MARGIN_MS - 100_000);
  });

  it('이미 만료가 가까우면 하한(MIN_RELOAD_MS)보다 자주 받지 않는다', () => {
    expect(nextReloadMs(plan({ image_url_expires_at_ms: T + 1_000 }), T)).toBe(MIN_RELOAD_MS);
    expect(nextReloadMs(plan({ image_url_expires_at_ms: T - 10_000 }), T)).toBe(MIN_RELOAD_MS);
  });

  it('만들고 있는 중이면 PENDING_RELOAD_MS 로 자주 확인한다', () => {
    expect(nextReloadMs(plan({ pending: true }), T)).toBe(PENDING_RELOAD_MS);
    expect(
      nextReloadMs(
        plan({ pending: true, image_url_expires_at_ms: T + 7_000 + REFRESH_MARGIN_MS }),
        T,
      ),
    ).toBe(7_000);
  });

  it('만료 시각을 모르면 RETRY_MS', () => {
    expect(nextReloadMs(plan({ image_url_expires_at_ms: undefined }), T)).toBe(RETRY_MS);
  });
});

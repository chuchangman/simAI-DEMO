import { readLiveUser, unauthorized } from '@/mocks/problem';
import { http, HttpResponse } from 'msw/http';

// 서버 GET /api/floor-plans/current(BE 곽나혁, docs/design/server-floor-plan.md) 대신 쓰는 mock. 형식은 계약
// bev_floorplan.schema.json 의 결과에 서버가 더하는 칸(stale·pending·서명 주소)이다. 이미지는 저장소에 두지 않고
// 코드로 만든 SVG(data URL)다. 서버는 PNG 를 주지만 화면은 이미지 형식에 기대지 않는다.

/** 서명 주소 유효 시간(ms). 서버(download-ttl)와 같은 5분이다. */
export const IMAGE_URL_TTL_MS = 5 * 60_000;

/** 방 한 변(m)과 이미지가 방 둘레로 더 덮는 폭(m). 원점이 0 이 아니어서 좌표 변환을 확인할 수 있다. */
const ROOM_M = 10;
const EDGE_M = 0.5;
/** 이미지가 덮는 World 범위(m). */
const MIN_XY = [-EDGE_M, -EDGE_M] as const;
const MAX_XY = [ROOM_M + EDGE_M, ROOM_M + EDGE_M] as const;
const METERS_PER_PIXEL = 0.025;
const PX = Math.round((MAX_XY[0] - MIN_XY[0]) / METERS_PER_PIXEL);

/** 흉내 이미지의 색과 선. SVG 이미지라 CSS 변수를 쓸 수 없다. */
const FLOOR_FILL = '#b9b4a8';
const JOINT_STROKE = '#9d988c';
const JOINT_WIDTH_PX = 2;
const FURNITURE_FILL = '#8c8a84';
const FURNITURE_OPACITY = 0.8;
const FURNITURE_RX_PX = 4;
/** 가구 자리(World m): x, y, 너비, 깊이. */
const FURNITURE: readonly (readonly [number, number, number, number])[] = [
  [1.2, 1.4, 3, 1.1],
  [6.2, 6.5, 2.4, 2.4],
  [0.6, 7.6, 1.2, 1.8],
];

/** 사람 없는 바닥을 위에서 본 흉내: 1m 바닥 줄눈과 가구 모양 몇 개. 카메라가 보지 못한 둘레는 투명하다(알파). */
function floorImage(): string {
  const m = (v: number) => Math.round(v / METERS_PER_PIXEL);
  const px = (world: number, min: number) => m(world - min);
  const lines: string[] = [];
  for (let i = 0; i <= ROOM_M; i++) {
    const p = px(i, MIN_XY[0]);
    lines.push(
      `<path d="M${p} ${px(0, MIN_XY[1])}V${px(ROOM_M, MIN_XY[1])}M${px(0, MIN_XY[0])} ${p}H${px(ROOM_M, MIN_XY[0])}"/>`,
    );
  }
  const rect = ([x, y, w, h]: readonly [number, number, number, number]) =>
    `<rect x="${px(x, MIN_XY[0])}" y="${px(y, MIN_XY[1])}" width="${m(w)}" height="${m(h)}" rx="${FURNITURE_RX_PX}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PX}" height="${PX}" viewBox="0 0 ${PX} ${PX}">` +
    `<rect x="${px(0, MIN_XY[0])}" y="${px(0, MIN_XY[1])}" width="${m(ROOM_M)}" height="${m(ROOM_M)}" fill="${FLOOR_FILL}"/>` +
    `<g stroke="${JOINT_STROKE}" stroke-width="${JOINT_WIDTH_PX}" fill="none">${lines.join('')}</g>` +
    `<g fill="${FURNITURE_FILL}" opacity="${FURNITURE_OPACITY}">${FURNITURE.map(rect).join('')}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface FloorPlanMockState {
  /** false 면 404 FLOOR_PLAN_NOT_READY. */
  ready: boolean;
  /** 지금 보정 버전으로 만든 평면도가 아니다. */
  stale: boolean;
  /** 지금 보정 버전의 평면도를 만드는 중이다. */
  pending: boolean;
}

/** 서버가 주는 평면도 응답. 서명 주소는 요청 시각(now)에서 IMAGE_URL_TTL_MS 뒤에 만료된다. */
function floorPlanBody(state: FloorPlanMockState, now: number, image: string, generatedAt: number) {
  return {
    floor_plan_id: 1,
    calibration_version: state.stale ? 'cal-7' : 'cal-8',
    current_calibration_version: 'cal-8',
    stale: state.stale,
    pending: state.pending,
    // 요청마다 새로 서명한다.
    image_url: image,
    image_url_expires_at_ms: now + IMAGE_URL_TTL_MS,
    content_type: 'image/svg+xml',
    image_sha256: '0'.repeat(64),
    scene_version: null,
    created_at: generatedAt,
    purpose: 'OVERVIEW_DISPLAY_ONLY',
    safety_use: false,
    coordinate_frame: { frame: 'WORLD', unit: 'm', handedness: 'right', up_axis: '+Z' },
    raster: {
      width: PX,
      height: PX,
      meters_per_pixel: METERS_PER_PIXEL,
      origin_xy: [MIN_XY[0], MAX_XY[1]],
      origin: 'TOP_LEFT_PIXEL_OUTER_CORNER',
      col_axis: '+X',
      row_axis: '-Y',
      pixel_to_world: [
        [METERS_PER_PIXEL, 0, MIN_XY[0] + METERS_PER_PIXEL / 2],
        [0, -METERS_PER_PIXEL, MAX_XY[1] - METERS_PER_PIXEL / 2],
        [0, 0, 1],
      ],
      world_bounds: { min_xy: [...MIN_XY], max_xy: [...MAX_XY] },
    },
    cameras_used: ['cam_A', 'cam_B', 'cam_C'],
    cameras_skipped: {},
    coverage_ratio: 0.82,
    room_outline: {
      source: 'inferred',
      basis: 'FLOOR_MASK',
      method: 'CONVEX_HULL_OF_COVERAGE',
      accuracy: 'NOT_CLAIMED',
      polygon_xy: [
        [0, 0],
        [ROOM_M, 0],
        [ROOM_M, ROOM_M],
        [0, ROOM_M],
      ],
      openings: null,
    },
    generated_at: generatedAt,
  };
}

export function createFloorPlanMock({
  now = Date.now,
  initial = {},
}: { now?: () => number; initial?: Partial<FloorPlanMockState> } = {}) {
  const state: FloorPlanMockState = { ready: true, stale: false, pending: false, ...initial };
  const image = floorImage();
  const generatedAt = now();

  const handlers = [
    http.get('*/api/floor-plans/current', ({ request }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      if (!state.ready) {
        return HttpResponse.json(
          {
            status: 404,
            detail: '아직 만들어진 BEV 평면도가 없습니다',
            code: 'FLOOR_PLAN_NOT_READY',
          },
          { status: 404 },
        );
      }
      return HttpResponse.json(floorPlanBody(state, t, image, generatedAt));
    }),
  ];

  return { handlers, state };
}

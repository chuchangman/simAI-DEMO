import { ROOM, toPlan, trackLook } from '@/features/plan/plan';
import type { WorldTrack } from '@simai/contracts';

// 중계와 이어지지 않았을 때 보이는 CCTV 모의 화면의 투영 계산(관제 데모와 같다). 실제 영상이 없으므로
// 방 모서리 카메라에서 본 교실을 평면 좌표(m, x 오른쪽, y 아래, toPlan)로 투영해 그린다. 화면 컴포넌트 없이 시험한다.

export interface CctvCam {
  id: string;
  /** 평면 좌표(m). 방 바깥 모서리에 둔다. */
  x: number;
  y: number;
  /** 놓인 모서리(평면 위쪽이 북). */
  dir: string;
}

/** 카메라를 방 모서리에서 바깥으로 물린 거리(m). */
const CAM_INSET = 0.4;

export const CCTV_CAMS: readonly CctvCam[] = [
  { id: 'cam_A', x: -CAM_INSET, y: -CAM_INSET, dir: '북서' },
  { id: 'cam_B', x: ROOM.width + CAM_INSET, y: -CAM_INSET, dir: '북동' },
  { id: 'cam_C', x: -CAM_INSET, y: ROOM.depth + CAM_INSET, dir: '남서' },
  { id: 'cam_D', x: ROOM.width + CAM_INSET, y: ROOM.depth + CAM_INSET, dir: '남동' },
];

/** 화면 크기(SVG viewBox, 16:9). */
export const CCTV_W = 160;
export const CCTV_H = 90;
/** 카메라 높이(m). */
export const CAM_H = 2.6;
/** 내려다보는 각(rad). */
export const CAM_PITCH = 0.36;
/** 가로·세로 화각(rad). */
export const CAM_HFOV = 1.75;
export const CAM_VFOV = 1.0;
/** 사람 키(m). 머리 위치를 정한다. */
export const PERSON_H = 1.72;

/** 이보다 가까운 깊이(m)는 카메라 뒤로 보고 그리지 않는다. */
const NEAR = 0.25;

export interface CctvPoint {
  x: number;
  y: number;
  /** 카메라에서 본 깊이(m). 멀수록 크다. */
  d: number;
}

/** 평면 (x, y, 높이 h) → 화면 좌표. 카메라 뒤면 null. */
export type CctvProjector = (x: number, y: number, h?: number) => CctvPoint | null;

/** 카메라 하나의 투영 함수. 카메라는 방 가운데를 바라본다. */
export function cctvProj(cam: Pick<CctvCam, 'x' | 'y'>): CctvProjector {
  const fx = ROOM.width / 2 - cam.x;
  const fy = ROOM.depth / 2 - cam.y;
  const fl = Math.hypot(fx, fy);
  const ux = fx / fl;
  const uy = fy / fl;
  const rx = -uy;
  const ry = ux;
  const tH = Math.tan(CAM_HFOV / 2);
  const tV = Math.tan(CAM_VFOV / 2);
  const cp = Math.cos(CAM_PITCH);
  const sp = Math.sin(CAM_PITCH);
  return (x, y, h = 0) => {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const z = dx * ux + dy * uy;
    const r = dx * rx + dy * ry;
    const up = h - CAM_H;
    const depth = z * cp - up * sp;
    const yc = z * sp + up * cp;
    if (depth < NEAR) return null;
    return {
      x: (0.5 + r / depth / (2 * tH)) * CCTV_W,
      y: (0.5 - yc / depth / (2 * tV)) * CCTV_H,
      d: depth,
    };
  };
}

/** 점들을 이은 SVG 경로. 카메라 뒤 점에서 끊고 다음 점부터 다시 긋는다. */
export function cctvPath(
  project: CctvProjector,
  pts: readonly (readonly [number, number, number?])[],
): string {
  let d = '';
  let pen = false;
  for (const [x, y, h] of pts) {
    const p = project(x, y, h ?? 0);
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** 직선. 원근으로 휘지 않게 n 칸으로 나눠 투영한다. */
export function cctvLine(
  project: CctvProjector,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h = 0,
  n = 24,
): string {
  return cctvPath(
    project,
    Array.from(
      { length: n + 1 },
      (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, h] as const,
    ),
  );
}

/** 축에 맞춘 직사각형 테두리. */
export function cctvRect(
  project: CctvProjector,
  r: { x: number; y: number; w: number; h: number },
  h = 0,
): string {
  return (
    cctvLine(project, r.x, r.y, r.x + r.w, r.y, h) +
    cctvLine(project, r.x + r.w, r.y, r.x + r.w, r.y + r.h, h) +
    cctvLine(project, r.x + r.w, r.y + r.h, r.x, r.y + r.h, h) +
    cctvLine(project, r.x, r.y + r.h, r.x, r.y, h)
  );
}

/** 바뀌지 않는 바탕: 1 m 바닥 격자와 방 테두리. */
export function cctvBackdrop(project: CctvProjector): { grid: string; room: string } {
  let grid = '';
  for (let i = 0; i <= ROOM.width; i++) grid += cctvLine(project, i, 0, i, ROOM.depth);
  for (let i = 0; i <= ROOM.depth; i++) grid += cctvLine(project, 0, i, ROOM.width, i);
  const room = cctvRect(project, { x: 0, y: 0, w: ROOM.width, h: ROOM.depth });
  return { grid, room };
}

/** 화면에 그릴 사람(평면 좌표, m). */
export interface CctvPerson {
  id: string;
  x: number;
  y: number;
}

/** World 트랙을 그릴 사람으로 바꾼다. 위치를 모르는 사람(LOST·UNKNOWN)은 뺀다. */
export function cctvPeople(
  tracks: readonly Pick<
    WorldTrack,
    'world_id' | 'position_xy' | 'observation_state' | 'track_lifecycle'
  >[],
): CctvPerson[] {
  return tracks
    .filter((track) => trackLook(track) !== 'unknown')
    .map((track) => {
      const [x, y] = toPlan(...track.position_xy);
      return { id: track.world_id, x, y };
    });
}

export interface CctvFigure {
  id: string;
  body: { x: number; y: number; width: number; height: number; rx: number };
  head: { cx: number; cy: number; r: number };
}

/**
 * 사람(평면 좌표)을 몸통 + 머리 모양으로 투영한다. 카메라 뒤·화면 밖은 빼고,
 * 먼 사람부터 그려 가까운 사람이 위에 오게 한다.
 */
export function cctvFigures(project: CctvProjector, people: readonly CctvPerson[]): CctvFigure[] {
  return people
    .flatMap((p) => {
      const feet = project(p.x, p.y, 0);
      const head = project(p.x, p.y, PERSON_H);
      if (!feet || !head || feet.x <= -20 || feet.x >= CCTV_W + 20) return [];
      return [{ id: p.id, feet, head }];
    })
    .sort((a, b) => b.feet.d - a.feet.d)
    .map(({ id, feet, head }) => {
      const h = Math.max(2, feet.y - head.y);
      const w = h * 0.34;
      return {
        id,
        body: {
          x: feet.x - w * 0.42,
          y: head.y + w * 0.5,
          width: w * 0.84,
          height: h - w * 0.5,
          rx: w * 0.3,
        },
        head: { cx: feet.x, cy: head.y + w * 0.3, r: w * 0.32 },
      };
    });
}

import {
  CAMERA_FRUSTUM_ASPECT,
  type CalibratedCameraPose,
} from '@/features/viewer3d/cameras/cameraMarkers';
import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';

// 카메라 시점 보기(S15P31A101-590). 카메라 아이콘을 누르면 3D 시점을 그 카메라 자리·방향·세로 시야각으로 옮기고,
// 맞아 있는 동안만 VDT 를 켠다. 수치 근거는 docs/design/S15P31A101-590-camera-view-vdt.md.

/** 시점 이동 시간(ms). 움직임 줄이기 설정이면 0(즉시)이다. */
export const CAMERA_VIEW_MOVE_MS = 1000;
/** VDT 를 서서히 켜고 끄는 시간(ms). */
export const CAMERA_VDT_FADE_MS = 400;
/** 맞아 있다고 보는 카메라 자리 차이(m). */
export const CAMERA_VIEW_POSITION_TOL_M = 0.01;
/** 맞아 있다고 보는 보는 방향 차이(rad, 약 0.25°). */
export const CAMERA_VIEW_ANGLE_TOL_RAD = 0.0044;
/** 맞아 있다고 보는 세로 시야각 차이(°). */
export const CAMERA_VIEW_FOV_TOL_DEG = 0.1;
/** 회전 중심까지 거리 기본값(m). 정면이 바닥을 향하지 않을 때 쓴다. */
const ORBIT_DISTANCE_DEFAULT_M = 4;
const ORBIT_DISTANCE_MIN_M = 1;
const ORBIT_DISTANCE_MAX_M = 15;

/** 3D 시점 하나(Three.js 공간). fovDeg 는 세로 시야각(PerspectiveCamera.fov)이다. */
export interface ViewerViewPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDeg: number;
}

/** 수평 시야각(rad)과 영상 가로:세로 비율로 세로 시야각(°)을 구한다. */
export function verticalFovDeg(hfovRad: number, aspect: number = CAMERA_FRUSTUM_ASPECT): number {
  return (2 * Math.atan(Math.tan(hfovRad / 2) / aspect) * 180) / Math.PI;
}

/**
 * 보정 카메라 자세로 3D 시점을 만든다. 자리는 광학 중심, 회전 중심은 정면 광선이 바닥(Z=0)에 닿는 점이다
 * (바닥을 향하지 않으면 4 m 앞). World → Three.js 변환은 worldCoordinates.ts 만 거친다.
 */
export function cameraViewPose(pose: CalibratedCameraPose): ViewerViewPose {
  const [px, py, pz] = pose.position;
  const [fx, fy, fz] = pose.forward;
  let distance = ORBIT_DISTANCE_DEFAULT_M;
  if (fz < -0.05 && pz > 0) {
    distance = Math.min(Math.max(-pz / fz, ORBIT_DISTANCE_MIN_M), ORBIT_DISTANCE_MAX_M);
  }
  const target = worldPoint(px + fx * distance, py + fy * distance, pz + fz * distance);
  const position: ThreePoint = worldToThree(pose.position);
  return {
    position: [position[0], position[1], position[2]],
    target: [...worldToThree(target)] as [number, number, number],
    fovDeg: verticalFovDeg(pose.hfovRad),
  };
}

/** 처음과 끝이 느린 이음(0..1 → 0..1). */
export function easeInOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 두 시점 사이를 t(0..1, 이음 적용 전)로 잇는다. */
export function interpolateView(
  from: ViewerViewPose,
  to: ViewerViewPose,
  t: number,
): ViewerViewPose {
  const e = easeInOutCubic(t);
  return {
    position: lerp3(from.position, to.position, e),
    target: lerp3(from.target, to.target, e),
    fovDeg: lerp(from.fovDeg, to.fovDeg, e),
  };
}

function direction(view: ViewerViewPose): [number, number, number] {
  const d: [number, number, number] = [
    view.target[0] - view.position[0],
    view.target[1] - view.position[1],
    view.target[2] - view.position[2],
  ];
  const n = Math.hypot(d[0], d[1], d[2]);
  return n > 1e-9 ? [d[0] / n, d[1] / n, d[2] / n] : [0, 0, -1];
}

/** 지금 시점이 기대한 시점과 같은지(자리 1 cm·방향 0.25°·세로 시야각 0.1° 안). 회전 중심 거리는 보지 않는다. */
export function sameView(actual: ViewerViewPose, expected: ViewerViewPose): boolean {
  const dp = Math.hypot(
    actual.position[0] - expected.position[0],
    actual.position[1] - expected.position[1],
    actual.position[2] - expected.position[2],
  );
  if (dp > CAMERA_VIEW_POSITION_TOL_M) return false;
  if (Math.abs(actual.fovDeg - expected.fovDeg) > CAMERA_VIEW_FOV_TOL_DEG) return false;
  const a = direction(actual);
  const b = direction(expected);
  const cos = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  return Math.acos(cos) <= CAMERA_VIEW_ANGLE_TOL_RAD;
}

/** VDT 를 켠 뒤 프레임을 재기 시작하기까지 기다리는 시간(ms). 사진 올리기·그림자 맵 굽기 끊김을 빼려고 둔다. */
export const VDT_FPS_WARMUP_MS = 1000;
/** 평균 FPS 를 재는 창(ms). */
export const VDT_FPS_WINDOW_MS = 2000;
/** 이 평균 FPS 아래면 VDT 를 끈다. */
export const VDT_MIN_FPS = 24;
/** 한 프레임 간격이 이보다 길면 탭이 숨었거나 멈춘 것으로 보고 창을 처음부터 다시 잰다(ms). */
const VDT_FPS_PAUSE_MS = 500;

/**
 * VDT 를 켠 동안 프레임 간격을 받아 평균 FPS 가 기준 아래인지 본다. 켤 때마다 새로 만든다.
 * push 는 창이 찼고 평균이 VDT_MIN_FPS 아래면 true 다.
 */
export function createFpsGuard({
  minFps = VDT_MIN_FPS,
  windowMs = VDT_FPS_WINDOW_MS,
  warmupMs = VDT_FPS_WARMUP_MS,
}: { minFps?: number; windowMs?: number; warmupMs?: number } = {}) {
  let warm = 0;
  let frames = 0;
  let elapsed = 0;
  return {
    push(deltaMs: number): boolean {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false;
      if (deltaMs > VDT_FPS_PAUSE_MS) {
        frames = 0;
        elapsed = 0;
        return false;
      }
      if (warm < warmupMs) {
        warm += deltaMs;
        return false;
      }
      frames += 1;
      elapsed += deltaMs;
      if (elapsed < windowMs) return false;
      const fps = (frames * 1000) / elapsed;
      frames = 0;
      elapsed = 0;
      return fps < minFps;
    },
  };
}

/** 움직임 줄이기 설정이면 true. 브라우저 밖(시험 등)이면 false. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

import type { TrackView } from '@/features/viewer3d/data/spatialFrame';
import type { ViewerTarget } from '@/features/viewer3d/types';
import {
  toWorldPoint,
  toWorldUnitVector,
  worldDirectionToThree,
  worldToThree,
  type ThreePoint,
  type WorldPoint,
} from '@/features/viewer3d/worldCoordinates';
import { Matrix4, Quaternion, Vector3 } from 'three';

/** 카메라 마커 시야 절두체 기본 길이(m, 지시서: 약 1.5 m). */
export const CAMERA_FRUSTUM_LENGTH_M = 1.5;

/** 시야 절두체 가로:세로 비율(기본 16:9). */
export const CAMERA_FRUSTUM_ASPECT = 16 / 9;

/** 보정된 카메라 1대의 3D 표시용 자세·시야각(World m·rad). */
export interface CalibratedCameraPose {
  readonly cameraId: string;
  /** 카메라 광학 중심 World 위치(m, C = -R^T t). */
  readonly position: WorldPoint;
  /** 카메라 정면 단위 벡터(World, R 셋째 행 정규화). */
  readonly forward: WorldPoint;
  /** 수평 시야각(라디안, 0 < hfovRad < π). */
  readonly hfovRad: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function extractPoseArray(raw: unknown): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null) {
    const poses = field(raw, 'camera_poses');
    if (Array.isArray(poses)) return poses;
  }
  return null;
}

function readCameraId(item: unknown): string | null {
  const id = field(item, 'camera_id') ?? field(item, 'cameraId');
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOnePose(item: unknown): CalibratedCameraPose | null {
  const cameraId = readCameraId(item);
  if (!cameraId) return null;
  const position = toWorldPoint(field(item, 'position_xyz') ?? field(item, 'position'));
  const forward = toWorldUnitVector(field(item, 'forward_xyz') ?? field(item, 'forward'));
  const hfovRaw = field(item, 'hfov_rad') ?? field(item, 'hfovRad');
  if (!position || !forward || !isFiniteNumber(hfovRaw)) return null;
  if (hfovRaw <= 0 || hfovRaw >= Math.PI) return null;
  return {
    cameraId,
    position,
    forward,
    hfovRad: hfovRaw,
  };
}

/**
 * GET /api/calibrations/current 응답 본문 또는 camera_poses 배열을 검사해 CalibratedCameraPose 목록으로 바꾼다.
 * 보정 문서가 없거나 형식이 틀린 항목은 지어내지 않고 뺀다. 같은 camera_id 가 중복되면 모두 뺀다.
 */
export function readCalibrationCameraPoses(raw: unknown): CalibratedCameraPose[] {
  const list = extractPoseArray(raw);
  if (!list || list.length === 0) return [];
  const counts = new Map<string, number>();
  for (const item of list) {
    const id = readCameraId(item);
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: CalibratedCameraPose[] = [];
  for (const item of list) {
    const pose = readOnePose(item);
    if (!pose) continue;
    if ((counts.get(pose.cameraId) ?? 0) > 1) continue;
    out.push(pose);
  }
  return out;
}

export function sameCalibratedCameraPoses(
  a: readonly CalibratedCameraPose[],
  b: readonly CalibratedCameraPose[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i]!;
    return (
      item.cameraId === other.cameraId &&
      item.hfovRad === other.hfovRad &&
      item.position[0] === other.position[0] &&
      item.position[1] === other.position[1] &&
      item.position[2] === other.position[2] &&
      item.forward[0] === other.forward[0] &&
      item.forward[1] === other.forward[1] &&
      item.forward[2] === other.forward[2]
    );
  });
}

export interface CameraMarkerTransform {
  readonly position: ThreePoint;
  readonly forward: ThreePoint;
  /** 로컬 +Z 축을 카메라 정면(forward)으로 맞추고 수평을 유지하는 사원수 [x, y, z, w]. */
  readonly quaternion: readonly [number, number, number, number];
}

/**
 * World 카메라 위치·정면 벡터를 Three.js 위치·방향·회전 사원수로 변환한다.
 * World -> Three.js 축 변환은 worldCoordinates.ts 의 worldToThree·worldDirectionToThree 만 거친다.
 */
export function cameraMarkerTransform(pose: CalibratedCameraPose): CameraMarkerTransform {
  const position = worldToThree(pose.position);
  const forward = worldDirectionToThree(pose.forward);
  const f = new Vector3(forward[0], forward[1], forward[2]);
  if (f.lengthSq() < 1e-12) {
    f.set(0, 0, 1);
  } else {
    f.normalize();
  }
  // Three.js +Y 가 위쪽이다. 정면이 거의 수직(±Y)일 때만 보조 위쪽 축을 쓴다.
  const worldUp = Math.abs(f.y) < 0.999 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const right = new Vector3().crossVectors(worldUp, f).normalize();
  const up = new Vector3().crossVectors(f, right).normalize();
  const basis = new Matrix4().makeBasis(right, up, f);
  const q = new Quaternion().setFromRotationMatrix(basis);
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return {
    position,
    forward,
    quaternion: [clean(q.x), clean(q.y), clean(q.z), clean(q.w)],
  };
}

export interface CameraFrustumDimensions {
  readonly length: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** 로컬 마커 좌표계(+Z 정면)에서 거리 length 평면의 네 모서리(좌하·우하·우상·좌상). */
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

/** 수평 시야각(hfovRad)과 길이(기본 1.5 m)로 시야 절두체 끝면 크기와 꼭짓점을 계산한다. */
export function cameraFrustumDimensions(
  hfovRad: number,
  lengthM: number = CAMERA_FRUSTUM_LENGTH_M,
  aspect: number = CAMERA_FRUSTUM_ASPECT,
): CameraFrustumDimensions {
  const safeHfov = Math.min(Math.max(hfovRad, 0.15), Math.PI - 0.15);
  const halfWidth = lengthM * Math.tan(safeHfov / 2);
  const halfHeight = halfWidth / aspect;
  return {
    length: lengthM,
    halfWidth,
    halfHeight,
    corners: [
      [-halfWidth, -halfHeight, lengthM],
      [halfWidth, -halfHeight, lengthM],
      [halfWidth, halfHeight, lengthM],
      [-halfWidth, halfHeight, lengthM],
    ],
  };
}

/**
 * 현재 선택된 대상이 사람(person)이면 그 사람 트랙의 cameras 목록을 집합으로 돌려준다.
 * 선택된 사람이 없거나 트랙을 찾지 못하면 빈 집합을 돌려준다.
 */
export function highlightedCameraIds(
  tracks: readonly Pick<TrackView, 'worldId' | 'cameras'>[],
  selected: ViewerTarget | null,
): ReadonlySet<string> {
  if (!selected || selected.type !== 'person') return EMPTY_SET;
  const track = tracks.find((t) => t.worldId === selected.id);
  if (!track || track.cameras.length === 0) return EMPTY_SET;
  return new Set(track.cameras);
}

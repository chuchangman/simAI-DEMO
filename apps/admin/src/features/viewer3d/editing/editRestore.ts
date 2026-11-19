import { isValidBox, type WorldBox, type WorldObb } from '@/features/viewer3d/editing/editGeometry';
import type { ViewerObjectKind } from '@/features/viewer3d/editing/editTypes';
import { obstacleObb } from '@/features/viewer3d/surfaces/obstacleGeometry';
import {
  geometryProblem,
  workSurfaceObb,
  YAW_LIMIT_RAD,
  type WorkSurfaceGeometry,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { toWorldPoint } from '@/features/viewer3d/worldCoordinates';

// beginEdit({ draft, before }) 의 바깥 값 검사(S15P31A101-234). 화면이 보관한 미저장 초안을 한 번에 다시 열 때 쓴다.
// 값을 고쳐 받지 않는다. 모양이 틀리거나 형상이 유효하지 않으면 null 이고, 부르는 쪽이 INVALID_GEOMETRY 로 거부한다.

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const triple = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

/** 구역 상자({ min, max }, World m). 축마다 min < max 여야 한다. */
export function readEditBox(value: unknown): WorldBox | null {
  const min = toWorldPoint(field(value, 'min'));
  const max = toWorldPoint(field(value, 'max'));
  if (!min || !max) return null;
  const box = { min, max } as WorldBox;
  return isValidBox(box) ? box : null;
}

/** object 형상. WORK_SURFACE 는 작업면 형상, OBSTACLE 은 정적 객체 형상(center·size 3D, yawRad)이다. */
export function readEditObb(kind: ViewerObjectKind, value: unknown): WorldObb | null {
  if (kind === 'WORK_SURFACE') {
    return geometryProblem(value) ? null : workSurfaceObb(value as WorkSurfaceGeometry);
  }
  const center = triple(field(value, 'center'));
  const size = triple(field(value, 'size'));
  const yawRad = field(value, 'yawRad');
  if (!center || !size || !size.every((v) => v > 0)) return null;
  if (!isFiniteNumber(yawRad) || Math.abs(yawRad) > YAW_LIMIT_RAD) return null;
  return obstacleObb({ center, size, yawRad });
}

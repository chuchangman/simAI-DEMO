import {
  VIEWER_MODES,
  VIEWER_TARGET_TYPES,
  type ViewerMode,
  type ViewerTarget,
  type ViewerTargetType,
} from '@/features/viewer3d/types';

function isTargetType(value: unknown): value is ViewerTargetType {
  return VIEWER_TARGET_TYPES.some((type) => type === value);
}

export function isViewerMode(value: unknown): value is ViewerMode {
  return VIEWER_MODES.some((mode) => mode === value);
}

/** FE 가 넘긴 값을 대상으로 좁힌다. 종류를 모르거나 ID 가 비었으면 null. */
export function parseTarget(value: unknown): ViewerTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const type: unknown = Reflect.get(value, 'type');
  const id: unknown = Reflect.get(value, 'id');
  if (!isTargetType(type) || typeof id !== 'string' || id.trim() === '') return null;
  return { type, id };
}

/** 장면 객체 이름과 등록 키로 함께 쓴다. */
export function targetKey(target: ViewerTarget): string {
  return `${target.type}:${target.id}`;
}

export function sameTarget(a: ViewerTarget | null, b: ViewerTarget | null): boolean {
  return a === b || (a !== null && b !== null && a.type === b.type && a.id === b.id);
}

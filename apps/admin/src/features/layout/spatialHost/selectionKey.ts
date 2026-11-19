import { SELECTABLE_TYPES } from '@/features/layout/spatialHost/constants';
import type { ViewerTarget } from '@/features/viewer3d';

type SelectableType = (typeof SELECTABLE_TYPES)[number];

const isSelectable = (type: string): type is SelectableType =>
  SELECTABLE_TYPES.some((selectable) => selectable === type);

/** 3D 대상을 이벤트 패널·2D·3D 가 같이 쓰는 선택 키로 바꾼다. 선택 키가 없는 종류(planned 등)는 null. */
export function keyOfTarget(target: ViewerTarget): string | null {
  return isSelectable(target.type) ? `${target.type}:${target.id}` : null;
}

/** 이벤트 패널·2D·3D 선택 키(person:…·zone:…·object:…)를 3D 대상으로 바꾼다. 그 밖의 묶음 키는 대상이 없다. */
export function targetOfKey(key: string | null): ViewerTarget | null {
  if (!key) return null;
  const at = key.indexOf(':');
  const type = key.slice(0, at);
  const id = key.slice(at + 1);
  return isSelectable(type) && id ? { type, id } : null;
}

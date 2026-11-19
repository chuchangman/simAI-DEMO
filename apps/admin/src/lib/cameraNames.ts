import { create } from 'zustand';

/** 현장 목록 순서를 보존한다. 목록에 없는 카메라만 ID 정렬 순서로 뒤에 붙인다. */
export function cameraOrder(configured: readonly string[], available: readonly string[]): string[] {
  const ids = [...new Set(configured)];
  const extra = [...new Set(available)].filter((id) => !ids.includes(id)).sort();
  return [...ids, ...extra];
}

export function cameraNumber(cameraIds: readonly string[], id: string): number | null {
  const index = cameraIds.indexOf(id);
  return index < 0 ? null : index + 1;
}

/** 모르는 ID는 번호를 지어내지 않고 이름만 비운다. 원문은 툴팁·상세에서 확인한다. */
export function cameraLabel(cameraIds: readonly string[], id: string): string {
  const n = cameraNumber(cameraIds, id);
  return n === null ? '카메라' : `카메라 ${n}`;
}

export const cameraShortLabel = cameraLabel;

/** 세팅의 coverage 목록이 현장 배치 순서의 정본이다. 세션이 끝나면 비운다. */
export const useCameraOrderStore = create<{
  ids: readonly string[];
  calibrationIds: readonly string[];
  setCalibration: (ids: readonly string[]) => void;
  set: (ids: readonly string[]) => void;
  reset: () => void;
}>()((set) => ({
  ids: [],
  calibrationIds: [],
  setCalibration: (ids) => set({ calibrationIds: cameraOrder([], ids) }),
  set: (ids) => set({ ids: cameraOrder(ids, []) }),
  reset: () => set({ ids: [], calibrationIds: [] }),
}));

import type { Viewer3DHandle } from '@/features/viewer3d/types';

// FE 시험용 가짜 핸들(S15P31A101-234). FE 시험이 viewer3d 내부 Store 를 직접 조립하지 않고 공개 계약만으로 화면을 시험하게 한다.
// 기본은 모든 명령이 NOT_READY(편집 종료 명령은 null)를 돌려주고, 부른 명령과 인자를 calls 에 차례로 남긴다.
// 필요한 명령만 overrides 로 바꾼다. 실제 장면·렌더러는 없다.

export interface ViewerTestCall {
  method: keyof Viewer3DHandle;
  args: unknown[];
}

export type ViewerTestHandle = Required<Viewer3DHandle> & {
  /** 부른 순서대로 쌓인다. */
  readonly calls: ViewerTestCall[];
};

const NOT_READY = { ok: false, reason: 'NOT_READY' } as const;

export function createViewerTestHandle(overrides: Partial<Viewer3DHandle> = {}): ViewerTestHandle {
  const calls: ViewerTestCall[] = [];
  const defaults: Required<Viewer3DHandle> = {
    select: () => NOT_READY,
    clearSelection: () => ({ ok: true }),
    focus: () => NOT_READY,
    setMode: () => ({ ok: true }),
    beginEdit: () => NOT_READY,
    cancelEdit: () => null,
    finishEdit: () => null,
    updateEditField: () => NOT_READY,
    cancelObjectEdit: () => null,
    finishObjectEdit: () => null,
    updateObjectEditField: () => NOT_READY,
    beginObjectCreate: () => NOT_READY,
    beginPlannedCreate: () => NOT_READY,
    cancelPlannedEdit: () => null,
    finishPlannedEdit: () => null,
    updatePlannedEditField: () => NOT_READY,
    resetView: () => NOT_READY,
    setTopView: () => ({ ok: true }),
    viewFromCamera: () => NOT_READY,
    exitCameraView: () => ({ ok: true }),
  };
  const handle = { calls } as unknown as ViewerTestHandle;
  for (const method of Object.keys(defaults) as (keyof Viewer3DHandle)[]) {
    const impl = (overrides[method] ?? defaults[method]) as (...args: unknown[]) => unknown;
    Reflect.set(handle, method, (...args: unknown[]) => {
      calls.push({ method, args });
      return impl(...args);
    });
  }
  return handle;
}

import {
  Viewer3D,
  type Viewer3DHandle,
  type Viewer3DProps,
  type ViewerEditResult,
  type ViewerObjectEditResult,
} from '@/features/viewer3d';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 공개 입구(Viewer3D)의 편집 접점이 기존 사용을 깨지 않고 더해졌는지 본다. 실제 손잡이 조작은 격리 WebGL 브라우저에서 확인한다.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Viewer3D 편집 접점(선택 사항)', () => {
  it('기존 props 만으로도 그대로 쓴다(편집 콜백 없음)', () => {
    const props: Viewer3DProps = { onSelectionChange: () => {}, onStatusChange: () => {} };
    const { container } = render(<Viewer3D {...props} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('handle 에 beginEdit·cancelEdit·finishEdit 가 있고, 준비 전 시작은 NOT_READY 로 알린다(저장 아님)', () => {
    const ref = createRef<Viewer3DHandle>();
    const results: ViewerEditResult[] = [];
    render(<Viewer3D ref={ref} onEditResult={(r) => results.push(r)} />);
    expect(ref.current!.beginEdit({ type: 'zone', id: 'z-01' })).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(results).toEqual([
      {
        status: 'REJECTED',
        target: { type: 'zone', id: 'z-01' },
        reason: 'NOT_READY',
        detail: '뷰어가 준비되지 않았다',
        saved: false,
      },
    ]);
    expect(ref.current!.cancelEdit()).toBeNull();
    expect(ref.current!.finishEdit()).toBeNull();
    // 기존 명령은 그대로다.
    expect(ref.current!.clearSelection()).toEqual({ ok: true });
  });

  it('작업면(object) 편집은 구역 콜백과 따로 알리고, 편집 중이 아니면 null·NOT_EDITABLE 이다(-188)', () => {
    const ref = createRef<Viewer3DHandle>();
    const zoneResults: ViewerEditResult[] = [];
    const objectResults: ViewerObjectEditResult[] = [];
    render(
      <Viewer3D
        ref={ref}
        onEditResult={(r) => zoneResults.push(r)}
        onObjectEditResult={(r) => objectResults.push(r)}
      />,
    );
    expect(ref.current!.beginEdit({ type: 'object', id: 'desk-1' })).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(zoneResults).toEqual([]);
    expect(objectResults).toEqual([
      {
        status: 'REJECTED',
        target: { type: 'object', id: 'desk-1' },
        reason: 'NOT_READY',
        detail: '뷰어가 준비되지 않았다',
        saved: false,
      },
    ]);
    expect(ref.current!.finishObjectEdit?.()).toBeNull();
    expect(ref.current!.cancelObjectEdit?.()).toBeNull();
    expect(ref.current!.updateObjectEditField?.({ field: 'yaw', value: 0.1 })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });
});

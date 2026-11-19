import * as viewer3d from '@/features/viewer3d';
import {
  createViewerTestHandle,
  Viewer3D,
  type Viewer3DHandle,
  type ViewerSelectRequest,
} from '@/features/viewer3d';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -234 공개 입구. 새 props·명령 인자는 모두 선택 사항이고 기존 사용을 깨지 않는다.
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

describe('Viewer3D 공개 계약(-234)', () => {
  it('layers·personModelUrl 을 받아도 Canvas 는 하나다', () => {
    const { container } = render(
      <Viewer3D layers={{ obstacles: 'visible' }} personModelUrl={null} />,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('준비 전 select(waitMs) 는 기다리고, 뷰어가 내려가면 UNMOUNTED 로 끝난다', () => {
    const ref = createRef<Viewer3DHandle>();
    const seen: ViewerSelectRequest[] = [];
    const { unmount } = render(<Viewer3D ref={ref} onSelectRequestChange={(r) => seen.push(r)} />);
    expect(ref.current!.select({ type: 'zone', id: 'z-01' })).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(ref.current!.select({ type: 'zone', id: 'z-01' }, { waitMs: 5000 })).toEqual({
      ok: true,
      pending: true,
    });
    unmount();
    expect(seen.map((r) => [r.status, r.reason])).toEqual([
      ['PENDING', undefined],
      ['CANCELLED', 'UNMOUNTED'],
    ]);
  });

  it('beginEdit 둘째 인자는 선택 사항이고 준비 전에는 NOT_READY 다', () => {
    const ref = createRef<Viewer3DHandle>();
    render(<Viewer3D ref={ref} />);
    expect(
      ref.current!.beginEdit(
        { type: 'zone', id: 'z-01' },
        { draft: { min: [0, 0, 0], max: [1, 1, 1] } },
      ),
    ).toEqual({ ok: false, reason: 'NOT_READY' });
  });

  it('입구가 새 계약을 내보낸다(FE 가 내부를 import 하지 않게)', () => {
    for (const name of [
      'adaptZones',
      'adaptOfficialZones',
      'readPolygonXy',
      'adaptGeometry',
      'adaptOfficialStaticObjects',
      'createExternalSource',
      'createViewerTestHandle',
      'OBSTACLE_OBB_POLICY',
      'VIEWER_LAYER_KEYS',
      'MAX_SELECT_WAIT_MS',
    ]) {
      expect(viewer3d).toHaveProperty(name);
    }
  });
});

describe('createViewerTestHandle', () => {
  it('모든 명령을 갖고 부른 순서를 남기며, 바꾼 명령만 다르게 답한다', () => {
    const handle = createViewerTestHandle({ select: () => ({ ok: true }) });
    expect(handle.select({ type: 'person', id: 'w-1' }, { waitMs: 100 })).toEqual({ ok: true });
    expect(handle.focus({ type: 'person', id: 'w-1' })).toEqual({ ok: false, reason: 'NOT_READY' });
    expect(handle.finishObjectEdit()).toBeNull();
    expect(handle.calls.map((c) => c.method)).toEqual(['select', 'focus', 'finishObjectEdit']);
    expect(handle.calls[0]!.args).toEqual([{ type: 'person', id: 'w-1' }, { waitMs: 100 }]);
  });
});

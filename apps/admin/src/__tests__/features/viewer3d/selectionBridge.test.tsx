import type { Viewer3DHandle, ViewerTarget } from '@/features/viewer3d';
import { ViewerShell } from '@/features/viewer3d/ViewerShell';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom 에는 WebGL 이 없어 Canvas 자리를 준비 상태만 알리는 대역으로 바꾼다.
// 여기서 보는 것은 Viewer 와 FE 사이 선택·상태 알림 연결이고, 3D 렌더·클릭은 브라우저에서 확인한다.
vi.mock('@/features/viewer3d/ViewerCanvas', () => ({
  ViewerCanvas: function FakeCanvas({ children }: { children?: ReactNode }) {
    const store = useViewerStore();
    useEffect(() => store.getState().markReady(), [store]);
    return <>{children}</>;
  },
}));

/** Selectable 처럼 마운트 동안 대상을 장면에 올린다. */
function FakeTarget({ target }: { target: ViewerTarget }) {
  const store = useViewerStore();
  useEffect(() => {
    store.getState().registerTarget(target);
    return () => store.getState().unregisterTarget(target);
  }, [store, target]);
  return null;
}

const WORKER: ViewerTarget = { type: 'person', id: 'w-1' };
const ZONE: ViewerTarget = { type: 'zone', id: 'z-1' };

afterEach(cleanup);

describe('Viewer3D 선택 연결', () => {
  it('FE 가 선택 알림을 받아 같은 대상을 다시 명령해도 알림은 한 번만 온다', () => {
    const ref = createRef<Viewer3DHandle>();
    const seen: (ViewerTarget | null)[] = [];
    // FE 상세 패널이 알림을 받아 같은 대상을 다시 select 하는 왕복을 흉내 낸다.
    const onSelectionChange = (target: ViewerTarget | null) => {
      seen.push(target);
      if (target) ref.current!.select(target);
    };
    render(
      <ViewerShell ref={ref} onSelectionChange={onSelectionChange}>
        <FakeTarget target={WORKER} />
        <FakeTarget target={ZONE} />
      </ViewerShell>,
    );

    act(() => {
      expect(ref.current!.select(WORKER)).toEqual({ ok: true });
    });
    act(() => {
      expect(ref.current!.select(WORKER)).toEqual({ ok: true });
    });
    expect(seen).toEqual([WORKER]);

    act(() => {
      ref.current!.select(ZONE);
      ref.current!.clearSelection();
      ref.current!.clearSelection();
    });
    expect(seen).toEqual([WORKER, ZONE, null]);
  });

  it('선택한 대상이 장면에서 빠지면 null 을 한 번 알리고 그 대상 명령은 NOT_FOUND 로 거절한다', () => {
    const ref = createRef<Viewer3DHandle>();
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <ViewerShell ref={ref} onSelectionChange={onSelectionChange}>
        <FakeTarget target={WORKER} />
      </ViewerShell>,
    );
    act(() => {
      ref.current!.select(WORKER);
    });

    rerender(<ViewerShell ref={ref} onSelectionChange={onSelectionChange} />);

    expect(onSelectionChange.mock.calls).toEqual([[WORKER], [null]]);
    expect(ref.current!.select(WORKER)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(ref.current!.focus(WORKER)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('준비된 뒤 모드 명령은 바뀔 때만 상태를 알린다', () => {
    const ref = createRef<Viewer3DHandle>();
    const onStatusChange = vi.fn();
    render(<ViewerShell ref={ref} onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenLastCalledWith({ phase: 'ready', mode: 'LIVE', error: null });

    onStatusChange.mockClear();
    act(() => {
      ref.current!.setMode('LIVE');
      ref.current!.setMode('REPLAY');
      ref.current!.setMode('REPLAY');
    });
    expect(onStatusChange.mock.calls).toEqual([[{ phase: 'ready', mode: 'REPLAY', error: null }]]);
  });
});

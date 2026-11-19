import {
  Viewer3D,
  type Viewer3DHandle,
  type ViewerMode,
  type ViewerTarget,
} from '@/features/viewer3d';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 에는 ResizeObserver·WebGL 이 없다. 크기 0 이면 R3F 는 렌더러를 만들지 않으므로
// 여기서는 Canvas DOM 유지·명령·상태 알림·오류 처리만 본다. 실제 WebGL 렌더는 브라우저에서 확인한다.
const disconnect = vi.fn();

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {
    disconnect();
  }
}

const WORKER: ViewerTarget = { type: 'person', id: 'w-1' };

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shell = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-viewer-mode]')!;

describe('Viewer3D', () => {
  it('공개 입구로 Canvas 하나를 그리고 처음 상태를 알린다', () => {
    const onStatusChange = vi.fn();
    const { container } = render(<Viewer3D onStatusChange={onStatusChange} />);

    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(onStatusChange).toHaveBeenLastCalledWith({
      phase: 'initializing',
      mode: 'LIVE',
      error: null,
    });
  });

  it('부모 재렌더·콜백 교체·모드 명령에도 같은 Canvas 를 유지하고 새 콜백으로 알린다', () => {
    const ref = createRef<Viewer3DHandle>();
    const first = vi.fn();
    const { container, rerender } = render(
      <StrictMode>
        <Viewer3D ref={ref} onStatusChange={first} />
      </StrictMode>,
    );
    const canvas = container.querySelector('canvas');
    expect(container.querySelectorAll('canvas')).toHaveLength(1);

    const second = vi.fn();
    rerender(
      <StrictMode>
        <Viewer3D ref={ref} onStatusChange={second} initialMode="REPLAY" className="absolute" />
      </StrictMode>,
    );
    // initialMode 는 처음 마운트 때만 읽는다.
    expect(shell(container).dataset.viewerMode).toBe('LIVE');

    first.mockClear();
    act(() => {
      expect(ref.current!.setMode('PLANNED')).toEqual({ ok: true });
    });

    expect(shell(container).dataset.viewerMode).toBe('PLANNED');
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenLastCalledWith({
      phase: 'initializing',
      mode: 'PLANNED',
      error: null,
    });
  });

  it('준비 전 명령과 잘못된 값에는 이유를 돌려주고 예외를 내지 않는다', () => {
    const ref = createRef<Viewer3DHandle>();
    const onSelectionChange = vi.fn();
    render(<Viewer3D ref={ref} onSelectionChange={onSelectionChange} />);
    const handle = ref.current!;

    expect(handle.select(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });
    expect(handle.focus(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });
    // FE 가 서버 값 등을 그대로 넘긴 경우를 흉내 낸다.
    const broken: unknown = { type: 'person', id: '' };
    expect(handle.select(broken as ViewerTarget)).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(handle.setMode('WHAT_IF' as ViewerMode)).toEqual({ ok: false, reason: 'INVALID_MODE' });
    expect(handle.clearSelection()).toEqual({ ok: true });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('렌더러를 만들지 못하면 RENDER_FAILED 를 알리고 Canvas 를 내린 뒤에도 명령이 안전하다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 }),
    );
    const ref = createRef<Viewer3DHandle>();
    const onStatusChange = vi.fn();
    const { container } = render(<Viewer3D ref={ref} onStatusChange={onStatusChange} />);

    // 부모 크기가 생기면 R3F 가 렌더러를 만든다. jsdom 은 WebGL 컨텍스트를 주지 않는다.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => expect(shell(container).dataset.viewerPhase).toBe('error'));
    expect(onStatusChange).toHaveBeenLastCalledWith({
      phase: 'error',
      mode: 'LIVE',
      error: { code: 'RENDER_FAILED', message: expect.any(String) },
    });
    expect(container.querySelector('canvas')).toBeNull();

    expect(ref.current!.select(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });
    act(() => {
      expect(ref.current!.setMode('REPLAY')).toEqual({ ok: true });
    });
    expect(shell(container).dataset.viewerMode).toBe('REPLAY');
  });

  it('언마운트하면 Canvas·크기 감시·창 리스너를 정리하고 이후 알리지 않는다', () => {
    const ref = createRef<Viewer3DHandle>();
    const onStatusChange = vi.fn();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(<Viewer3D ref={ref} onStatusChange={onStatusChange} />);
    const handle = ref.current!;

    unmount();

    expect(container.querySelector('canvas')).toBeNull();
    expect(ref.current).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));

    onStatusChange.mockClear();
    handle.setMode('PLANNED');
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});

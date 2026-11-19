import { CctvFloat } from '@/features/cctv/CctvFloat';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { CCTV_BOX_SETTLE_MS, useCctvFloatBoxStore } from '@/store/cctvFloatBox.store';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { VITE_CCTV_PREVIEW_URL: '', VITE_STOMP_URL: '' } }));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/features/cctv/useCctvPreview', () => ({ useCctvPreview: vi.fn() }));
const stopped = vi.fn();

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ session: { accessToken: 'token', user: { id: 'a', role: 'ADMIN' } } });
  useCctvStore.getState().setLink('open');
  useCctvStore.getState().hello(['cam_A', 'cam_B']);
  vi.mocked(useCctvPreview).mockImplementation(() => {
    useEffect(() => stopped, []);
    return { attach: vi.fn(), resume: vi.fn() };
  });
});
afterEach(() => {
  cleanup();
  stopped.mockClear();
  useCctvStore.getState().reset();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState({ session: undefined });
});

describe('떠 있는 CCTV', () => {
  it('도구 줄 없이 카메라 하나만 보이고 닫으면 연결을 정리한다', () => {
    const close = vi.fn();
    const view = render(<CctvFloat selectedKey={null} onClose={close} />);
    // 요청이 없으면 중계 목록의 첫 카메라 하나만 보인다. 4분할·카메라 버튼 줄은 없다.
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 2 영상')).toBeNull();
    for (const name of ['4분할', 'cam_A', 'cam_B']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: '떠 있는 CCTV 닫기' }));
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('예전에 저장한 카메라·4분할 값은 쓰지 않는다', () => {
    localStorage.setItem('simai.cctv.float', JSON.stringify({ camera: 'cam_B', all: true }));
    render(<CctvFloat selectedKey={null} onClose={vi.fn()} />);
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 2 영상')).toBeNull();
  });

  it('저장한 위치와 크기를 복원하고 접으면 연결을 정리한다', () => {
    localStorage.setItem(
      'simai.cctv.float',
      JSON.stringify({ spot: { left: 120, offset: 140 }, width: 520, height: 400 }),
    );
    render(<CctvFloat selectedKey={null} onClose={vi.fn()} />);
    const box = screen.getByLabelText('떠 있는 CCTV');
    expect(box.style.left).toBe('120px');
    expect(box.style.top).toBe('140px');
    expect(box.style.width).toBe('520px');
    fireEvent.click(screen.getByRole('button', { name: 'CCTV 접기' }));
    expect(stopped).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'CCTV 펼치기' }));
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
  });

  it('선택한 사람의 카메라를 연다', () => {
    useRealtimeStore.setState({
      world: {
        payload: { tracks: [{ world_id: 'p1', cameras: ['cam_B'] }] } as never,
        receivedAt: Date.now(),
      },
    });
    render(<CctvFloat selectedKey="person:p1" onClose={vi.fn()} />);
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
  });

  it('사람을 고른 채 카메라 마커로 열면 마커의 카메라를 보이고, 그 뒤 사람 선택이 바뀌면 그 사람의 카메라로 바뀐다', () => {
    useRealtimeStore.setState({
      world: {
        payload: {
          tracks: [
            { world_id: 'p1', cameras: ['cam_B'] },
            { world_id: 'p2', cameras: ['cam_B'] },
          ],
        } as never,
        receivedAt: Date.now(),
      },
    });
    const request = { cameraId: 'cam_A', seq: 1 };
    const view = render(
      <CctvFloat selectedKey="person:p1" requestedCamera={request} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 2 영상')).toBeNull();

    view.rerender(
      <CctvFloat selectedKey="person:p2" requestedCamera={request} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 1 영상')).toBeNull();
  });

  it('고른 사람 ID 가 병합으로 다른 트랙의 별칭이 되면 그 생존 트랙의 카메라로 다시 고른다(-661)', () => {
    const at = Date.now();
    useRealtimeStore.setState({
      world: {
        payload: { tracks: [{ world_id: 'p2', cameras: ['cam_A'] }] } as never,
        receivedAt: at,
      },
    });
    render(<CctvFloat selectedKey="person:p2" onClose={vi.fn()} />);
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    act(() =>
      useRealtimeStore.setState({
        world: {
          payload: { tracks: [{ world_id: 'p1', aliases: ['p2'], cameras: ['cam_B'] }] } as never,
          receivedAt: at + 100,
        },
      }),
    );
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
  });

  it('연 창의 자리를 이벤트 패널에 알리고, 창이 내려가면 비운다', () => {
    // jsdom 은 배치를 하지 않아 창 자리를 심는다(기본 자리 top-32 left-24, 480×360).
    const scene = document.createElement('div');
    const spies = [
      vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(scene),
      vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(96),
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(128),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(480),
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(360),
    ];
    vi.useFakeTimers();
    try {
      const view = render(<CctvFloat selectedKey={null} onClose={vi.fn()} />);
      act(() => vi.advanceTimersByTime(CCTV_BOX_SETTLE_MS));
      expect(useCctvFloatBoxStore.getState().box).toEqual({
        left: 96,
        top: 128,
        width: 480,
        height: 360,
      });
      view.unmount();
      expect(useCctvFloatBoxStore.getState().box).toBeNull();
    } finally {
      vi.useRealTimers();
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it('3D 카메라 마커 클릭 요청(requestedCamera)으로 열리거나 이미 열린 창의 카메라를 바꾼다', () => {
    const view = render(
      <CctvFloat
        selectedKey={null}
        requestedCamera={{ cameraId: 'cam_B', seq: 1 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 1 영상')).toBeNull();

    // 이미 열린 창에 다른 카메라 마커 클릭 요청이 오면 그 카메라 하나로 바뀐다
    view.rerender(
      <CctvFloat
        selectedKey={null}
        requestedCamera={{ cameraId: 'cam_A', seq: 2 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 2 영상')).toBeNull();
  });

  it('「3D 에서 이 방향으로 보기」는 넘겼을 때만 두고, 보이는 카메라로 부르며, 막히면 끄고 이유를 보인다(-626)', () => {
    const view = render(<CctvFloat selectedKey={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '3D 에서 이 방향으로 보기' })).toBeNull();
    view.unmount();

    const onView = vi.fn();
    const block = vi.fn((id: string) => (id === 'cam_B' ? '보정 정보가 없습니다' : null));
    const opened = render(
      <CctvFloat
        selectedKey={null}
        requestedCamera={{ cameraId: 'cam_A', seq: 1 }}
        onClose={vi.fn()}
        onViewFromCamera={onView}
        viewFromCameraBlock={block}
      />,
    );
    const button = screen.getByRole('button', { name: '3D 에서 이 방향으로 보기' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onView).toHaveBeenCalledExactlyOnceWith('cam_A');

    opened.rerender(
      <CctvFloat
        selectedKey={null}
        requestedCamera={{ cameraId: 'cam_B', seq: 2 }}
        onClose={vi.fn()}
        onViewFromCamera={onView}
        viewFromCameraBlock={block}
      />,
    );
    const blocked = screen.getByRole('button', { name: '3D 에서 이 방향으로 보기' });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    const reasonId = blocked.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe('보정 정보가 없습니다');
    fireEvent.click(blocked);
    expect(onView).toHaveBeenCalledOnce();
  });
});

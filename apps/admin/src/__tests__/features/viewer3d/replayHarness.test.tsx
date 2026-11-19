import { readDataSource } from '@/features/viewer3d/dev-harness/harnessSource';
import { MockApp } from '@/features/viewer3d/dev-harness/MockApp';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 개발 화면의 녹화 재생 입력(-187). jsdom 에는 WebGL 이 없어 HTML 진단·모드만 본다.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const viewerMode = (container: HTMLElement) =>
  container.querySelector('[data-viewer-mode]')!.getAttribute('data-viewer-mode');
const sourceSelect = () =>
  screen.getByRole('combobox', { name: '데이터 입력' }) as HTMLSelectElement;

describe('개발 화면 녹화 재생', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('주소 source=replay 를 읽는다', () => {
    expect(readDataSource('?source=REPLAY')).toBe('replay');
  });

  it('재생 입력을 고르면 REPLAY 모드로 예시 기록을 재생하고, 다른 입력으로 바꾸면 LIVE 로 돌아온다', () => {
    // FE 목업(메뉴·상단 바)과 펼친 진단을 함께 연다.
    window.history.replaceState(
      null,
      '',
      '/dev?mockUi=1&worldDebug=1&debug=1&source=risk-lifecycle',
    );
    const { container } = render(<MockApp />);
    const canvas = container.querySelector('canvas');
    expect(viewerMode(container)).toBe('LIVE');

    fireEvent.change(sourceSelect(), { target: { value: 'replay' } });
    expect(new URLSearchParams(window.location.search).get('source')).toBe('replay');
    expect(viewerMode(container)).toBe('REPLAY');
    expect(screen.getByTestId('replay-log').textContent).toContain('World 45 · 이벤트 3 · 제외 0');
    expect(screen.getByTestId('replay-status').textContent).toContain('재생 중');
    expect(screen.getByTestId('replay-clock')).toBeTruthy();
    expect(screen.getByTestId('data-connection').textContent).toContain('OPEN');
    expect(screen.getByRole('list', { name: 'REPLAY 이벤트' })).toBeTruthy();

    // 재생 중 업무 메뉴를 바꿔도 재생 기록을 LIVE·PLANNED 로 보이지 않는다.
    fireEvent.click(container.querySelector('[data-menu="tbm"]')!);
    expect(viewerMode(container)).toBe('REPLAY');

    fireEvent.change(sourceSelect(), { target: { value: 'normal' } });
    expect(viewerMode(container)).toBe('PLANNED');
    fireEvent.click(container.querySelector('[data-menu="monitor"]')!);
    expect(viewerMode(container)).toBe('LIVE');
    expect(screen.queryByTestId('replay-controls')).toBeNull();
    expect(screen.queryByTestId('replay-clock')).toBeNull();
    expect(container.querySelector('canvas')).toBe(canvas);
  });

  it('재생 주소로 열면 처음부터 REPLAY 이고, 일시정지·프레임 이동을 진단에 보인다', () => {
    window.history.replaceState(null, '', '/dev?view=world&source=replay');
    const { container } = render(<MockApp />);
    expect(viewerMode(container)).toBe('REPLAY');
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(screen.getByTestId('replay-status').textContent).toContain('멈춤');
    fireEvent.click(screen.getByRole('button', { name: '다음 프레임' }));
    expect(screen.getByTestId('replay-status').textContent).toContain('기록 연령 0ms');
  });

  it('고른 파일의 못 쓰는 줄을 파일·줄 번호·이유와 함께 보이고, 예시 기록으로 되돌린다', async () => {
    window.history.replaceState(null, '', '/dev?view=world&source=replay');
    render(<MockApp />);
    const file = new File(['{깨진 줄\n\n[1]\n'], 'bad.jsonl', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('재생 기록 파일'), { target: { files: [file] } });
    });
    const issues = await screen.findByTestId('replay-issues');
    expect(issues.textContent).toContain('bad.jsonl:1 NOT_JSON');
    expect(issues.textContent).toContain('bad.jsonl:3 NOT_OBJECT');
    expect(screen.getByTestId('replay-log').textContent).toContain('World 0 · 이벤트 0 · 제외 2');
    expect(screen.getByTestId('data-connection').textContent).toContain('재생할 기록 없음');

    fireEvent.click(screen.getByRole('button', { name: '예시 기록' }));
    expect(screen.queryByTestId('replay-issues')).toBeNull();
    expect(screen.getByTestId('replay-log').textContent).toContain('World 45');
  });
});

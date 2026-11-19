import {
  DEV_VIEWS,
  readDevView,
  readDiagnosticsOpen,
  withDevView,
  type DevViewKey,
} from '@/features/viewer3d/dev-harness/devView';
import {
  readAvatar,
  readDataSource,
  withDataSource,
} from '@/features/viewer3d/dev-harness/harnessSource';
import { MockApp } from '@/features/viewer3d/dev-harness/MockApp';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('개발 보기 주소', () => {
  it.each([
    ['', 'mock'],
    ['?mockUi=1', 'mock'],
    ['?mockUi=0', '3d'],
    ['?mockUi=OFF', '3d'],
    ['?mockUi=1&worldDebug=1&debug=1', 'combined'],
    ['?mockUi=0&worldDebug=1&debug=1', 'world'],
    ['?mockUi=0&worldDebug=1', 'world'],
    ['?mockUi=0&debug=1', 'world'],
    ['?debug=1', 'combined'],
    ['?worldDebug=1', 'combined'],
    ['?worldDebug=0&debug=0', 'mock'],
  ])('예전 플래그 %s → %s', (search, view) => {
    expect(readDevView(search)).toBe(view);
  });

  it('view 가 있으면 예전 플래그보다 우선하고 대소문자를 가리지 않는다', () => {
    expect(readDevView('?view=3d&mockUi=1&worldDebug=1&debug=1')).toBe('3d');
    expect(readDevView('?view=WORLD')).toBe('world');
    for (const { key } of DEV_VIEWS) expect(readDevView(`?view=${key}`)).toBe(key);
  });

  it('모르는 view 값은 무시하고 예전 플래그를 따른다', () => {
    expect(readDevView('?view=unknown')).toBe('mock');
    expect(readDevView('?view=&mockUi=0&debug=1')).toBe('world');
  });

  it('진단은 Spatial 정합 보기나 예전 debug=1 주소에서만 펼친 채 연다', () => {
    expect(readDiagnosticsOpen('?view=world')).toBe(true);
    expect(readDiagnosticsOpen('?view=combined')).toBe(false);
    expect(readDiagnosticsOpen('?mockUi=1&worldDebug=1&debug=1')).toBe(true);
    expect(readDiagnosticsOpen('?mockUi=1&worldDebug=1')).toBe(false);
  });

  it('보기를 바꾼 주소는 예전 플래그를 지우고 다른 매개변수와 해시를 둔다', () => {
    expect(
      withDevView('http://127.0.0.1:5174/x/index.html?a=1&mockUi=1&worldDebug=1&debug=1#h', '3d'),
    ).toBe('http://127.0.0.1:5174/x/index.html?a=1&view=3d#h');
    expect(withDevView('http://127.0.0.1:5174/x/index.html?view=mock', 'world')).toBe(
      'http://127.0.0.1:5174/x/index.html?view=world',
    );
  });
});

// jsdom 에는 WebGL 이 없다. 크기 0 이면 렌더러를 만들지 않으므로 Canvas DOM 과 HTML 레이어 전환만 본다(WebGL 실측은 브라우저에서).
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const VIEW_LABEL: Record<DevViewKey, string> = Object.fromEntries(
  DEV_VIEWS.map((v) => [v.key, v.label]),
) as Record<DevViewKey, string>;

function chooseView(key: DevViewKey) {
  fireEvent.click(screen.getByRole('button', { name: /개발 보기/ }));
  fireEvent.click(
    within(screen.getByRole('group', { name: '개발 보기 선택' })).getByText(VIEW_LABEL[key]),
  );
}

const viewerMode = (container: HTMLElement) =>
  container.querySelector('[data-viewer-mode]')!.getAttribute('data-viewer-mode');

// 개발 보기 선택기를 뺀 HTML 레이어. 3D 만 보기에서는 비어 있어야 한다.
const huds = (container: HTMLElement) =>
  Array.from(container.querySelector('.smk-root')!.children).filter(
    (el) =>
      el.getAttribute('data-testid') !== 'spatial-layer' &&
      el.getAttribute('data-testid') !== 'dev-view-switcher',
  );

describe('MockApp 개발 보기', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    window.history.replaceState(null, '', '/dev?mockUi=1');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['3d', false, false],
    ['mock', true, false],
    ['world', false, true],
    ['combined', true, true],
  ] as const)('%s 보기: FE 목업 %s · Spatial 진단 %s', (key, mockUi, spatial) => {
    window.history.replaceState(null, '', `/dev?view=${key}`);
    const { container } = render(<MockApp />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(screen.queryByTestId('mock-ui') !== null).toBe(mockUi);
    expect(screen.queryByTestId('spatial-diagnostics') !== null).toBe(spatial);
    expect(screen.getByTestId('dev-view-current').textContent).toBe(VIEW_LABEL[key]);
    if (key === '3d') expect(huds(container)).toHaveLength(0);
  });

  it('예전 통합 주소로 열고 3D만 보기로 바꾸면 선택기 말고는 HTML 레이어가 남지 않는다', () => {
    window.history.replaceState(null, '', '/dev?mockUi=1&worldDebug=1&debug=1#h');
    const { container } = render(<MockApp />);
    expect(screen.getByTestId('world-legend')).toBeTruthy();
    expect(screen.getByTestId('debug-out')).toBeTruthy();

    chooseView('3d');
    expect(huds(container)).toHaveLength(0);
    expect(screen.queryByTestId('world-legend')).toBeNull();
    expect(screen.queryByTestId('debug-out')).toBeNull();
    expect(window.location.search).toBe('?view=3d');
    expect(window.location.hash).toBe('#h');
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('진단은 하나의 접이식 영역이고 접으면 범례·측정이 사라진다', () => {
    window.history.replaceState(null, '', '/dev?view=world');
    render(<MockApp />);
    const head = screen.getByRole('button', { name: /Spatial 진단/ });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('world-legend').textContent).toContain('실측·캘리브레이션 아님');

    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('world-legend')).toBeNull();
    expect(screen.queryByTestId('debug-out')).toBeNull();
    expect(screen.getByTestId('diag-status')).toBeTruthy();
  });

  it('보기 4개를 여러 번 돌아도 같은 Canvas 를 쓰고 주소는 view 하나로 정규화된다', () => {
    const { container } = render(<MockApp />);
    const canvas = container.querySelector('canvas');
    for (let round = 0; round < 3; round++) {
      for (const { key } of DEV_VIEWS) {
        chooseView(key);
        expect(window.location.search).toBe(`?view=${key}`);
        expect(container.querySelector('canvas')).toBe(canvas);
      }
    }
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('TBM 의 PLANNED·메뉴·패널·선택은 보기를 바꿔도 남고, 다른 업무 메뉴를 골라야만 LIVE 가 된다', () => {
    const { container } = render(<MockApp />);
    expect(viewerMode(container)).toBe('LIVE');

    fireEvent.click(container.querySelector('[data-menu="tbm"]')!);
    expect(viewerMode(container)).toBe('PLANNED');

    // 같은 메뉴를 다시 눌러 패널만 닫아도 모드는 그대로다.
    fireEvent.click(container.querySelector('[data-menu="tbm"]')!);
    expect(screen.queryByTestId('mock-panel')).toBeNull();
    expect(viewerMode(container)).toBe('PLANNED');
    fireEvent.click(container.querySelector('[data-menu="tbm"]')!);
    expect(screen.getByRole('region', { name: 'TBM 보고서' })).toBeTruthy();

    for (const key of ['3d', 'world', 'combined', 'mock'] as const) {
      chooseView(key);
      expect(viewerMode(container)).toBe('PLANNED');
    }
    // FE 목업으로 돌아오면 TBM 메뉴와 패널이 그대로다.
    expect(container.querySelector('[data-menu="tbm"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'TBM 보고서' })).toBeTruthy();

    fireEvent.click(container.querySelector('[data-menu="monitor"]')!);
    expect(viewerMode(container)).toBe('LIVE');
  });

  it('Spatial 정합 보기에서도 업무 모드를 진단 상태 줄로 볼 수 있다', () => {
    const { container } = render(<MockApp />);
    fireEvent.click(container.querySelector('[data-menu="tbm"]')!);
    chooseView('world');
    expect(screen.getByTestId('diag-status').textContent).toContain('PLANNED');
  });

  it('Escape 로 보기 목록을 닫고 선택기 버튼에 초점을 돌려준다', () => {
    render(<MockApp />);
    const toggle = screen.getByRole('button', { name: /개발 보기/ });
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(screen.getByRole('group', { name: '개발 보기 선택' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('FE 목업 메뉴 이동·패널 닫기를 반복해도 같은 Canvas 를 쓴다', () => {
    const { container } = render(<MockApp />);
    const canvas = container.querySelector('canvas');
    for (const menu of ['cctv', 'zones', 'tbm', 'system', 'monitor']) {
      fireEvent.click(container.querySelector(`[data-menu="${menu}"]`)!);
      expect(screen.getByTestId('mock-panel')).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: '패널 닫기' }));
    expect(screen.queryByTestId('mock-panel')).toBeNull();
    expect(container.querySelector('canvas')).toBe(canvas);
  });

  it('데이터 입력을 바꿔도 같은 Canvas·업무 모드·보기를 쓰고 주소는 source 만 바뀐다', () => {
    window.history.replaceState(null, '', '/dev?view=world&source=risk-lifecycle#h');
    const { container } = render(<MockApp />);
    const canvas = container.querySelector('canvas');
    const select = screen.getByRole('combobox', { name: '데이터 입력' }) as HTMLSelectElement;
    expect(select.value).toBe('risk-lifecycle');
    expect(screen.getByTestId('data-connection').textContent).toContain('OPEN');

    for (const key of ['disconnect', 'external', 'off', 'normal']) {
      fireEvent.change(select, { target: { value: key } });
      expect(new URLSearchParams(window.location.search).get('source')).toBe(key);
      expect(new URLSearchParams(window.location.search).get('view')).toBe('world');
      expect(window.location.hash).toBe('#h');
      expect(container.querySelector('canvas')).toBe(canvas);
      expect(viewerMode(container)).toBe('LIVE');
    }
    fireEvent.change(select, { target: { value: 'off' } });
    expect(screen.getByTestId('data-connection').textContent).toContain('—');
    expect(screen.queryByTestId('data-tick')).toBeNull();
  });

  it('보기를 바꿔도 데이터 입력은 그대로다', () => {
    window.history.replaceState(null, '', '/dev?view=world&source=disconnect');
    render(<MockApp />);
    chooseView('3d');
    expect(new URLSearchParams(window.location.search).get('source')).toBe('disconnect');
    chooseView('world');
    expect((screen.getByRole('combobox', { name: '데이터 입력' }) as HTMLSelectElement).value).toBe(
      'disconnect',
    );
  });

  it('입력이 있으면 추적 인원이 Provider 의 World ID 이고, 입력 없음이면 예전 고정 목록이다', () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/dev?view=mock&source=normal');
      const { unmount } = render(<MockApp />);
      act(() => vi.advanceTimersByTime(300));
      const panel = screen.getByRole('region', { name: '실시간 관제' });
      expect(
        within(panel)
          .getAllByText(/^작업자 w-000\d$/)
          .map((el) => el.textContent),
      ).toEqual(['작업자 w-0001', '작업자 w-0002', '작업자 w-0003']);
      expect(within(panel).queryByText('예시 작업자 1')).toBeNull();
      unmount();

      window.history.replaceState(null, '', '/dev?view=mock&source=off');
      render(<MockApp />);
      const legacy = screen.getByRole('region', { name: '실시간 관제' });
      expect(within(legacy).getByText('예시 작업자 1')).toBeTruthy();
      expect(within(legacy).queryByText(/작업자 w-/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('위험 시나리오의 LIVE 활성 이벤트가 계약 등급 그대로 이벤트 목록이 되고 대상은 World ID 다(R06)', () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, '', '/dev?view=mock&source=risk-lifecycle');
      render(<MockApp />);
      const panel = screen.getByRole('region', { name: '실시간 관제' });
      // 행마다 [등급 배지, 제목, 대상 ID].
      const rows = () =>
        [...panel.querySelectorAll('[data-event-id]')].map((row) =>
          [...row.children].map((cell) => cell.textContent),
        );
      act(() => vi.advanceTimersByTime(1200));
      expect(rows()).toEqual([['HIGH', 'R1 · z-01 · RAISED #1', 'w-0001']]);
      act(() => vi.advanceTimersByTime(1000));
      // 상향된 CRITICAL 을 HIGH 로 줄이지 않는다.
      expect(rows()).toEqual([['CRITICAL', 'R1 · z-01 · UPDATED #2', 'w-0001']]);
      act(() => vi.advanceTimersByTime(1000));
      expect(rows()).toEqual([
        ['CRITICAL', 'R1 · z-01 · UPDATED #2', 'w-0001'],
        ['CRITICAL', 'R2 · z-02 · RAISED #1', 'w-0001'],
      ]);
      act(() => vi.advanceTimersByTime(2000));
      expect(rows()).toEqual([['CRITICAL', 'R2 · z-02 · RAISED #1', 'w-0001']]);
      act(() => vi.advanceTimersByTime(1500));
      expect(rows()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('데이터 입력 주소', () => {
  it('모르는 값이나 없으면 normal, 아는 값은 그대로 읽는다', () => {
    expect(readDataSource('')).toBe('normal');
    expect(readDataSource('?source=bogus')).toBe('normal');
    expect(readDataSource('?source=OFF')).toBe('off');
    expect(readDataSource('?view=world&source=invalid-input')).toBe('invalid-input');
  });

  it('source 만 바꾸고 다른 매개변수와 해시는 둔다', () => {
    expect(withDataSource('http://127.0.0.1:5175/x/index.html?view=world#h', 'external')).toBe(
      'http://127.0.0.1:5175/x/index.html?view=world&source=external#h',
    );
  });

  it('avatar=capsule 일 때만 캡슐, 그 밖에는 XBot 을 먼저 시도한다', () => {
    expect(readAvatar('')).toBe('xbot');
    expect(readAvatar('?avatar=CAPSULE')).toBe('capsule');
    expect(readAvatar('?avatar=other')).toBe('xbot');
  });
});

import { TbmLayoutEditorDialog } from '@/features/tbm/TbmLayoutEditorDialog';
import { TBM_TASKS } from '@/features/tbm/tbmDemo';
import { createQueryClient } from '@/lib/queryClient';
import { MOCK_STATIC_OBJECTS } from '@/mocks/staticObjects';
import { createTbmMock } from '@/mocks/tbm';
import { MOCK_ZONES, SEEDED_VALID_FROM } from '@/mocks/zones';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// API·STOMP 주소를 쓰지 않는 도메인(.invalid)으로 둔다. 이 파일은 @/lib/api 를 그대로 써서 주소가 실행 환경의
// VITE_API_BASE_URL 을 따랐고, https://simai.live 이면 MSW 가 응답을 흉내 내도 시험마다 실제 TLS 연결이 한 번씩 나갔다
// (S15P31A101-674 TLS 탐침 4회). 처리기는 */api/… 로 걸려 있어 주소가 바뀌어도 그대로 받는다.
vi.mock('@/lib/env', () => ({
  env: {
    VITE_API_BASE_URL: 'https://tbm-layout.invalid',
    VITE_STOMP_URL: 'wss://tbm-layout.invalid/ws',
    VITE_CCTV_PREVIEW_URL: 'ws://127.0.0.1:47032',
    VITE_API_MOCK: false,
    VITE_API_REAL: [],
  },
}));

// 3D 뷰어는 jsdom 에서 그릴 수 없다(WebGL·ResizeObserver 없음). 진짜 뷰어를 띄우면 오류 경계로 쓰러지며 MSW 가 못 막는
// 실제 연결이 나가 CI 에서 TLS 오류(ERR_TLS_CERT_ALTNAME_INVALID)로 깨졌다. /zones·관제 시험처럼 자리표시로 바꾸고,
// 편집 동작은 대화상자 패널(숫자·추가·삭제·가져오기)과 layoutEditorModel 시험으로 확인한다.
vi.mock('@/features/viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewer3d')>();
  const { forwardRef } = await import('react');
  return {
    ...actual,
    Viewer3D: forwardRef<unknown, { initialMode?: string; topView?: boolean }>(
      function Viewer3DStub(props, ref) {
        void ref; // forwardRef 는 두 인자를 받아야 경고가 없다
        // 진짜 ViewerShell 과 같은 data 속성만 남긴다(모드·위에서 보기).
        return (
          <div
            data-testid="viewer3d-stub"
            data-viewer-mode={props.initialMode ?? 'LIVE'}
            data-viewer-top-view={props.topView ? 'on' : 'off'}
          />
        );
      },
    ),
  };
});

const TEST_ZONES = [
  ...MOCK_ZONES,
  {
    zone_id: 'z-05',
    zone_version: 1,
    name: '높이 없는 바닥 위험구역',
    zone_kind: 'HAZARD' as const,
    eval_type: 'GROUND_FOOTPRINT' as const,
    polygon_xy: [
      [1.0, 1.0],
      [3.0, 1.0],
      [3.0, 2.5],
      [1.0, 2.5],
    ] as [number, number][],
    z_min_m: null,
    z_max_m: null,
    severity: 'HIGH' as const,
    requirements: null,
    has_guardrail: null,
    valid_from: SEEDED_VALID_FROM,
    valid_to: null,
  },
];

const geometryHandlers = [
  http.get('*/api/zones', () => HttpResponse.json(TEST_ZONES)),
  http.get('*/api/static-objects', () => HttpResponse.json(MOCK_STATIC_OBJECTS)),
  http.get('*/api/scenes/current', () =>
    HttpResponse.json({ status: 404, code: 'SCENE_NOT_FOUND', detail: '없음' }, { status: 404 }),
  ),
];

let tbmMock = createTbmMock();
const server = setupServer(...tbmMock.handlers, ...geometryHandlers);

beforeAll(() => {
  server.listen();
});

beforeEach(() => {
  window.innerWidth = 1280;
  tbmMock = createTbmMock();
  server.resetHandlers(...tbmMock.handlers, ...geometryHandlers);
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  server.close();
});

/** 기존 레이아웃 #101(개구부 옆 비계 배치)을 연 편집 창을 그린다. */
const renderEditor = () => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TbmLayoutEditorDialog
        task={TBM_TASKS[0]!}
        layouts={tbmMock.layouts}
        initialLayoutId={101}
        onSaved={onSaved}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onSaved, onClose };
};

describe('3D 가상 레이아웃 편집기', () => {
  it('3D 뷰어와 위에서 보기를 전환하고, 물체 추가·수치 다듬기·삭제 후 저장하면 새 레이아웃을 만든다', async () => {
    const { onSaved } = renderEditor();
    const dialog = await screen.findByRole('dialog', { name: '3D 가상 레이아웃 편집' });

    // 3D 뷰어가 열리고 기본은 top-view off
    const viewport = within(dialog).getByTestId('layout-editor-viewport');
    const viewer = viewport.firstElementChild as HTMLElement;
    expect(viewer.getAttribute('data-viewer-mode')).toBe('PLANNED');
    expect(viewer.getAttribute('data-viewer-top-view')).toBe('off');

    // "위에서 보기" 토글 확인
    const topViewBtn = within(dialog).getByRole('button', { name: '위에서 보기' });
    fireEvent.click(topViewBtn);
    expect(topViewBtn.getAttribute('aria-pressed')).toBe('true');
    expect(viewer.getAttribute('data-viewer-top-view')).toBe('on');
    fireEvent.click(within(dialog).getByRole('button', { name: '입체 시점으로 보기' }));
    expect(viewer.getAttribute('data-viewer-top-view')).toBe('off');

    // 새 가상 레이아웃 만들기 선택
    fireEvent.change(within(dialog).getByLabelText('편집할 레이아웃'), {
      target: { value: 'new' },
    });
    fireEvent.change(within(dialog).getByLabelText('레이아웃 이름'), {
      target: { value: '신규 3D 비계 배치' },
    });

    // 작업면(단상 작업면 top 0.4m)을 고른 뒤 고소 작업면 + 개구부 추가 후 개구부 삭제
    await waitFor(() => {
      const surfaceSelect = within(dialog).getByLabelText('놓을 기준면') as HTMLSelectElement;
      expect(surfaceSelect.options.length).toBeGreaterThan(1);
    });
    fireEvent.change(within(dialog).getByLabelText('놓을 기준면'), {
      target: { value: 'ws-0a0c0001' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 고소 작업면' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '+ 개구부' }));

    expect(within(dialog).getByText('배치 물체 (2)')).toBeTruthy();

    // 현재 선택된 두 번째 물체(개구부) 삭제 → 첫 번째 물체(고소 작업면)만 남음
    fireEvent.click(within(dialog).getByRole('button', { name: '물체 삭제' }));
    expect(within(dialog).getByText('배치 물체 (1)')).toBeTruthy();

    // 남은 작업면 항목의 이름·크기·회전 다듬기
    fireEvent.change(within(dialog).getByLabelText('물체 이름'), {
      target: { value: '단상 위 이동식 비계' },
    });
    fireEvent.change(within(dialog).getByLabelText('폭 X'), {
      target: { value: '2.4' },
    });
    fireEvent.change(within(dialog).getByLabelText('회전 각도'), {
      target: { value: '45' },
    });

    // 저장(POST /api/layouts) → 새 layout_id(104) 로 저장했다고 알린다
    fireEvent.click(within(dialog).getByRole('button', { name: '레이아웃 저장 · 작업 연결' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ layout_id: 104, name: '신규 3D 비계 배치', revision: 1 }),
      );
      expect(tbmMock.layouts[0]).toMatchObject({
        layout_id: 104,
        name: '신규 3D 비계 배치',
        revision: 1,
      });
      expect(tbmMock.layouts[0]?.items[0]).toMatchObject({
        kind: 'WORK_SURFACE',
        label: '단상 위 이동식 비계',
      });
    });
  });

  it('구역에서 가져오기: 높이가 없는 구역은 Z 값을 비워 두고 사용자가 입력하기 전까지 저장을 막는다', async () => {
    const { onSaved } = renderEditor();
    const dialog = await screen.findByRole('dialog', { name: '3D 가상 레이아웃 편집' });

    fireEvent.change(within(dialog).getByLabelText('편집할 레이아웃'), {
      target: { value: 'new' },
    });

    await waitFor(() => {
      const zoneSelect = within(dialog).getByLabelText('구역에서 가져오기') as HTMLSelectElement;
      expect(zoneSelect.options.length).toBeGreaterThan(2);
    });

    // 높이 범위가 없는 구역(z-05) 가져오기
    fireEvent.change(within(dialog).getByLabelText('구역에서 가져오기'), {
      target: { value: 'z-05' },
    });

    const bottomZInput = within(dialog).getByLabelText('바닥 높이 Z') as HTMLInputElement;
    const heightInput = within(dialog).getByLabelText('높이 Z') as HTMLInputElement;
    expect(bottomZInput.value).toBe('');
    expect(heightInput.value).toBe('');

    // Z 미입력 상태에서 저장 시도 → 검증 오류로 차단
    fireEvent.click(within(dialog).getByRole('button', { name: '레이아웃 저장 · 작업 연결' }));
    expect(within(dialog).getByTestId('layout-editor-error').textContent).toContain(
      '바닥 높이(Z)가 비어 있습니다',
    );
    expect(onSaved).not.toHaveBeenCalled();

    // 사용자가 직접 바닥 높이와 높이를 입력하면 저장 성공
    fireEvent.change(bottomZInput, { target: { value: '0' } });
    fireEvent.change(heightInput, { target: { value: '1.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '레이아웃 저장 · 작업 연결' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('기존 레이아웃 수정 시 revision 충돌(409 LAYOUT_REVISION_CONFLICT)이 나면 안내하고 다시 불러올 수 있다', async () => {
    renderEditor();
    const dialog = await screen.findByRole('dialog', { name: '3D 가상 레이아웃 편집' });

    // 레이아웃 #101 (rev.3) 상세가 불러와질 때까지 대기
    await waitFor(() => {
      const nameInput = within(dialog).getByLabelText('레이아웃 이름') as HTMLInputElement;
      expect(nameInput.value).toContain('개구부 옆 비계 배치');
    });

    // 서버 쪽에서 다른 사람이 먼저 수정해 revision 이 4 로 올라간 상황 흉내
    tbmMock.layouts[0]!.revision = 4;
    tbmMock.layouts[0]!.name = '다른 사람이 고친 레이아웃';

    fireEvent.click(within(dialog).getByRole('button', { name: '레이아웃 저장 · 작업 연결' }));

    await waitFor(() => {
      expect(within(dialog).getByTestId('layout-editor-error').textContent).toContain(
        '다른 사람이 먼저 고침 — 다시 불러오기',
      );
    });

    // "다시 불러오기" 단추를 누르면 서버의 최신 버전(rev.4)을 불러와 충돌 안내가 사라진다
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 불러오기' }));
    await waitFor(() => {
      expect(within(dialog).queryByTestId('layout-editor-error')).toBeNull();
      const nameInput = within(dialog).getByLabelText('레이아웃 이름') as HTMLInputElement;
      expect(nameInput.value).toBe('다른 사람이 고친 레이아웃');
    });
  });

  it('휴대폰 폭(좁은 화면)에서는 편집 대신 "PC 에서 편집" 안내와 읽기 전용 미리보기를 보인다', async () => {
    window.innerWidth = 500;
    renderEditor();
    const dialog = await screen.findByRole('dialog', { name: '3D 가상 레이아웃 편집' });

    const readonlyNotice = within(dialog).getByTestId('layout-mobile-readonly');
    expect(readonlyNotice.textContent).toContain('PC 에서 편집');
    expect(within(dialog).queryByRole('button', { name: '레이아웃 저장 · 작업 연결' })).toBeNull();
  });
});

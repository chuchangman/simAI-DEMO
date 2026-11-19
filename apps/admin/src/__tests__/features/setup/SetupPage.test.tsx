import { workDayOf } from '@/__tests__/features/work/workFixture';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import {
  createSetupSession,
  requestCameraHeightDefaults,
  setupZonePlanKey,
} from '@/features/setup/api';
import { resetSetupFlowStore, useSetupFlowStore } from '@/features/setup/setup.store';
import { SETUP_COMPLETE_ERROR_TEXT } from '@/features/setup/setupErrorMessage';
import { SetupPage } from '@/features/setup/SetupPage';
import type { SetupSessionResponse } from '@/features/setup/types';
import type {
  Viewer3DHandle,
  Viewer3DProps,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d';
import { api } from '@/lib/api';
import { problem } from '@/mocks/problem';
import { sceneHandlers } from '@/mocks/scenes';
import { buildCameraCheck, buildCoverageGuidePayload, createSetupMock } from '@/mocks/setup';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock } from '@/mocks/zones';
import { useZoneEditStore } from '@/store/zoneEdit.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** 저장한 구역이 없을 때 완료 전에 묻는 글(지금 관제 구역을 구체적으로 적는다, S15P31A101-691). */
const EMPTY_ZONES_CONFIRM = expect.stringContaining('저장한 구역이 없');

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    // 세팅(초안 수락으로 구역 저장 포함)은 관리자가 한다.
    api: createHttp({ baseUrl: 'http://api.invalid', getToken: () => 'mock-token.admin' }),
  };
});
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));
// 3D 뷰어 대역: 준비를 한 번 알리고 마지막 props 를 남긴다. 고르기·초점 명령을 기록하고, 고르면 3D 클릭처럼 선택을 알린다.
const fakeViewer = vi.hoisted(() => ({
  props: null as Viewer3DProps | null,
  select: vi.fn(),
  focus: vi.fn(),
}));
vi.mock('@/features/viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewer3d')>();
  const { useEffect, useImperativeHandle, useRef } = await import('react');
  function FakeViewer(props: Viewer3DProps) {
    const { ref, onStatusChange, onSelectionChange } = props;
    fakeViewer.props = props;
    useImperativeHandle(
      ref,
      () =>
        ({
          select: (target: ViewerTarget) => {
            fakeViewer.select(target);
            onSelectionChange?.(target);
            return { ok: true };
          },
          focus: (target: ViewerTarget) => {
            fakeViewer.focus(target);
            return { ok: true };
          },
          clearSelection: () => ({ ok: true }),
        }) as unknown as Viewer3DHandle,
    );
    const reported = useRef(false);
    useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
    }, [onStatusChange]);
    return <div data-testid="viewer3d" />;
  }
  return { ...actual, Viewer3D: FakeViewer };
});
// 구역 편집 도구 대역: 세팅의 구역 단계가 준 3D 틀 값(SpatialViewportContext)을 읽어 보인다.
vi.mock('@/features/zones/ZonesPage', () => ({
  ZonesPage: ({ placement }: { placement?: string }) => {
    const viewport = useSpatialViewport();
    return (
      <div
        data-testid="zones-page-stub"
        data-placement={placement}
        data-viewer-ready={String(viewport?.viewerReady)}
        data-zones={viewport?.zones.length ?? 0}
        data-selected={viewport?.selectedKey ?? ''}
      >
        <button
          onClick={() => viewport?.selectTarget({ type: 'zone', id: 'z-04' }, { focus: true })}
        >
          z-04 고르기
        </button>
      </div>
    );
  },
}));
vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn(), retry: vi.fn() }),
}));

let setupMock = createSetupMock();
// 구역·정적 객체 mock 은 초안 수락이 구역을 저장하므로 시험마다 새로 만든다. 구역 단계 3D 는 현재 배경·정적 객체를 받는다.
const baseHandlers = (setup?: ReturnType<typeof createSetupMock>) => {
  const objects = createStaticObjectsMock();
  const zonesMock = createZonesMock({ staticObjects: objects.store });
  // 구역 단계의 처음 목록 채우기(-629)가 지금 관제 구역을 읽는다
  setup?.bindLiveZones(() => zonesMock.currentZones());
  return [...zonesMock.handlers, ...sceneHandlers, ...objects.handlers];
};

const server = setupServer(...baseHandlers(), ...setupMock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  useCctvStore.getState().reset();
  resetSetupFlowStore();
  useZoneEditStore.getState().clear();
  navigateMock.mockReset();
  fakeViewer.props = null;
  fakeViewer.select.mockReset();
  fakeViewer.focus.mockReset();
  setupMock = createSetupMock({
    cameraHeightsM: {
      cam_A: 2.25,
      cam_B: 2.3,
      cam_C: 2.2,
      cam_D: null,
    },
    latestGuide: buildCoverageGuidePayload({
      connectivity: 'DISCONNECTED',
      guides: [
        {
          camera_id: 'cam_C',
          pair: ['cam_C', 'cam_D'],
          direction: 'RIGHT',
          magnitude: 'SMALL',
          reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
        },
      ],
    }),
  });
  server.resetHandlers(...baseHandlers(setupMock), ...setupMock.handlers);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});
afterAll(() => server.close());

function renderSetupPage(workUnitId: number | null = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SetupPage workUnitId={workUnitId ?? undefined} />
      </QueryClientProvider>,
    ),
  };
}

/** 1단계 「맵」 방식에서 '새 맵 만들기' 를 고른다(S15P31A101-689, 세션 POST 는 그 뒤 '다음' 에서 나간다). */
async function pickNewModel() {
  const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
  fireEvent.click(within(group).getByRole('radio', { name: /^새 맵 만들기/ }));
}

/** 1단계 '다음' 뒤 뜨는 배경 촬영 창(-686)에서 「시작」을 눌러 세션을 만든다. */
async function pressCaptureStart() {
  const dialog = await screen.findByRole('dialog', { name: '배경 촬영' });
  fireEvent.click(within(dialog).getByRole('button', { name: '시작' }));
}

/** 단계 줄('보정 단계')에서 지금 단계(aria-current="step")인 항목의 글. */
const currentStepText = () =>
  within(screen.getByRole('list', { name: '보정 단계' }))
    .getAllByRole('listitem')
    .find((step) => step.getAttribute('aria-current') === 'step')?.textContent;

/** 세팅 세션이 만들어져 화면이 보정·생성(2단계)으로 넘어간 것을 기다린다(세션 id 는 화면에 보이지 않는다). */
async function waitForCalibrationStep() {
  await waitFor(() => expect(currentStepText()).toBe('2보정·생성'), POLL_WAIT);
}

/** 화면이 이 세션을 따라가기(세팅 흐름 저장소의 진행 세션)를 기다린다. */
async function waitForTrackedSession(sessionId: string) {
  await waitFor(
    () => expect(useSetupFlowStore.getState().activeSessionId).toBe(sessionId),
    POLL_WAIT,
  );
}

/** 화면 전체의 글(대화상자 등 틀 밖 요소 포함). */
const pageText = () => document.body.textContent ?? '';

/** 「자세히 · 카메라 상태」(닫힘, S15P31A101-691). */
const cameraDetails = () => screen.getByRole('group', { name: '카메라 상태 자세히' });

/** 각도 안내 첫 응답이 올 때까지 기다린다(연결 요약에 확인 시각이 붙는다). */
async function waitForCoverage() {
  await screen.findByRole('group', { name: '카메라 상태 자세히' });
  await waitFor(() => expect(cameraDetails().textContent).toMatch(/초 전 확인|방금/));
}

/** 보정·생성 왼쪽 칸의 「3D 미리보기」 탭이 켜질 때까지(미리보기 맵 도착) 기다린다. */
async function waitForPreviewTab() {
  const tab = () => screen.getByRole('tab', { name: '3D 미리보기' }) as HTMLButtonElement;
  await waitFor(() => expect(tab().disabled).toBe(false), POLL_WAIT);
  return tab();
}

/** 「3D 미리보기」 탭을 눌러 3D 를 본다(카메라 영상이 기본이고 저절로 바뀌지 않는다, S15P31A101-691). */
async function openPreviewTab() {
  fireEvent.click(await waitForPreviewTab());
}

describe('설치 · 보정 작업 연결', () => {
  it('작업 id 없이 열면 세팅을 시작하지 않고 작업 관리로 돌려보내는 안내를 보인다', () => {
    renderSetupPage(null);
    expect(screen.getByTestId('setup-needs-work')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 1 높이 (m)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '작업 관리로 이동' }));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/work' });
    expect(setupMock.submittedBodies).toHaveLength(0);
  });

  it('검색 값의 workUnitId 로 세팅을 시작하고 발행 뒤에는 그 작업의 작업 관리로 돌아간다', async () => {
    renderSetupPage(5);
    const cam_D = (await screen.findByLabelText('카메라 4 높이 (m)')) as HTMLInputElement;
    fireEvent.change(cam_D, { target: { value: '2.35' } });
    await pickNewModel();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    expect(setupMock.submittedBodies[0]).toMatchObject({ work_unit_id: 5 });
  });
});

describe('세팅 화면 재진입', () => {
  it('작업에 진행 중 세션이 있으면 새로 시작하지 않고 이어받아 그 세션 대기 화면을 연다', async () => {
    const resumeId = '019a0000-0000-7000-8000-0000000000aa';
    const resumeMock = createSetupMock({ workUnitSessionId: resumeId });
    server.resetHandlers(...baseHandlers(), ...resumeMock.handlers);
    renderSetupPage(5);
    await waitFor(() => expect(useSetupFlowStore.getState().activeSessionId).toBe(resumeId));
    expect(resumeMock.submittedBodies).toHaveLength(0);
    expect(screen.queryByText(/cal-8/)).toBeNull();
  });

  it('새로고침했을 때 그 세팅을 이미 완료했으면 서버 세션 상태로 구역 단계를 연다(S15P31A101-689)', async () => {
    const created = await createSetupSession(api, {
      work_unit_id: 5,
      camera_heights_m: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
    });
    setupMock.updateSession(created.setup_session_id, {
      ...FINAL_PATCH,
      setup_completed_at_ms: SETUP_COMPLETED_AT_MS,
    });
    renderSetupPage(5);
    await waitForTrackedSession(created.setup_session_id);
    await waitFor(() => expect(currentStepText()).toBe('3구역'), POLL_WAIT);
    expect(setupMock.submittedBodies).toHaveLength(1);
  });

  it('다른 탭에서 새 시도를 시작하면(작업의 서버 세션이 바뀌면) 끝난 시도에서 그 시도로 옮겨 대기 화면을 연다(S15P31A101-689)', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      stage: 'FAILED',
      status: 'FAILED',
      failure_code: 'CANCELLED_BY_ADMIN',
      failure_message: '관리자가 세팅을 취소했습니다',
    });
    await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    // 다른 탭: 같은 작업으로 새 세션을 만든다(서버가 작업의 지금 세션을 바꾼다)
    const other = await createSetupSession(api, {
      work_unit_id: 1,
      camera_heights_m: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
    });
    await waitForTrackedSession(other.setup_session_id);
    await waitForCalibrationStep();
    expect(screen.queryByRole('alert', { name: '세팅 실패 안내' })).toBeNull();
    // 새 시도는 배경 수집 중이라 배경 촬영 창을 서버 상태에서 다시 연다
    expect(await screen.findByRole('dialog', { name: '배경 촬영' })).toBeTruthy();
  }, 20_000);
});

describe('설치 · 보정 1단계 화면', () => {
  it('본문은 남은 높이를 채우는 한 덩어리로 묶고 자기 아래 여백은 두지 않는다(주 메뉴 여백은 틀이 둔다)', async () => {
    const { container } = renderSetupPage();
    const page = container.firstElementChild!;
    expect(page.classList.contains('flex-1')).toBe(true);
    expect(page.classList.contains('min-h-0')).toBe(true);
    expect(page.className).not.toContain('pb-[');
    expect(page.contains(await screen.findByLabelText('카메라 1 높이 (m)'))).toBe(true);
  });

  it('보정 단계 아래에 지도와 카메라 영상을 한 카드로 보이고 규칙 표는 두지 않는다(관리자가 아닌 역할도)', async () => {
    renderSetupPage();
    expect(await screen.findByRole('heading', { name: '카메라 시야 · 실시간 영상' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '실시간 CCTV 4칸' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '카메라 쌍 시야 연결' })).toBeNull();
    expect(screen.getByRole('list', { name: '보정 단계' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '규칙' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('1단계 단계 줄 위에는 안내 글이나 연결 배지가 없고 세션·보정 버전 같은 코드 글도 없다', async () => {
    renderSetupPage();
    await screen.findByLabelText('카메라 1 높이 (m)');
    await waitForCoverage();
    expect(screen.queryByText('세팅 1단계 · 카메라 확인')).toBeNull();
    // 연결 요약은 「자세히」 안에만 있다
    for (const el of screen.queryAllByText(/모두 연결|갈림/))
      expect(el.closest('details')).toBeTruthy();
    expect(pageText()).not.toContain('세션 019a');
    expect(pageText()).not.toContain('cal-');
  });

  it('단계 줄은 표시만 하고 눌러도 이동하지 않아 카메라 연결 안내가 한 번만 보인다', async () => {
    renderSetupPage();
    await screen.findByLabelText('카메라 1 높이 (m)');
    const list = screen.getByRole('list', { name: '보정 단계' });
    const steps = within(list).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      '1카메라 연결 관리',
      '2보정·생성',
      '3구역',
    ]);
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual(['step', null, null]);
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(steps[1]!);
    fireEvent.click(steps[2]!);
    expect(steps[0]!.getAttribute('aria-current')).toBe('step');
    expect(screen.getAllByRole('heading', { name: '지금 할 일' })).toHaveLength(1);
    expect(screen.getByLabelText('카메라 1 높이 (m)')).toBeTruthy();
  });

  it('카메라 높이 기본값을 자동으로 채우고 값 없는 카메라만 입력 필수 상태로 둔다', async () => {
    renderSetupPage();

    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));

    const cam2Input = screen.getByLabelText('카메라 2 높이 (m)') as HTMLInputElement;
    const cam3Input = screen.getByLabelText('카메라 3 높이 (m)') as HTMLInputElement;
    const cam4Input = screen.getByLabelText('카메라 4 높이 (m)') as HTMLInputElement;

    expect(cam2Input.value).toBe('2.3');
    expect(cam3Input.value).toBe('2.2');
    expect(cam4Input.value).toBe('');
    expect(cam1Input.required).toBe(false);
    expect(cam4Input.required).toBe(true);

    expect(
      screen.getByText(
        '거치대 기둥을 늘 같은 길이로 펴고(테이프 표시 권장), 바꿨을 때만 다시 재세요',
      ),
    ).toBeTruthy();
    expect(screen.getByText('입력 필수')).toBeTruthy();
    expect(screen.getAllByText('지난 제출값')).toHaveLength(3);

    const submitButton = screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it('값 없는 카메라 높이를 채워 제출하면 요청 본문을 보내고 다음 기본값으로 반영한다', async () => {
    renderSetupPage();

    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));

    const cam4Input = screen.getByLabelText('카메라 4 높이 (m)') as HTMLInputElement;
    fireEvent.change(cam4Input, { target: { value: '2.35' } });

    const submitButton = screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    await pickNewModel();
    fireEvent.click(submitButton);
    await pressCaptureStart();

    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    expect(setupMock.submittedBodies[0]).toEqual({
      work_unit_id: 1,
      camera_heights_m: {
        cam_A: 2.25,
        cam_B: 2.3,
        cam_C: 2.2,
        cam_D: 2.35,
      },
    });

    // 제출한 높이가 다음 기본값 조회에도 반영되고 2단계로 넘어간다.
    await waitForCalibrationStep();
    const nextDefaults = await requestCameraHeightDefaults(api);
    expect(nextDefaults.all_present).toBe(true);
    expect(nextDefaults.camera_heights_m).toEqual({
      cam_A: 2.25,
      cam_B: 2.3,
      cam_C: 2.2,
      cam_D: 2.35,
    });
  });

  it('1단계 맵 방식은 늘 있고, 이전 맵이 없으면 재사용을 끄고 이유를 두 줄로 보이며 새 맵으로 다음이 mode 없이 세션을 만든다', async () => {
    renderSetupPage();
    const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
    const reuse = within(group).getByRole('radio', {
      name: /^이전 맵 재사용/,
    }) as HTMLButtonElement;
    const fresh = within(group).getByRole('radio', { name: /^새 맵 만들기/ });
    // 목업 현장은 이전 맵이 없다(reuse-check NO_SCENE): 재사용은 꺼지고 무엇이/어떻게 두 줄, 새 맵이 골라져 있다
    await waitFor(() => expect(reuse.disabled).toBe(true));
    const note = within(reuse).getByRole('note', { name: '이전 맵을 쓸 수 없는 이유' });
    expect(note.textContent).toContain('이전 맵이 없어요');
    expect(note.textContent).toContain('새 맵 만들기를 골라 주세요');
    expect(fresh.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();

    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));
    fireEvent.change(screen.getByLabelText('카메라 4 높이 (m)'), { target: { value: '2.35' } });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    // 새 맵은 mode 를 보내지 않는다(생략하면 서버가 NEW 로 본다)
    expect(Object.keys(setupMock.submittedBodies[0]!).sort()).toEqual([
      'camera_heights_m',
      'work_unit_id',
    ]);
    await waitForCalibrationStep();
  });

  it('이전 맵을 쓸 수 있어도 새 맵이 기본이고, 재사용을 고르면 다음이 mode REUSE 로 만들며 카메라 변화를 모르면 시작 뒤 확인한다고 한 줄 붙인다', async () => {
    setupMock = createSetupMock({
      cameraHeightsM: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
      reuseCheck: {
        available: true,
        blocked_reason: null,
        scene_version: 'scene-prev-1',
        camera_status: 'UNKNOWN',
        changed_cameras: [],
        camera_source: null,
      },
    });
    server.resetHandlers(...baseHandlers(), ...setupMock.handlers);
    renderSetupPage();
    const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
    const reuse = within(group).getByRole('radio', {
      name: /^이전 맵 재사용/,
    }) as HTMLButtonElement;
    const fresh = within(group).getByRole('radio', { name: /^새 맵 만들기/ });
    await waitFor(() => expect(reuse.disabled).toBe(false));
    // 카메라 각도가 바뀌어 있을 위험이 높아 재사용은 고를 때만 쓴다(S15P31A101-762): 새 맵이 먼저, 기본으로 골라져 있다
    const options = within(group).getAllByRole('radio');
    expect(options[0]).toBe(fresh);
    expect(fresh.getAttribute('aria-checked')).toBe('true');
    expect(fresh.textContent).toContain('기본 · 약 13분');
    expect(reuse.getAttribute('aria-checked')).toBe('false');
    expect(reuse.textContent).toContain('약 1~2분');
    expect(reuse.textContent).not.toContain('기본');
    expect(reuse.textContent).toContain('카메라가 그대로인지는 시작한 뒤 확인해요');
    fireEvent.click(reuse);
    await waitFor(() => expect(reuse.getAttribute('aria-checked')).toBe('true'));
    const cam4 = (await screen.findByLabelText('카메라 4 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam4.value).toBe('2.35'));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    // 재사용은 배경 촬영 창(「시작」)을 거치지 않고 바로 보낸다(S15P31A101-714). 이 옛 서버 응답은 워커 세션이라 그 뒤 화면은 예전과 같다
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    expect(setupMock.submittedBodies[0]).toMatchObject({ mode: 'REUSE' });
  });

  it('재사용을 고르면 최근 완료 맵을 날짜와 고르고, 추천 맵이 먼저 골라지며 어긋난 맵은 이유와 함께 꺼지고, 시작하면 바로 구역 단계로 간다', async () => {
    const candidate = (id: string, overrides: Record<string, unknown>) => ({
      setup_session_id: id,
      scene_version: `scene-${id}`,
      calibration_version: `cal-${id}`,
      // 2026-11-12 15:20(목, 한국 시간)
      completed_at_ms: Date.UTC(2026, 10, 12, 6, 20),
      camera_heights_m: { cam_A: 2.41, cam_B: 2.42, cam_C: 2.47, cam_D: 2.48 },
      status: 'MATCH' as const,
      reason: null,
      selectable: true,
      recommended: false,
      changed_cameras: [],
      shifted_cameras: [],
      unconfirmed_cameras: [],
      camera_source: null,
      ...overrides,
    });
    setupMock = createSetupMock({
      cameraHeightsM: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
      reuseCheck: {
        available: true,
        blocked_reason: null,
        scene_version: 'scene-old',
        camera_status: 'NOT_DETECTED',
        changed_cameras: [],
        camera_source: null,
        recommended_setup_session_id: 'old',
        candidates: [
          candidate('old', { recommended: true }),
          candidate('other', { completed_at_ms: Date.UTC(2026, 10, 13, 7, 31) }),
          candidate('moved', {
            status: 'CHANGED',
            selectable: false,
            changed_cameras: ['cam_B', 'cam_C'],
            camera_source: 'VIEW_MATCH',
          }),
          candidate('bad', {
            status: 'EXCLUDED',
            selectable: false,
            reason: 'CAMERA_CHECK_NOT_PASSED',
          }),
        ],
      },
    });
    server.resetHandlers(...baseHandlers(), ...setupMock.handlers);
    renderSetupPage();
    const maps = await screen.findByRole('radiogroup', { name: '재사용할 맵' });
    const options = within(maps).getAllByRole('radio') as HTMLButtonElement[];
    expect(options).toHaveLength(4);
    // 기본은 새 맵이라 맵 목록은 꺼져 있다. 재사용을 고르면 추천 맵이 골라진다(S15P31A101-762)
    expect(options[0]!.disabled).toBe(true);
    expect(options[0]!.getAttribute('aria-checked')).toBe('false');
    const group = screen.getByRole('radiogroup', { name: '맵 방식' });
    const reuse = within(group).getByRole('radio', {
      name: /^이전 맵 재사용/,
    }) as HTMLButtonElement;
    await waitFor(() => expect(reuse.disabled).toBe(false));
    fireEvent.click(reuse);
    await waitFor(() => expect(options[0]!.getAttribute('aria-checked')).toBe('true'));
    expect(options[0]!.textContent).toContain('11-12(목) 15:20');
    expect(options[0]!.textContent).toContain('추천');
    expect(options[0]!.textContent).toContain('카메라 높이 2.41·2.42·2.47·2.48 m');
    expect(options[2]!.disabled).toBe(true);
    expect(options[2]!.textContent).toContain(
      '위치나 방향이 그때와 다른 카메라: 카메라 2·카메라 3',
    );
    expect(options[3]!.disabled).toBe(true);
    expect(options[3]!.textContent).toContain('그날 카메라 확인을 통과하지 못한 맵이에요');

    // 다른 날 맵을 고르고 시작하면 그 맵을 실어 보내고, 끝난 재사용 세션이라 바로 구역 단계로 간다
    fireEvent.click(options[1]!);
    await waitFor(() => expect(options[1]!.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    expect(setupMock.submittedBodies[0]).toEqual({
      work_unit_id: expect.any(Number),
      mode: 'REUSE',
      reuse_setup_session_id: 'other',
    });
    expect(screen.queryByRole('dialog', { name: '배경 촬영' })).toBeNull();
    await waitFor(() => expect(currentStepText()).toContain('구역'));
  });

  it('카메라가 직전 세팅과 달라졌으면 재사용을 끄고 그 카메라를 보이며 새 맵이 골라진다(시작은 사용자가 누른다)', async () => {
    setupMock = createSetupMock({
      cameraHeightsM: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
      reuseCheck: {
        available: false,
        blocked_reason: 'CAMERA_CHANGED',
        scene_version: 'scene-prev-1',
        camera_status: 'CHANGED',
        changed_cameras: ['cam_B'],
        camera_source: 'TIER0_DRIFT',
      },
    });
    server.resetHandlers(...baseHandlers(), ...setupMock.handlers);
    renderSetupPage();
    await waitForCoverage();
    const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
    const reuse = within(group).getByRole('radio', {
      name: /^이전 맵 재사용/,
    }) as HTMLButtonElement;
    await waitFor(() => expect(reuse.disabled).toBe(true));
    expect(reuse.textContent).toContain('카메라 2의 위치나 방향이 직전 세팅과 달라졌어요');
    // 카메라 2 칸 배지와 「지금 할 일」도 같은 근거로 하나만 말한다(S15P31A101-691)
    const tile = screen.getByLabelText('카메라 2 영상').parentElement!;
    expect(within(tile).getByText('직전 보정과 달라짐')).toBeTruthy();
    expect(screen.getByTestId('setup-next-step').textContent).toContain(
      '카메라 2 위치나 방향이 직전 세팅과 달라졌어요',
    );
    expect(
      within(group)
        .getByRole('radio', { name: /^새 맵 만들기/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(setupMock.submittedBodies).toHaveLength(0);
  });

  it('세팅 시작이 409(SETUP_BLOCKED_BY_LIVE_WORK)로 거절되면 진행 중 작업 종료 안내와 작업 이동 링크를 제공한다', async () => {
    // 1) 서버 현재 응답(작업 정보 없음) -> 일반 문구 + /work 이동
    server.use(
      http.post('*/api/setup-sessions', () =>
        HttpResponse.json(
          {
            status: 409,
            code: 'SETUP_BLOCKED_BY_LIVE_WORK',
            detail: '같은 현장에 진행 중(IN_PROGRESS)인 작업이 있어 현장 세팅을 시작할 수 없습니다',
          },
          { status: 409 },
        ),
      ),
    );

    renderSetupPage(5);
    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));
    const cam4Input = screen.getByLabelText('카메라 4 높이 (m)') as HTMLInputElement;
    fireEvent.change(cam4Input, { target: { value: '2.35' } });
    await pickNewModel();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();

    const alert = await screen.findByTestId('setup-submit-error');
    expect(alert.textContent).toContain(
      '진행 중인 작업이 있어 세팅을 시작할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요',
    );
    fireEvent.click(within(alert).getByRole('button', { name: '진행 중인 작업으로 이동' }));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/work' });

    // 2) 서버 본문에 work_id · work_name 이 함께 오면 작업 이름을 포함한 문구와 해당 작업으로 이동
    navigateMock.mockReset();
    server.use(
      http.post('*/api/setup-sessions', () =>
        HttpResponse.json(
          {
            status: 409,
            code: 'SETUP_BLOCKED_BY_LIVE_WORK',
            detail: '같은 현장에 진행 중(IN_PROGRESS)인 작업이 있어 현장 세팅을 시작할 수 없습니다',
            work_id: 2,
            work_name: '배관 점검',
          },
          { status: 409 },
        ),
      ),
    );

    // 방식은 처음에 고른 것을 그대로 쓴다(다시 묻지 않는다).
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => {
      expect(screen.getByTestId('setup-submit-error').textContent).toContain(
        '진행 중인 작업(배관 점검)이 있어 세팅을 시작할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요',
      );
    });
    fireEvent.click(
      within(screen.getByTestId('setup-submit-error')).getByRole('button', {
        name: '진행 중인 작업으로 이동',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/work',
      search: { workUnitId: '2' },
    });
  });

  it('세팅 시작이 409(SETUP_WORKER_UNAVAILABLE)로 거절되면 GPU 서버 연결 안내만 보이고 작업 이동 링크는 없다', async () => {
    server.use(
      http.post('*/api/setup-sessions', () =>
        HttpResponse.json(
          {
            status: 409,
            code: 'SETUP_WORKER_UNAVAILABLE',
            detail: '현장 세팅(site_setup)을 처리할 활성 워커가 없습니다',
          },
          { status: 409 },
        ),
      ),
    );

    renderSetupPage(5);
    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));
    const cam4Input = screen.getByLabelText('카메라 4 높이 (m)') as HTMLInputElement;
    fireEvent.change(cam4Input, { target: { value: '2.35' } });
    await pickNewModel();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();

    const alert = await screen.findByTestId('setup-submit-error');
    expect(alert.textContent).toContain(
      'GPU 서버(분석 워커)가 연결돼 있지 않아 세팅을 시작할 수 없습니다',
    );
    expect(alert.textContent).not.toContain('진행 중인 작업');
    expect(within(alert).queryByRole('button', { name: '진행 중인 작업으로 이동' })).toBeNull();
  });

  it('쌍 등급·방향 안내 문구를 표시하고 4대가 연결되면 카메라마다 각도 양호를 보인다', async () => {
    renderSetupPage();

    await waitForCoverage();
    expect(
      screen.getAllByText('오른쪽으로 조금 돌려 주세요 (카메라 3–카메라 4)').length,
    ).toBeGreaterThan(0);
    // 쌍 등급은 목록 없이 지도의 연결선에만 보인다.
    const edges = within(screen.getByLabelText('카메라 쌍 연결 선'));
    expect(edges.getAllByLabelText(/충분$/).length).toBeGreaterThan(0);
    expect(edges.getAllByLabelText(/약함$/).length).toBeGreaterThan(0);
    // 마주 보는 쌍(1–3, 2–4)은 서버가 부족이라고 줘도 지도에 그리지 않는다.
    expect(edges.queryByLabelText(/카메라 1–카메라 3|카메라 2–카메라 4/)).toBeNull();
    expect(edges.queryByLabelText(/부족$/)).toBeNull();
    expect(screen.queryByRole('list', { name: '카메라 쌍 매칭 등급' })).toBeNull();

    // CONNECTED 상태로 바꾸면 카메라마다 "각도 양호" 와 "다음" 버튼을 보인다
    cleanup();
    setupMock.state.latestGuide = buildCoverageGuidePayload({
      connectivity: 'CONNECTED',
      guides: [],
    });
    renderSetupPage();

    await waitForCoverage();
    expect(screen.getAllByText('각도 양호').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '다음' })).toBeTruthy();
  });

  describe('옆 카메라 쌍 겹침이 부족하면 다음 전에 확인한다', () => {
    const pairOf = (a: string, b: string, grade: 'ENOUGH' | 'LACK') => ({
      a,
      b,
      raw_matches: null,
      inliers: null,
      inlier_ratio: null,
      grade,
      centroid_a: null,
      centroid_b: null,
    });
    /** 카메라 2–3 쌍이 부족한 응답과 높이가 모두 찬 상태로 세팅 화면을 연다. */
    async function openWithLackPair(lack: boolean) {
      setupMock = createSetupMock({
        cameraHeightsM: { cam_A: 2.2, cam_B: 2.2, cam_C: 2.2, cam_D: 2.2 },
        latestGuide: buildCoverageGuidePayload({
          guides: [],
          pairs: [
            pairOf('cam_A', 'cam_B', 'ENOUGH'),
            pairOf('cam_B', 'cam_C', lack ? 'LACK' : 'ENOUGH'),
            pairOf('cam_C', 'cam_D', 'ENOUGH'),
            pairOf('cam_D', 'cam_A', 'ENOUGH'),
          ],
        }),
      });
      server.resetHandlers(...baseHandlers(), ...setupMock.handlers);
      renderSetupPage();
      await pickNewModel();
      await waitForCoverage();
      await waitFor(() =>
        expect((screen.getByLabelText('카메라 4 높이 (m)') as HTMLInputElement).value).toBe('2.2'),
      );
    }

    it('위험이 있으면 오른쪽 카드에 알리고, 다음을 누르면 확인창이 먼저 뜨며 돌아가기는 세션을 만들지 않는다', async () => {
      await openWithLackPair(true);
      expect(screen.getByRole('alert').textContent).toContain(
        '카메라 2–카메라 3 겹침이 부족합니다',
      );
      expect(screen.getByTestId('setup-next-step').textContent).toContain(
        '카메라 2–카메라 3 겹침이 부족해요',
      );

      fireEvent.click(screen.getByRole('button', { name: '다음' }));
      const dialog = screen.getByRole('dialog', { name: '보정이 실패할 수 있어요' });
      expect(dialog.textContent).toContain(
        '카메라 2–카메라 3 겹침이 부족한 채로 보정을 시작합니다.',
      );
      expect(setupMock.submittedBodies).toHaveLength(0);

      fireEvent.click(within(dialog).getByRole('button', { name: '돌아가기' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(setupMock.submittedBodies).toHaveLength(0);
    });

    it('확인창에서 그대로 진행하면 기존 세션 만들기를 부른다', async () => {
      await openWithLackPair(true);
      fireEvent.click(screen.getByRole('button', { name: '다음' }));
      fireEvent.click(
        within(screen.getByRole('dialog', { name: '보정이 실패할 수 있어요' })).getByRole(
          'button',
          {
            name: '그대로 진행',
          },
        ),
      );
      await pressCaptureStart();
      await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
      expect(setupMock.submittedBodies[0]).toMatchObject({
        work_unit_id: 1,
        camera_heights_m: { cam_A: 2.2, cam_B: 2.2, cam_C: 2.2, cam_D: 2.2 },
      });
      await waitForCalibrationStep();
      expect(screen.queryByRole('dialog', { name: '보정이 실패할 수 있어요' })).toBeNull();
    });

    it('위험이 없으면 확인창 없이 바로 세션을 만든다', async () => {
      await openWithLackPair(false);
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '다음' }));
      expect(screen.queryByRole('dialog', { name: '보정이 실패할 수 있어요' })).toBeNull();
      await pressCaptureStart();
      await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    });

    it('이어받을 세션을 찾는 동안에는 1단계를 그리지 않아 확인창이 뜨지 않고, 1단계로 돌아와도 다시 뜨지 않는다', async () => {
      await openWithLackPair(true);
      fireEvent.click(screen.getByRole('button', { name: '다음' }));
      fireEvent.click(
        within(screen.getByRole('dialog', { name: '보정이 실패할 수 있어요' })).getByRole(
          'button',
          { name: '그대로 진행' },
        ),
      );
      await pressCaptureStart();
      await waitFor(() => expect(setupMock.sessions.size).toBe(1));
      const sessionId = [...setupMock.sessions.keys()][0]!;
      setupMock.failSession(sessionId, 'VALIDATION_REJECTED');
      cleanup();
      resetSetupFlowStore();

      // 이어받을 세션 조회가 늦게 끝나도록 붙잡아 둔다.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get('*/api/work-units/:id', async () => {
          await held;
          return HttpResponse.json({ work_id: '1', active_setup_session_id: sessionId });
        }),
      );
      renderSetupPage();
      // 찾는 동안은 단계 줄도 1단계 본문도 없다(1단계가 잠깐 비치지 않는다).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(screen.queryByRole('list', { name: '보정 단계' })).toBeNull();
      expect(screen.queryByLabelText('카메라 4 높이 (m)')).toBeNull();

      release();
      const failure = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(within(failure).getByRole('button', { name: '카메라 연결 관리로' }));
      expect(await screen.findByLabelText('카메라 2 높이 (m)')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    }, 20_000);
  });

  it('STALE·영상 없음(NO_VIDEO)·계산 실패(UNKNOWN)여도 카메라별 상태를 보이고 다음으로 가는 것을 막지 않는다', async () => {
    setupMock = createSetupMock({
      cameraHeightsM: { cam_A: 2.2, cam_B: 2.2, cam_C: 2.2, cam_D: 2.2 },
      guideStatus: 'STALE',
      guideStale: true,
      latestGuide: buildCoverageGuidePayload({
        connectivity: 'UNKNOWN',
        cameraStatuses: { cam_B: 'NO_VIDEO' },
        guides: [
          {
            camera_id: 'cam_B',
            pair: ['cam_B', 'cam_C'],
            direction: 'NONE',
            magnitude: 'NONE',
            reason_code: 'NO_OVERLAP_VISIBLE',
          },
        ],
      }),
    });
    server.resetHandlers(...baseHandlers(), ...setupMock.handlers);

    renderSetupPage();

    await waitForCoverage();
    // 카메라별 상태·안내는 「자세히 · 카메라 상태」 행에 보인다. 서버가 오래됐다고 한 결과는 배지 근거로 쓰지 않아
    // 영상 없음이어도 끊김으로 단정하지 않고 「확인 중」이다(S15P31A101-691)
    const cameraPanel = within(cameraDetails());
    const cam2 = cameraPanel.getByText('카메라 2', { selector: 'b' }).closest('li')!;
    expect(within(cam2).getByText('확인 중')).toBeTruthy();
    expect(
      cameraPanel.getByText(
        '겹치는 곳이 없습니다. 각도를 조정하거나 겹치는 곳에 무늬 있는 물건을 두세요 (카메라 2–카메라 3)',
      ),
    ).toBeTruthy();

    const proceedButton = screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    await waitFor(() => expect(proceedButton.disabled).toBe(false));

    // 서버 오류(계산 실패)여도 다음으로 갈 수 있다
    cleanup();
    setupMock.state.guideError = true;
    renderSetupPage();

    await screen.findByLabelText('카메라 1 높이 (m)');
    const proceedOnFailure = screen.getByRole('button', {
      name: '다음',
    }) as HTMLButtonElement;
    await waitFor(() => expect(proceedOnFailure.disabled).toBe(false));
    await pickNewModel();
    fireEvent.click(proceedOnFailure);
    await pressCaptureStart();

    await waitForCalibrationStep();
  });
});

const POLL_WAIT = { timeout: 8_000 };

/** cam_D 높이를 채워 세팅을 시작하고 보정·생성 화면(2단계)의 세션 id 를 돌려준다. */
async function startSetupSession() {
  const view = renderSetupPage();
  const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
  await waitFor(() => expect(cam1Input.value).toBe('2.25'));
  fireEvent.change(screen.getByLabelText('카메라 4 높이 (m)'), { target: { value: '2.35' } });
  await pickNewModel();
  fireEvent.click(screen.getByRole('button', { name: '다음' }));
  await pressCaptureStart();
  await waitFor(() => expect(setupMock.sessions.size).toBe(1));
  const sessionId = [...setupMock.sessions.keys()][0]!;
  await waitForCalibrationStep();
  await waitForTrackedSession(sessionId);
  return { ...view, sessionId };
}

/** 이 시험에서 나가는 요청의 경로를 모은다(시험이 끝나면 listener 는 afterEach 가 걷는다). */
function trackRequestedPaths() {
  const paths: string[] = [];
  server.events.on('request:start', ({ request }) => paths.push(new URL(request.url).pathname));
  return paths;
}

/** 미리보기 맵만 있는 세션(정밀 3D 맵을 굽는 중): 보정·생성의 '다음' 은 아직 꺼져 있다. */
const PREVIEW_PATCH = {
  stage: 'PREVIEW_AND_VLM_DRAFT',
  status: 'PREVIEW_AND_VLM_DRAFT',
  progress_pct: 92,
  preview_scene_version: 'scene-preview-1',
  calibration_version: 'cal-8',
} as const;

/** 정밀 3D 맵까지 끝난 세션: 보정·생성의 '다음' 이 켜지고 구역 단계로 갈 수 있다. */
const FINAL_PATCH = {
  stage: 'COMPLETED',
  status: 'COMPLETED',
  progress_pct: 100,
  preview_scene_version: 'scene-preview-1',
  scene_version: 'scene-setup-final-1',
  calibration_version: 'cal-8',
} as const;

/** 세팅 완료를 이미 한 세션의 완료 시각. */
const SETUP_COMPLETED_AT_MS = 1_800_000_000_000;

/** 카메라 2번 높이만 41cm 어긋난 높이 검산(서버 height_checks). */
const HEIGHT_MISMATCH = {
  height_checks: {
    cam_A: {
      input_height_m: 2.25,
      restored_height_m: 2.26,
      difference_cm: 1,
      within_tolerance: true,
      guidance: null,
    },
    cam_B: {
      input_height_m: 2.3,
      restored_height_m: 2.71,
      difference_cm: 41,
      within_tolerance: false,
      guidance: 'cam_B 높이를 다시 재서 입력해 주세요',
    },
  },
} as const;

/** 3D 공간을 만든 직후 워커가 카메라 2 가 12 cm 높게 보인다며 높이 확인을 기다리는 세션(-690). */
const HEIGHT_CHECK_WAITING: Partial<SetupSessionResponse> = {
  status: 'INITIAL_POSE_AND_WORLD',
  stage: 'INITIAL_POSE_AND_WORLD',
  progress_pct: 39,
  paused_reason: 'HEIGHT_CHECK',
  height_review: {
    status: 'AWAITING_CONFIRMATION',
    max_relative_diff: 0.03,
    wait_s: 180,
    camera_heights_m: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
    cameras: {
      cam_A: { restored_height_m: 2.26, difference_cm: 1, relative_diff: 0.0044, verdict: 'OK' },
      cam_B: { restored_height_m: 2.42, difference_cm: 12, relative_diff: 0.0522, verdict: 'HIGH' },
      cam_C: { restored_height_m: 2.19, difference_cm: -1, relative_diff: -0.0045, verdict: 'OK' },
      cam_D: { restored_height_m: 2.35, difference_cm: 0, relative_diff: 0, verdict: 'OK' },
    },
  },
};

/** 카메라 연결 관리(1단계)로 돌아온 화면에서 cam_B 높이를 2.7 로 고친다('다시 시도' 직전까지). */
async function editCam2Height() {
  const cam2Input = (await screen.findByLabelText('카메라 2 높이 (m)')) as HTMLInputElement;
  expect(cam2Input.value).toBe('2.3');
  fireEvent.change(cam2Input, { target: { value: '2.7' } });
}

/** 높이 불일치 안내를 띄우고 '카메라 다시 맞추기' 로 1단계 높이 칸에 돌아와 cam_B 높이를 2.7 로 고친다. */
async function fixCam2Height(sessionId: string, patch: Partial<SetupSessionResponse>) {
  setupMock.updateSession(sessionId, { ...HEIGHT_MISMATCH, ...patch });
  const warning = await screen.findByRole('alert', { name: '카메라 높이 불일치 경고' }, POLL_WAIT);
  expect(warning.textContent).toContain('카메라 2 높이를 다시 재서 입력해 주세요');
  fireEvent.click(screen.getByRole('button', { name: '카메라 다시 맞추기' }));
  await editCam2Height();
}

/** 3D 맵이 다 만들어져 켜진 '다음' 을 눌러 구역 단계에 들어선다(맵 보강 창은 끼어들지 않는다, S15P31A101-691). */
async function enterZoneStep() {
  const next = (await screen.findByRole('button', { name: '다음' })) as HTMLButtonElement;
  await waitFor(() => expect(next.disabled).toBe(false), POLL_WAIT);
  fireEvent.click(next);
  expect(screen.queryByRole('dialog', { name: '맵 보강 촬영' })).toBeNull();
}

/** 구역 단계에 들어서서 구역 편집 도구 대역을 돌려준다. */
async function goToZoneStep() {
  await enterZoneStep();
  return screen.findByTestId('zones-page-stub', undefined, POLL_WAIT);
}

/** 구역 단계 맨 오른쪽 단추(작업 관리로). */
const finishButton = () => screen.getByRole('button', { name: '작업 관리로' }) as HTMLButtonElement;

const progressNow = () =>
  Number(screen.getByRole('progressbar', { name: '세팅 진행률' }).getAttribute('aria-valuenow'));
const stageStates = () =>
  within(screen.getByRole('list', { name: '보정·생성 단계' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-status'));

describe('설치 · 보정 2단계(보정·생성)', () => {
  it('보정·생성에 진행률과 경과 시간을 보이고 5단계 막대가 서버 진행 상태를 따라간다', async () => {
    const { sessionId } = await startSetupSession();

    expect(progressNow()).toBe(0);
    expect(screen.getByText(/경과 \d+분 \d{2}초/)).toBeTruthy();
    expect(screen.getByText(/워커의 진행 정보를 기다리는 중/)).toBeTruthy();
    expect(stageStates()).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);

    setupMock.updateSession(sessionId, {
      stage: 'JOINT_BA_AND_VERIFY',
      status: 'JOINT_BA_AND_VERIFY',
      progress_pct: 40,
    });

    // 서버 값은 바로 반영되고(시간으로 채우는 값은 그보다 앞서지만 다음 단계 끝값 65 에 닿지 않는다).
    await waitFor(() => expect(progressNow()).toBeGreaterThanOrEqual(40), POLL_WAIT);
    expect(progressNow()).toBeLessThan(65);
    expect(stageStates()).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
  }, 20_000);

  it('보정·생성의 현재 시도 중단은 확인 창 뒤 세션을 취소하고 1단계로 돌아가며, 다른 방식으로 다음을 누르면 그 방식으로 다시 시도한다', async () => {
    const { sessionId } = await startSetupSession();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: '현재 시도 중단' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(setupMock.sessions.get(sessionId)?.status).toBe('FAILED'));
    await waitFor(() => expect(currentStepText()).toBe('1카메라 연결 관리'), POLL_WAIT);
    expect(navigateMock).not.toHaveBeenCalled();
    // 실패·취소한 시도가 있어도 맵 방식을 다시 고를 수 있다
    const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
    fireEvent.click(within(group).getByRole('radio', { name: /^새 맵 만들기/ }));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.retryRequests[0]).toMatchObject({ sessionId, mode: 'NEW' });
    await waitForTrackedSession(setupMock.retryRequests[0]!.retriedSessionId);
    confirmSpy.mockRestore();
  }, 30_000);

  it('이전 맵 재사용이 카메라 변화로 멈추면 무엇이/어떻게 두 줄과 새 맵으로 다시 하기를 보이고, 누르면 mode NEW 로 다시 시도한다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      stage: 'FAILED',
      status: 'FAILED',
      progress_pct: 62,
      requested_mode: 'REUSE',
      mode: 'REUSE',
      failure_code: 'REUSE_WORLD_REJECTED',
      failure_message: '카메라 cam_C 이(가) 직전 세팅과 달라져 이전 맵을 쓸 수 없습니다',
      world_anchor: {
        accepted: false,
        reason: 'CENTER_RESIDUAL_EXCEEDED',
        changed_cameras: ['cam_C'],
      },
    });
    const alert = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    expect(alert.textContent).toContain('카메라 3의 위치나 방향이 직전 세팅과 달라졌어요');
    expect(alert.textContent).toContain('새 맵으로 다시 하세요.');
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: '새 맵으로 다시 하기' }));
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.retryRequests[0]).toMatchObject({ sessionId, mode: 'NEW' });
    await waitForTrackedSession(setupMock.retryRequests[0]!.retriedSessionId);
  }, 30_000);

  it('실패하면 어느 단계에서 멈췄는지와 원인·해결을 보이고, 다시 시도하면 retry 요청 뒤 새 세션을 추적한다', async () => {
    const { sessionId } = await startSetupSession();

    setupMock.updateSession(sessionId, {
      stage: 'FAILED',
      status: 'FAILED',
      progress_pct: 45,
      failure_code: 'RECONSTRUCT_FAILED',
      failure_message: '3D 공간 복원에 실패했습니다(시험)',
    });

    const alert = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    // 표에 없는 코드는 폴백 안내를 보이고 서버 코드·메시지 원문은 화면에 쓰지 않는다.
    expect(alert.textContent).toContain('카메라 정밀 보정 단계에서 멈췄어요');
    expect(alert.textContent).toContain('서버에서 세팅을 끝내지 못했어요');
    expect(alert.textContent).not.toContain('RECONSTRUCT_FAILED');
    expect(alert.textContent).not.toContain('3D 공간 복원에 실패했습니다(시험)');
    expect(stageStates()).toEqual(['done', 'done', 'failed', 'upcoming', 'upcoming']);
    expect(screen.getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));

    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    const retried = setupMock.retryRequests[0]!;
    expect(retried.sessionId).toBe(sessionId);
    await waitForTrackedSession(retried.retriedSessionId);
    expect(screen.queryByRole('alert', { name: '세팅 실패 안내' })).toBeNull();
    // 새 세션은 0%부터다(서버 값이 내려가면 표시값도 내려간다).
    await waitFor(() => expect(progressNow()).toBe(0));
  }, 20_000);

  it('같은 상태로 다시 해도 소용없는 실패는 다시 시도 없이 카메라 연결 관리로만 돌려보낸다(카메라 쌍은 캠N–캠M 으로)', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.failSession(sessionId, 'INSUFFICIENT_FEATURES');

    const alert = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    expect(alert.textContent).toContain('카메라 정밀 보정 단계에서 멈췄어요');
    expect(alert.textContent).toContain(
      '옆 카메라 카메라 2–카메라 3 사이에 같이 보이는 곳이 적어요',
    );
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: '카메라 연결 관리로' }));
    expect(await screen.findByLabelText('카메라 2 높이 (m)')).toBeTruthy();
    expect(screen.queryByRole('alert', { name: '세팅 실패 안내' })).toBeNull();
  }, 20_000);

  it('높이 불일치 안내는 어느 카메라인지 보이고, 진행 중이면 세션을 취소한 뒤 고친 높이로 재시도한다', async () => {
    const { sessionId } = await startSetupSession();

    await fixCam2Height(sessionId, {
      stage: 'JOINT_BA_AND_VERIFY',
      status: 'JOINT_BA_AND_VERIFY',
      progress_pct: 62,
    });
    expect(
      screen.getByRole('alert', { name: '카메라 높이 불일치 수정 안내' }).textContent,
    ).toContain('카메라 2');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await pressCaptureStart();

    // 서버 retry 는 실패한 세션만 받으므로 진행 중인 세션은 먼저 취소(→ FAILED)한 뒤 재시도한다.
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.sessions.get(sessionId)?.failure_code).toBe('CANCELLED_BY_ADMIN');
    expect(setupMock.retryRequests[0]!.sessionId).toBe(sessionId);
    expect(setupMock.retryRequests[0]!.body.camera_heights_m?.cam_B).toBe(2.7);
    await waitForTrackedSession(setupMock.retryRequests[0]!.retriedSessionId);
    expect(screen.getByRole('list', { name: '보정·생성 단계' })).toBeTruthy();
  }, 20_000);

  it('높이 불일치가 있는 채 끝난 세션은 고친 높이로 새 세션을 시작한다(서버 retry 는 실패한 세션만 받는다)', async () => {
    const { sessionId } = await startSetupSession();

    await fixCam2Height(sessionId, { stage: 'COMPLETED', status: 'COMPLETED', progress_pct: 100 });
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await pressCaptureStart();

    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(2));
    expect(setupMock.submittedBodies[1]!.camera_heights_m?.cam_B).toBe(2.7);
    expect(setupMock.retryRequests).toHaveLength(0);
    expect(setupMock.sessions.size).toBe(2);
    expect(screen.queryByRole('alert', { name: '카메라 높이 불일치 수정 안내' })).toBeNull();
  }, 20_000);

  it('첫 보정 거부는 같은 높이와 새 맵으로 바로 재시도하고 같은 쌍의 두 번째 거부에만 점검을 안내한다', async () => {
    const { sessionId } = await startSetupSession();
    const heights = setupMock.sessions.get(sessionId)!.camera_heights_m;
    setupMock.failSession(sessionId, 'VALIDATION_REJECTED');
    const first = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    expect(first.textContent).not.toContain('거치대');
    fireEvent.click(within(first).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.retryRequests[0]!.body).toEqual({ camera_heights_m: heights });
    expect(setupMock.retryRequests[0]!.mode).toBe('NEW');
    const nextId = setupMock.retryRequests[0]!.retriedSessionId;
    await waitForTrackedSession(nextId);
    setupMock.failSession(nextId, 'VALIDATION_REJECTED');
    const second = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    await waitFor(() => expect(second.textContent).toContain('두 번 연속'));
    expect(second.textContent).toContain('거치대');
  }, 20_000);

  it('실패한 세션은 카메라 연결 관리로 돌아가 취소 없이 고친 높이로 곧바로 재시도한다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.failSession(sessionId, 'VALIDATION_REJECTED');

    const alert = await screen.findByRole('alert', { name: '세팅 실패 안내' }, POLL_WAIT);
    expect(alert.textContent).toContain('카메라 정밀 보정 단계에서 멈췄어요');
    expect(alert.textContent).toContain(
      '보정한 뒤 오히려 어긋난 카메라 쌍이 있어요 (카메라 1–카메라 2, 카메라 3–카메라 4)',
    );
    // 실패 중에는 높이 불일치 안내·카메라 다시 맞추기 단추를 따로 보이지 않는다.
    expect(screen.queryByRole('button', { name: '카메라 다시 맞추기' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: '카메라 연결 관리로' }));
    await editCam2Height();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await pressCaptureStart();

    // 같은 세션의 서버 retry 라서 방식을 다시 고르지 않는다.
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.retryRequests[0]!.body.camera_heights_m?.cam_B).toBe(2.7);
    expect(setupMock.sessions.get(sessionId)?.failure_code).toBe('VALIDATION_REJECTED');
    expect(setupMock.submittedBodies).toHaveLength(1);
  }, 20_000);

  it('높이 확인을 기다리면(paused_reason HEIGHT_CHECK) 높이 입력 창을 띄우고, 고친 값으로 같은 세션을 이어 간다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, HEIGHT_CHECK_WAITING);

    const dialog = await screen.findByRole('dialog', { name: '카메라 높이 확인' }, POLL_WAIT);
    expect(within(dialog).getByRole('status').textContent).toContain(
      '카메라 2 높이가 다른 카메라와 맞지 않습니다',
    );
    expect(dialog.textContent).toContain('다른 카메라보다 약 12 cm 높게 보임');
    expect(dialog.textContent).toContain('맞음');
    expect(dialog.textContent).toContain('약 3분 안에 답하지 않으면 입력한 높이로 진행합니다.');
    // 멈춤 안내(카메라 연결 관리로)는 창이 맡으므로 따로 보이지 않는다
    expect(screen.queryByRole('alert', { name: '세팅 멈춤 안내' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: '실측이 맞음 · 이대로 진행' })).toBeTruthy();

    const cam2 = within(dialog).getByLabelText('카메라 2 높이 (m)') as HTMLInputElement;
    expect(cam2.value).toBe('2.3');
    fireEvent.change(cam2, { target: { value: '2.42' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '고친 값으로 진행' }));

    // 재시도·취소 없이 같은 세션이 고친 높이로 이어 가고 창이 닫힌다
    await waitFor(() => expect(setupMock.sessions.get(sessionId)?.paused_reason).toBeNull());
    const resumed = setupMock.sessions.get(sessionId)!;
    expect(resumed.height_decision?.decision).toBe('CORRECTED');
    expect(resumed.camera_heights_m.cam_B).toBe(2.42);
    expect(setupMock.retryRequests).toHaveLength(0);
    expect(setupMock.sessions.size).toBe(1);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '카메라 높이 확인' })).toBeNull(),
    );
  }, 20_000);

  it('「실측이 맞음」으로 진행하면 같은 높이로 이어 가고, 뒤 결과 화면은 높이를 다시 고치라고 하지 않는다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, HEIGHT_CHECK_WAITING);
    const dialog = await screen.findByRole('dialog', { name: '카메라 높이 확인' }, POLL_WAIT);
    fireEvent.click(within(dialog).getByRole('button', { name: '실측이 맞음 · 이대로 진행' }));
    await waitFor(() =>
      expect(setupMock.sessions.get(sessionId)?.height_decision?.decision).toBe('CONFIRMED'),
    );
    expect(setupMock.sessions.get(sessionId)?.camera_heights_m.cam_B).toBe(2.3);

    // 확인한 높이로 나온 검산이 5 cm 넘게 달라도 「카메라 다시 맞추기」를 띄우지 않고 거치대 문구는 「자세히」 안에만 둔다
    setupMock.updateSession(sessionId, {
      ...HEIGHT_MISMATCH,
      height_review: { ...HEIGHT_CHECK_WAITING.height_review!, status: 'CONFIRMED' },
    });
    const details = await screen.findByRole('group', { name: '카메라 높이 자세히' }, POLL_WAIT);
    expect(details.hasAttribute('open')).toBe(false);
    expect(screen.queryByRole('button', { name: '카메라 다시 맞추기' })).toBeNull();
    expect(screen.queryByRole('alert', { name: '카메라 높이 불일치 경고' })).toBeNull();
  }, 20_000);

  it('카메라 확인은 맵 전에 큰 걷기 창에서 「걷기 시작」으로 시작하고, 표본 부족이면 확인만 다시가 주 단추이며 통과하면 닫힌다(-687)', async () => {
    const { sessionId } = await startSetupSession();
    const cams = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
    const attempt = (no: number) => ({ no, id: `l-${no}`, started_at_ms: 1, expires_at_ms: 2 });
    setupMock.updateSession(sessionId, {
      status: 'JOINT_BA_AND_VERIFY',
      stage: 'JOINT_BA_AND_VERIFY',
      progress_pct: 65,
      calibration_version: 'cal-687',
      camera_check: {
        ...buildCameraCheck(cams, 'cal-687', 'AWAITING_START'),
        user_wait: { until_ms: 1, wait_s: 400 },
      },
      camera_check_passed: false,
      camera_check_phase: 'AWAITING_START',
      paused_reason: 'CAMERA_CHECK',
    });

    const dialog = await screen.findByRole('dialog', { name: '카메라 확인' }, POLL_WAIT);
    // 걷기 전 안내는 걷는 방법 목록으로 보인다(S15P31A101-763: 한 사람·방 가운데·옆 쌍·60~90초)
    expect(within(dialog).getByRole('status').textContent).toContain('아래처럼 걸으면');
    expect(within(dialog).getByRole('list', { name: '걷는 방법' }).textContent).toContain(
      '60~90초',
    );
    expect(dialog.textContent).toContain('약 7분 안에 시작하지 않으면');
    // 보정 멈춤 안내(카메라 연결 관리로)는 띄우지 않는다. 걷는 동안 실수로 닫히지 않는다
    expect(screen.queryByRole('alert', { name: '세팅 멈춤 안내' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '카메라 확인' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '걷기 시작' }));
    await waitFor(() =>
      expect(setupMock.sessions.get(sessionId)?.camera_check_request?.attempt).toBe(1),
    );

    // 시도 1 이 카메라 4 표본 부족으로 끝나면 같은 창에 안내하고 「확인만 다시(30초)」 가 주 단추다
    const shortage = buildCameraCheck(cams, 'cal-687', 'INCOMPLETE', 70);
    // 워커는 관측 수가 모자란 카메라에 FEW_SAMPLES 를 단다(관측이 찼으면 재투영 표본 부족 안내, S15P31A101-763)
    shortage.cameras.cam_D!.observed_views = 10;
    setupMock.updateSession(sessionId, {
      camera_check: {
        ...shortage,
        attempt: attempt(1),
        user_wait: { until_ms: 1, wait_s: 300 },
        problems: [
          {
            kind: 'CAMERA',
            id: 'cam_D',
            camera_ids: ['cam_D'],
            reason: 'FEW_SAMPLES',
            message: 'x',
          },
        ],
      },
      camera_check_phase: 'RETRY_WAIT',
      paused_reason: 'CAMERA_CHECK',
    });
    const retryDialog = await screen.findByRole('dialog', { name: '카메라 확인' });
    expect((await within(retryDialog).findByRole('alert', undefined, POLL_WAIT)).textContent).toBe(
      '카메라 4에서 사람이 충분히 보이지 않았습니다',
    );
    expect(within(retryDialog).getByRole('status').textContent).toContain(
      '표시된 구간을 지나며 30초만 다시 걸어 주세요',
    );
    expect(within(retryDialog).getByRole('button', { name: '현재 시도 중단' })).toBeTruthy();
    fireEvent.click(within(retryDialog).getByRole('button', { name: '확인만 다시(30초)' }));
    await waitFor(() =>
      expect(setupMock.sessions.get(sessionId)?.camera_check_request?.attempt).toBe(2),
    );
    // 보정은 그대로다(다시 시도·새 세션 없음)
    expect(setupMock.retryRequests).toHaveLength(0);
    expect(setupMock.sessions.size).toBe(1);

    setupMock.updateSession(sessionId, {
      camera_check: { ...buildCameraCheck(cams, 'cal-687', 'PASSED'), attempt: attempt(2) },
      camera_check_passed: true,
      camera_check_phase: 'PASSED',
      paused_reason: null,
    });
    await waitFor(
      () => expect(screen.queryByRole('dialog', { name: '카메라 확인' })).toBeNull(),
      POLL_WAIT,
    );
  }, 20_000);

  it('끝난 세션을 고친 높이로 새로 시작할 때는 1단계에서 고른 방식으로 바로 만든다(따로 묻는 창 없음)', async () => {
    const { sessionId } = await startSetupSession();

    await fixCam2Height(sessionId, { stage: 'COMPLETED', status: 'COMPLETED', progress_pct: 100 });
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await pressCaptureStart();

    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(2));
    expect(screen.queryByRole('dialog', { name: '배경 촬영' })).toBeTruthy();
  }, 20_000);

  it('보정·생성은 정밀 3D 맵이 다 만들어져야 다음이 켜지고(미리보기 맵만으로는 꺼짐) 저절로 구역으로 넘어가지 않으며 처음부터 다시 단추는 없다', async () => {
    const { sessionId } = await startSetupSession();

    const steps = within(screen.getByRole('list', { name: '보정 단계' })).getAllByRole('listitem');
    expect(steps[1]!.textContent).toBe('2보정·생성');
    expect(steps[1]!.getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('list', { name: '보정·생성 단계' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '검증 지점' })).toBeNull();
    // 배경을 찍는 동안은 배경 촬영 창이 카메라 영상을 띄우고 아래 칸의 영상은 내린다(-686). 다 찍으면 창이 저절로 닫힌다.
    expect(screen.getByRole('dialog', { name: '배경 촬영' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '카메라 시야 · 실시간 영상' })).toBeNull();
    setupMock.updateSession(sessionId, {
      stage: 'INITIAL_POSE_AND_WORLD',
      status: 'INITIAL_POSE_AND_WORLD',
      progress_pct: 20,
    });
    await waitFor(
      () => expect(screen.queryByRole('dialog', { name: '배경 촬영' })).toBeNull(),
      POLL_WAIT,
    );
    // 왼쪽 칸은 「카메라 영상」 탭(영상 4칸, 배지 없음)이고 3D 미리보기 탭은 아직 꺼져 있다(S15P31A101-691)
    expect(screen.getByRole('tab', { name: '카메라 영상' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getAllByLabelText(/^카메라 \d 영상$/)).toHaveLength(4);
    expect((screen.getByRole('tab', { name: '3D 미리보기' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByTestId('setup-preview-viewport')).toBeNull();
    expect(screen.queryByText('PROVISIONAL')).toBeNull();
    expect(screen.queryByRole('button', { name: '보정 확정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '구역으로' })).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true);

    // 미리보기 맵이 도착해도 정밀 3D 맵을 굽는 동안은 꺼져 있고 이유를 단추 title 로 알린다.
    setupMock.updateSession(sessionId, {
      ...PREVIEW_PATCH,
      stage: 'BAKING_TEXTURE',
      status: 'BAKING_TEXTURE',
    });
    // 미리보기 맵이 와도 카메라 영상은 그대로이고, 3D 는 탭을 눌러야 보인다
    await waitForPreviewTab();
    expect(screen.queryByTestId('setup-preview-viewport')).toBeNull();
    expect(screen.getAllByLabelText(/^카메라 \d 영상$/)).toHaveLength(4);
    await openPreviewTab();
    expect(screen.getByTestId('setup-preview-viewport')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^카메라 \d 영상$/)).toHaveLength(0);
    const next = () => screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    expect(next().title).toBe('3D 맵을 다 만들면 넘어갈 수 있어요');
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();

    // 정밀 3D 맵이 끝나면 켜지지만 저절로 넘어가지는 않는다.
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await waitFor(() => expect(next().disabled).toBe(false), POLL_WAIT);
    expect(next().title).toBe('');
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
    expect(steps[1]!.getAttribute('aria-current')).toBe('step');

    // '다음' 은 맵 보강 창 없이 바로 구역 단계로 간다(보강은 「자세히 · 맵 보강」에서만, S15P31A101-691)
    fireEvent.click(next());
    expect(screen.queryByRole('dialog', { name: '맵 보강 촬영' })).toBeNull();
    expect(await screen.findByTestId('zones-page-stub')).toBeTruthy();
    expect(steps[2]!.getAttribute('aria-current')).toBe('step');
    expect(steps[1]!.getAttribute('aria-current')).toBeNull();
  }, 20_000);

  it('맵 보강 촬영은 「자세히 · 맵 보강」에서 열고, 창의 건너뛰기는 창만 닫아 맵 완성 전에는 구역 단계로 가지 않는다(S15P31A101-691)', async () => {
    const { sessionId } = await startSetupSession();
    expect(screen.queryByRole('group', { name: '맵 보강 자세히' })).toBeNull();
    setupMock.updateSession(sessionId, {
      ...PREVIEW_PATCH,
      stage: 'BAKING_TEXTURE',
      status: 'BAKING_TEXTURE',
    });
    const details = await screen.findByRole('group', { name: '맵 보강 자세히' }, POLL_WAIT);
    fireEvent.click(within(details).getByRole('button', { name: '맵 보강 촬영' }));
    const dialog = await screen.findByRole('dialog', { name: '맵 보강 촬영' });
    fireEvent.click(within(dialog).getByRole('button', { name: '건너뛰기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '맵 보강 촬영' })).toBeNull());
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
    expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);

  it('머리줄과 3D 칸 제목에 세션 id·보정 버전·Scene 버전 같은 코드 글을 보이지 않는다', async () => {
    const { sessionId } = await startSetupSession();
    const hiddenCodes = [sessionId, '세션 019a', 'cal-8', 'scene-preview', 'scene-setup-final'];

    // 보정·생성: 1단계 안내 글도, 방금 만든 세션 id 도 없다.
    expect(screen.queryByText('세팅 1단계 · 카메라 확인')).toBeNull();
    expect(pageText()).not.toContain(sessionId);
    expect(pageText()).not.toContain('세션 019a');

    // 서버가 보정 버전·미리보기 Scene 을 알려 줘도 3D 칸 이름에는 맵 단계 이름만 나온다.
    setupMock.updateSession(sessionId, { ...PREVIEW_PATCH });
    await openPreviewTab();
    expect(screen.getByLabelText('미리보기 맵')).toBeTruthy();
    for (const code of hiddenCodes) expect(pageText()).not.toContain(code);

    // 구역 단계(정밀 3D 맵이 끝난 뒤): 3D 칸 제목은 맵 단계 이름뿐이다.
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    expect(await goToZoneStep()).toBeTruthy();
    expect(screen.getByRole('heading', { name: '정밀 3D 맵' })).toBeTruthy();
    for (const code of hiddenCodes) expect(pageText()).not.toContain(code);
  }, 20_000);

  it('이 세션의 미리보기 맵을 버전으로 받아(/view, 지금 관제 Scene 과 무관) 왼쪽에 3D 미리보기를 직접 그리고 오른쪽에 진행 카드와 결과 표를 둔다', async () => {
    const { sessionId } = await startSetupSession();
    // 1단계의 이전 맵 재사용 판정(reuse-check)은 세션을 시작하기 전 일이라 세지 않는다.
    const requested = trackRequestedPaths();
    setupMock.updateSession(sessionId, { ...PREVIEW_PATCH, ...HEIGHT_MISMATCH });

    await openPreviewTab();
    const viewport = await screen.findByTestId('setup-preview-viewport', undefined, POLL_WAIT);
    expect(await within(viewport).findByTestId('viewer3d', undefined, POLL_WAIT)).toBeTruthy();
    // 3D 칸 이름은 맵 단계 이름뿐이다(Scene 버전은 붙이지 않는다).
    expect(viewport.getAttribute('aria-label')).toBe('미리보기 맵');
    // 확정 전(CANDIDATE) Scene 을 그대로 뷰어에 넘긴다.
    expect(fakeViewer.props?.scene).toMatchObject({
      ok: true,
      raw: { scene_version: 'scene-preview-1', state: 'CANDIDATE', current: false },
    });
    expect(requested).toContain('/api/scenes/scene-preview-1/view');
    expect(requested).not.toContain('/api/scenes/current');
    // 구역 편집 틀(useViewportHost)의 편집 상자·AI 윤곽을 쓰지 않는 읽기용 3D 다.
    expect(fakeViewer.props?.boxEdit).toBeUndefined();
    expect(fakeViewer.props?.boxGhosts).toBeUndefined();

    expect(screen.getByRole('list', { name: '보정·생성 단계' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('카메라 2')).toBeTruthy();
    expect(within(table).getByText('41.0 cm')).toBeTruthy();
    expect(screen.getByText('높이 차이 허용 5 cm')).toBeTruthy();
    expect(screen.getByRole('alert', { name: '카메라 높이 불일치 경고' })).toBeTruthy();
    // 미리보기 맵만 있는 동안(정밀 3D 맵을 굽는 중)은 구역 단계로 넘어갈 수 없다.
    expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);

  it('세션의 Scene 을 받지 못하면(/view 404) 빈 3D 칸(로딩 표시)과 진행 카드 열이 보인다', async () => {
    server.use(
      http.get('*/api/scenes/:sceneVersion/view', () =>
        HttpResponse.json(
          { status: 404, code: 'SCENE_VERSION_NOT_FOUND', detail: 'Scene 을 찾을 수 없습니다' },
          { status: 404 },
        ),
      ),
    );
    const { sessionId } = await startSetupSession();
    const requested = trackRequestedPaths();
    setupMock.updateSession(sessionId, { ...PREVIEW_PATCH });

    await openPreviewTab();
    await waitFor(() => expect(requested).toContain('/api/scenes/scene-preview-1/view'), POLL_WAIT);
    expect(await screen.findByRole('list', { name: '보정·생성 단계' })).toBeTruthy();
    const viewport = screen.getByTestId('setup-preview-viewport');
    expect(within(viewport).queryByTestId('viewer3d')).toBeNull();
    expect(viewport.getAttribute('aria-busy')).toBe('true');
    expect(requested).not.toContain('/api/scenes/current');
  }, 20_000);

  it('높이가 안 맞아도 3D 맵이 다 만들어졌으면 다음이 켜져 구역 단계로 갈 수 있고, 카메라 다시 맞추기도 함께 보인다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH, ...HEIGHT_MISMATCH });

    expect(
      await screen.findByRole('alert', { name: '카메라 높이 불일치 경고' }, POLL_WAIT),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '카메라 다시 맞추기' })).toBeTruthy();
    expect(await goToZoneStep()).toBeTruthy();
    expect(screen.queryByRole('button', { name: '카메라 다시 맞추기' })).toBeNull();
  }, 20_000);

  it('미리보기 맵이 도착해도 저절로 넘어가지 않고, 정밀 3D 맵이 끝난 뒤 구역 단계에 가면 수락해 만든 구역은 Scene 이 새 버전으로 바뀌어도 남고 3D 는 그 버전으로 바뀐다', async () => {
    const { sessionId } = await startSetupSession();
    const requested = trackRequestedPaths();
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();

    setupMock.updateSession(sessionId, { ...PREVIEW_PATCH });
    await waitForPreviewTab();
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
    // 보강 촬영으로 정밀 3D 맵을 다시 굽는 중이어도 이전 정밀 맵이 있어 구역 단계에 갈 수 있다(세션을 계속 조회한다)
    setupMock.updateSession(sessionId, {
      ...FINAL_PATCH,
      stage: 'BAKING_TEXTURE',
      status: 'BAKING_TEXTURE',
      progress_pct: 90,
    });

    expect(await goToZoneStep()).toBeTruthy();
    // AI 패널에는 제목과 초안만 있고 배경 맵 단계 상태 줄(맵 단계·Scene 버전)은 없다.
    expect(screen.getByRole('heading', { name: 'AI 위험 구역 초안' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '배경 맵 단계 상태' })).toBeNull();
    expect(screen.getByRole('heading', { name: '정밀 3D 맵' })).toBeTruthy();
    await waitFor(
      () => expect(requested).toContain('/api/scenes/scene-setup-final-1/view'),
      POLL_WAIT,
    );

    fireEvent.click(await screen.findByRole('button', { name: '창가 개구부 추락 주의 수락' }));
    expect(await screen.findByText('반영됨', undefined, POLL_WAIT)).toBeTruthy();

    // 다시 구운 정밀 3D 맵이 도착해 Scene 이 바뀐다
    setupMock.updateSession(sessionId, { scene_version: 'scene-setup-final-2' });
    await waitFor(
      () => expect(requested).toContain('/api/scenes/scene-setup-final-2/view'),
      POLL_WAIT,
    );
    await waitFor(
      () =>
        expect(fakeViewer.props?.scene).toMatchObject({
          ok: true,
          raw: { scene_version: 'scene-setup-final-2' },
        }),
      POLL_WAIT,
    );
    expect(requested).not.toContain('/api/scenes/current');
    expect(screen.getByTestId('zones-page-stub')).toBeTruthy();
    expect(screen.getByText('반영됨')).toBeTruthy();
  }, 25_000);

  it('구역 단계는 왼쪽 3D 와 오른쪽 구역 편집 도구(옆 칸)가 같은 선택을 쓴다: 패널에서 고르면 3D 가 고르고 초점을 옮기고, 3D 에서 고르면 패널이 따른다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    // 구역 단계의 구역은 세션 구역 목록 기준이다(-615): 지금 관제 구역 둘을 이어 쓰는 목록
    const keep = (zoneId: string) => ({
      zone_id: zoneId,
      source: 'MANUAL',
      candidate_id: null,
      zone: null,
      surface: null,
    });
    setupMock.zonePlans.set(sessionId, {
      items: [keep('z-04'), keep('z-02')],
      revision: 1,
      updatedAt: 0,
    });

    const panel = await goToZoneStep();
    expect(panel.getAttribute('data-placement')).toBe('inline');
    // 3D 코드는 구역 단계에 와서야 받는다(무거운 묶음이라 기다림을 넉넉히 둔다).
    expect(await screen.findByTestId('viewer3d', undefined, POLL_WAIT)).toBeTruthy();
    await waitFor(() => expect(panel.getAttribute('data-viewer-ready')).toBe('true'), POLL_WAIT);
    expect(fakeViewer.props?.layers).toMatchObject({ workSurfaces: 'interactive' });
    expect(screen.getByRole('heading', { name: '정밀 3D 맵' })).toBeTruthy();
    // 3D 배경은 지금 관제 Scene 이 아니라 이 세션의 정밀 3D 맵(확정 전)이다.
    await waitFor(
      () =>
        expect(fakeViewer.props?.scene).toMatchObject({
          ok: true,
          raw: { scene_version: 'scene-setup-final-1', state: 'CANDIDATE' },
        }),
      POLL_WAIT,
    );

    // 구역 목록을 받은 뒤 패널에서 고르면 3D 가 고르고 초점을 옮긴다.
    await waitFor(() => expect(panel.getAttribute('data-zones')).not.toBe('0'), POLL_WAIT);
    fireEvent.click(within(panel).getByRole('button', { name: 'z-04 고르기' }));
    expect(fakeViewer.select).toHaveBeenCalledWith({ type: 'zone', id: 'z-04' });
    expect(fakeViewer.focus).toHaveBeenCalledWith({ type: 'zone', id: 'z-04' });
    expect(panel.getAttribute('data-selected')).toBe('zone:z-04');

    // 3D 에서 다른 구역을 누르면 패널이 읽는 선택이 바뀐다.
    act(() => fakeViewer.props?.onSelectionChange?.({ type: 'zone', id: 'z-02' }));
    expect(panel.getAttribute('data-selected')).toBe('zone:z-02');
  }, 20_000);

  it('AI 초안은 3D 점선 윤곽으로 겹쳐 보이고, 수락하면 0.3 m 민 구역을 세션 구역 목록에 저장하고(관제 구역은 그대로) 버리면 목록·3D 에서 뺀다(AI 의견 없음은 회색)', async () => {
    const commits: unknown[] = [];
    const planSaves: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/api/zones/commit') commits.push(path);
      if (request.method === 'PUT' && /^\/api\/setup-sessions\/[^/]+\/zones$/.test(path)) {
        void request
          .clone()
          .json()
          .then((body) => planSaves.push(body));
      }
    });
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await goToZoneStep();

    const list = await screen.findByRole('list', { name: 'AI 구역 초안 목록' }, POLL_WAIT);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute('data-no-opinion')).toBe('false');
    expect(items[1]!.getAttribute('data-no-opinion')).toBe('true');
    expect(items[1]!.textContent).toContain('AI 의견 없음');
    const [opening, podium] = items.map((item) => item.getAttribute('data-candidate-id')!);
    const ghostIds = () => (fakeViewer.props?.boxGhosts ?? []).map((ghost) => ghost.id);
    await waitFor(
      () => expect(ghostIds()).toEqual([`ai-draft:${opening}`, `ai-draft:${podium}`]),
      POLL_WAIT,
    );

    fireEvent.click(screen.getByRole('button', { name: '창가 개구부 추락 주의 수락' }));
    expect(await within(items[0]!).findByText('반영됨', undefined, POLL_WAIT)).toBeTruthy();
    await waitFor(() => expect(planSaves).toHaveLength(1));
    expect(planSaves[0]).toMatchObject({
      revision: 0,
      items: [
        {
          zone_id: null,
          source: 'AI',
          candidate_id: opening,
          zone: {
            name: '창가 개구부 추락 주의',
            severity: 'CRITICAL',
            polygon_xy: [
              [6.7, 7.7],
              [8.9, 7.7],
              [8.9, 9.1],
              [6.7, 9.1],
            ],
          },
        },
      ],
    });
    expect(commits).toEqual([]);
    // 수락한 초안은 구역이 되어 AI 윤곽에서 빠지고, 다시 수락·버릴 단추가 없다.
    expect(ghostIds()).toEqual([`ai-draft:${podium}`]);
    expect(
      within(items[0]!).queryByRole('button', { name: '창가 개구부 추락 주의 수락' }),
    ).toBeNull();
    expect(useZoneEditStore.getState().drafts.__new__).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '전면 단상 작업면 후보 버리기' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(ghostIds()).toEqual([]);
  }, 20_000);

  it('머리글에는 구역 편집(관제 이동) 단추가 없고 구역 단계에서만 맨 오른쪽에 작업 관리로 하나가 있으며, 오른쪽 칸에 구역 목록·완료 카드는 없다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await waitForPreviewTab();
    expect(screen.queryByRole('button', { name: '작업 관리로' })).toBeNull();
    await goToZoneStep();

    const steps = within(screen.getByRole('list', { name: '보정 단계' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[2]!.textContent).toBe('3구역');
    expect(steps[2]!.getAttribute('aria-current')).toBe('step');
    expect(screen.queryByRole('button', { name: '구역 편집' })).toBeNull();

    const restart = screen.getByRole('button', { name: '다시 보정' });
    expect(screen.getAllByRole('button', { name: /작업 관리/ })).toHaveLength(1);
    expect(restart.nextElementSibling).toBe(finishButton());
    expect(finishButton().nextElementSibling).toBeNull();
    expect(finishButton().disabled).toBe(false);

    // 오른쪽 칸은 AI 초안 패널과 구역 편집뿐이다(세팅 구역 목록 카드·완료 전 세팅 완료 카드·불러오기 단추 없음)
    expect(screen.getByRole('heading', { name: 'AI 위험 구역 초안' })).toBeTruthy();
    expect(screen.getByTestId('zones-page-stub')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '세팅 구역 목록' })).toBeNull();
    expect(screen.queryByTestId('setup-zone-plan-card')).toBeNull();
    expect(screen.queryByRole('heading', { name: '세팅 완료' })).toBeNull();
    expect(screen.queryByTestId('setup-complete-card')).toBeNull();
    expect(screen.queryByRole('button', { name: '세팅 완료' })).toBeNull();
    expect(screen.queryByRole('button', { name: '지금 구역 불러오기' })).toBeNull();
  }, 20_000);

  describe('구역 단계 마지막 단추의 세팅 완료(C17)', () => {
    async function zoneStepSession() {
      const { sessionId } = await startSetupSession();
      setupMock.updateSession(sessionId, { ...FINAL_PATCH });
      await goToZoneStep();
      return sessionId;
    }
    const workPage = { to: '/work', search: { workUnitId: '1' } };

    it('저장한 구역이 없으면 확인한 뒤 세팅을 완료하고 그 작업의 작업 관리로 이동한다', async () => {
      const sessionId = await zoneStepSession();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      fireEvent.click(finishButton());

      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(workPage));
      expect(confirm).toHaveBeenCalledWith(EMPTY_ZONES_CONFIRM);
      expect(setupMock.sessions.get(sessionId)?.setup_completed_at_ms ?? null).not.toBeNull();
    }, 20_000);

    it('저장한 구역 목록이 있으면 묻지 않고 완료한다', async () => {
      const sessionId = await zoneStepSession();
      setupMock.zonePlans.set(sessionId, {
        items: [
          { zone_id: 'z-04', source: 'MANUAL', candidate_id: null, zone: null, surface: null },
        ],
        revision: 1,
        updatedAt: 0,
      });
      const confirm = vi.spyOn(window, 'confirm');
      fireEvent.click(finishButton());

      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(workPage));
      expect(confirm).not.toHaveBeenCalled();
      expect(setupMock.sessions.get(sessionId)?.setup_completed_at_ms ?? null).not.toBeNull();
    }, 20_000);

    it('저장한 구역이 없다는 확인을 취소하면 완료하지 않고 구역 단계에 머문다', async () => {
      const sessionId = await zoneStepSession();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      fireEvent.click(finishButton());

      await waitFor(() => expect(confirm).toHaveBeenCalledWith(EMPTY_ZONES_CONFIRM));
      await waitFor(() => expect(finishButton().disabled).toBe(false));
      expect(navigateMock).not.toHaveBeenCalled();
      expect(setupMock.sessions.get(sessionId)?.setup_completed_at_ms ?? null).toBeNull();
      expect(screen.getByTestId('zones-page-stub')).toBeTruthy();
    }, 20_000);

    it('세팅 완료가 거부되면 구역 편집 아래에 안내를 보이고 이동하지 않으며 다시 누를 수 있다', async () => {
      await zoneStepSession();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      server.use(
        http.post('*/api/setup-sessions/:id/complete', () =>
          problem(409, 'SETUP_ZONE_WORLD_MISMATCH', 'World 좌표가 바뀐 세팅'),
        ),
      );
      fireEvent.click(finishButton());

      const message = await screen.findByText(
        SETUP_COMPLETE_ERROR_TEXT.SETUP_ZONE_WORLD_MISMATCH,
        undefined,
        POLL_WAIT,
      );
      const alert = message.closest('[role="alert"]')!;
      expect(alert).toBeTruthy();
      expect(
        screen.getByTestId('zones-page-stub').compareDocumentPosition(alert) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(finishButton().disabled).toBe(false);
    }, 20_000);

    it('이미 세팅을 완료한 세션은 완료를 다시 부르지 않고 바로 이동하며 오른쪽 칸에는 완료 상태 카드만 남는다', async () => {
      const requested = trackRequestedPaths();
      const { sessionId } = await startSetupSession();
      setupMock.updateSession(sessionId, {
        ...FINAL_PATCH,
        setup_completed_at_ms: SETUP_COMPLETED_AT_MS,
      });
      await enterZoneStep();

      expect(await screen.findByTestId('setup-complete-card')).toBeTruthy();
      expect(screen.getByText(/세팅을 완료했습니다/)).toBeTruthy();
      expect(screen.queryByTestId('zones-page-stub')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'AI 위험 구역 초안' })).toBeNull();
      expect(finishButton().disabled).toBe(false);
      fireEvent.click(finishButton());

      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(workPage));
      expect(requested.some((path) => path.endsWith('/complete'))).toBe(false);
    }, 20_000);

    it('이전 모델 재사용 세션은 구역 단계에 들어서면 빈 구역 목록을 지금 관제 구역으로 채운다(보정·생성 단계에서는 채우지 않는다)', async () => {
      const { sessionId } = await startSetupSession();
      // 재사용은 기존 맵 맞추기가 채택돼야 맵 조건을 채운다(서버 READY 규칙·완료 판정과 같다, -688)
      setupMock.updateSession(sessionId, {
        ...FINAL_PATCH,
        mode: 'REUSE',
        world_anchor: { accepted: true },
      });
      await waitForPreviewTab();
      expect(setupMock.zonePlans.get(sessionId)).toBeUndefined();

      await goToZoneStep();
      await waitFor(() => expect(setupMock.zonePlans.get(sessionId)?.revision).toBe(1), POLL_WAIT);
      const items = setupMock.zonePlans.get(sessionId)!.items as { zone_id: string; zone: null }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.zone_id && item.zone === null)).toBe(true);
      // 재사용은 확인 표시가 없다(S15P31A101-629)
      expect(items.every((item) => !(item as { needs_review?: boolean }).needs_review)).toBe(true);
      expect(screen.queryByTestId('setup-zone-review-card')).toBeNull();
    }, 20_000);

    /** 오른쪽 칸 「이전 구역」 카드에서 불러오기를 누르고 이어 쓴 구역 확인 카드가 뜰 때까지 기다린다(S15P31A101-758). */
    async function importPreviousZones() {
      const importCard = await screen.findByTestId('setup-zone-import-card', undefined, POLL_WAIT);
      fireEvent.click(within(importCard).getByRole('button', { name: '이전 구역 불러오기' }));
      await screen.findByTestId('setup-zone-review-card', undefined, POLL_WAIT);
    }

    it('새 모델 + World 이어짐 세션은 이전 구역을 기본으로 채우지 않고, 불러오면 확인 필요로 더해 모두 확인해야 세팅을 완료할 수 있다', async () => {
      const { sessionId } = await startSetupSession();
      setupMock.updateSession(sessionId, {
        ...FINAL_PATCH,
        mode: 'NEW',
        world_anchor: { accepted: true },
      });
      await goToZoneStep();
      // 새 모델은 이전 구역을 이어 오지 않는다(S15P31A101-758): 「이전 구역 불러오기」를 눌러야 더한다
      await importPreviousZones();
      expect(setupMock.zonePlans.get(sessionId)?.revision).toBe(1);
      const total = setupMock.zonePlans.get(sessionId)!.items.length;
      expect(total).toBeGreaterThan(1);

      const card = await screen.findByTestId('setup-zone-review-card', undefined, POLL_WAIT);
      await waitFor(() =>
        expect(within(card).getByRole('status').textContent).toContain(`확인 필요 ${total}개`),
      );
      const blocked = screen.getByRole('button', {
        name: `작업 관리로 · 확인 필요 ${total}개`,
      }) as HTMLButtonElement;
      expect(blocked.disabled).toBe(true);

      // 하나 확인하면 남은 개수가 줄고, 확인 필요 구역이 목록 위에 있다
      const firstRow = card.querySelector('li[data-needs-review="true"]') as HTMLElement;
      fireEvent.click(within(firstRow).getByRole('button', { name: /확인$/ }));
      await waitFor(() =>
        expect(within(card).getByRole('status').textContent).toContain(`확인 필요 ${total - 1}개`),
      );
      const rows = within(card).getAllByRole('listitem');
      expect(rows[0]!.getAttribute('data-needs-review')).toBe('true');
      expect(rows.at(-1)!.getAttribute('data-needs-review')).toBeNull();

      fireEvent.click(within(card).getByRole('button', { name: `남은 ${total - 1}개 모두 확인` }));
      await waitFor(() => expect(finishButton().disabled).toBe(false), POLL_WAIT);
      expect(
        setupMock.zonePlans
          .get(sessionId)!
          .items.every((item) => !(item as { needs_review?: boolean }).needs_review),
      ).toBe(true);
      fireEvent.click(finishButton());
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(workPage));
    }, 20_000);

    it('높이 차이 판정(-630)이 있으면 변경 의심을 먼저 강조하고 변화 없음만 일괄 확인하며 모름·변경 의심은 개별 확인한다', async () => {
      const { sessionId } = await startSetupSession();
      setupMock.updateSession(sessionId, {
        ...FINAL_PATCH,
        mode: 'NEW',
        world_anchor: { accepted: true },
        zone_height_changes: {
          previous_scene_version: 'scene-lobby-prev',
          compared_scene_version: 'scene-preview-1',
          cell_m: 0.1,
          height_diff_threshold_m: 0.15,
          changed_area_ratio_threshold: 0.1,
          zones: [
            {
              zone_id: 'z-04',
              status: 'UNCHANGED',
              reason: null,
              changed_area_ratio: 0,
              max_height_diff_m: 0.02,
              max_diff_xy: [1, 1],
              total_cells: 50,
              compared_cells: 50,
              changed_cells: 0,
            },
            {
              zone_id: 'z-02',
              status: 'CHANGE_SUSPECTED',
              reason: null,
              changed_area_ratio: 0.36,
              max_height_diff_m: 0.35,
              max_diff_xy: [2, 2],
              total_cells: 50,
              compared_cells: 50,
              changed_cells: 18,
            },
          ],
        },
      });
      await goToZoneStep();
      await importPreviousZones();
      await waitFor(() => expect(setupMock.zonePlans.get(sessionId)?.revision).toBe(1), POLL_WAIT);

      const card = await screen.findByTestId('setup-zone-review-card', undefined, POLL_WAIT);
      await waitFor(() =>
        expect(within(card).getByRole('status').textContent).toContain('변경 의심 1개'),
      );

      // 첫 행은 변경 의심(CHANGE_SUSPECTED)이고, 변화 없음 1개 모두 확인 단추가 뜬다
      const rowsBefore = within(card).getAllByRole('listitem');
      expect(rowsBefore[0]!.getAttribute('data-height-change')).toBe('CHANGE_SUSPECTED');
      expect(within(rowsBefore[0]!).getByText('변경 의심')).toBeTruthy();
      // 변경 의심 구역은 AI 의견(-631) 배지·한 줄과 이전·이번 세팅 사진을 행 아래에 보인다(확인은 관리자가 누른다)
      const opinion = rowsBefore[0]!.querySelector('[data-ai-opinion]') as HTMLElement;
      expect(opinion.getAttribute('data-ai-opinion')).toBe('OPINION');
      expect(within(opinion).getByText('삭제 권고')).toBeTruthy();
      expect(within(opinion).getAllByRole('img')).toHaveLength(2);
      expect(rowsBefore[0]!.getAttribute('data-needs-review')).toBe('true');

      fireEvent.click(within(card).getByRole('button', { name: '변화 없음 1개 모두 확인' }));
      await waitFor(() =>
        expect(within(card).queryByRole('button', { name: /모두 확인/ })).toBeNull(),
      );

      // 변경 의심은 여전히 미확인 상태로 남아 세팅 완료가 막혀 있다
      expect(
        (screen.getByRole('button', { name: '작업 관리로 · 확인 필요 1개' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      const pendingRows = card.querySelectorAll('li[data-needs-review="true"]');
      expect(pendingRows.length).toBeGreaterThanOrEqual(1);

      // 남은 변경 의심 구역을 하나씩 개별 확인하면 완료 단추가 켜진다
      for (const row of Array.from(card.querySelectorAll('li[data-needs-review="true"]'))) {
        fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /확인$/ }));
        await waitFor(() => expect(row.getAttribute('data-needs-review')).toBeNull());
      }
      await waitFor(() => expect(finishButton().disabled).toBe(false), POLL_WAIT);
    }, 25_000);

    it('확인 필요가 남은 채 서버가 완료를 거부하면 남은 개수 안내를 보인다', async () => {
      await zoneStepSession();
      server.use(
        http.post('*/api/setup-sessions/:id/complete', () =>
          HttpResponse.json(
            {
              status: 409,
              code: 'SETUP_ZONES_UNCONFIRMED',
              detail:
                '확인이 필요한 구역 2개가 남아 있습니다. 구역마다 확인·수정·삭제한 뒤 세팅을 완료하세요',
              unconfirmed_count: 2,
            },
            { status: 409 },
          ),
        ),
      );
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fireEvent.click(finishButton());
      expect(
        await screen.findByText(/확인이 필요한 구역 2개가 남아 있습니다/, undefined, POLL_WAIT),
      ).toBeTruthy();
      expect(navigateMock).not.toHaveBeenCalled();
    }, 20_000);
  });

  it('작업 관리에서 다시 열면(이 브라우저에 세션이 남은 채) 맵이 준비된 세션은 보정·생성에서 열리고 다음으로 구역에 간다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await goToZoneStep();
    cleanup();

    renderSetupPage();
    expect(await screen.findByRole('list', { name: '보정·생성 단계' }, POLL_WAIT)).toBeTruthy();
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
    expect(await goToZoneStep()).toBeTruthy();
    expect(screen.queryByLabelText('카메라 1 높이 (m)')).toBeNull();
    expect(setupMock.submittedBodies).toHaveLength(1);
  }, 20_000);

  it('이 브라우저에 남은 세션이 다른 작업의 것이면 버리고 그 작업의 세팅을 처음부터 연다', async () => {
    await startSetupSession();
    cleanup();

    renderSetupPage(5);
    expect(await screen.findByLabelText('카메라 1 높이 (m)', undefined, POLL_WAIT)).toBeTruthy();
    await waitFor(() => expect(useSetupFlowStore.getState().activeSessionId).toBeNull());
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
  }, 20_000);
});

describe('멈춘 세팅에서 빠져나갈 길(-640)', () => {
  /** 다른 날짜 작업(3번)에 걸린 진행 중 세션을 목에 만들고, 작업 목록이 그 세션을 가리키게 한다. */
  async function seedStuckSession() {
    const stuck = await createSetupSession(api, {
      work_unit_id: 3,
      camera_heights_m: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: 2.35 },
    });
    server.use(
      http.get('*/api/work-units', ({ request }) =>
        new URL(request.url).searchParams.has('from')
          ? HttpResponse.json({
              works: [
                workDayOf({
                  work_id: '3',
                  date: '2026-11-10',
                  active_setup_session_id: stuck.setup_session_id,
                }),
              ],
            })
          : undefined,
      ),
    );
    return stuck.setup_session_id;
  }

  /** 1단계에서 cam_D 높이를 채우고 「맵」 새 맵 만들기 → 다음으로 새 세팅을 요청한다. */
  async function requestNewSetup() {
    const cam_D = (await screen.findByLabelText('카메라 4 높이 (m)')) as HTMLInputElement;
    fireEvent.change(cam_D, { target: { value: '2.35' } });
    await pickNewModel();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
  }

  it('다시 보정은 확인 뒤 0단계로 가고, 다시 시도하면 확인을 다시 묻지 않고 새 세션을 시작한다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await goToZoneStep();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('button', { name: '다시 보정' }));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('지금 세팅을 취소하고 다시 보정할까요?'),
    );
    expect(await screen.findByLabelText('카메라 4 높이 (m)')).toBeTruthy();
    // 눌렀을 때는 세션을 건드리지 않는다. 0단계의 다시 시도에서 1단계에서 고른 방식으로 새로 시작한다.
    expect(setupMock.submittedBodies).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(2));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(setupMock.retryRequests).toHaveLength(0);
    expect(setupMock.sessions.size).toBe(2);
  }, 30_000);

  it('편집한 구역 목록이 있으면 확인 글이 새 세팅으로 넘어가지 않는다고 알린다', async () => {
    const { sessionId, client } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await goToZoneStep();
    client.setQueryData(setupZonePlanKey(sessionId), { items: [{ zone_id: null }], revision: 1 });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: '다시 보정' }));
    expect(confirmSpy).toHaveBeenCalledWith(
      '지금 세팅을 취소하고 다시 보정할까요? 이 세팅의 구역 목록은 새 세팅으로 넘어가지 않습니다.',
    );
  }, 30_000);

  it('확인 창에서 취소하면 구역 단계에 남고 세션도 요청도 그대로다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, { ...FINAL_PATCH });
    await goToZoneStep();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: '다시 보정' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('카메라 4 높이 (m)')).toBeNull();
    expect(setupMock.retryRequests).toHaveLength(0);
    expect(setupMock.sessions.get(sessionId)?.failure_code).toBeNull();
  }, 30_000);

  it('세팅을 완료한 작업에는 다시 보정이 없다(하루 1회)', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      ...FINAL_PATCH,
      setup_completed_at_ms: SETUP_COMPLETED_AT_MS,
    });
    await enterZoneStep();

    expect(await screen.findByTestId('setup-complete-card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 보정' })).toBeNull();
    expect(finishButton().disabled).toBe(false);
  }, 30_000);

  it('다른 날짜의 멈춘 세팅이 새 세팅을 막으면 그 날짜 세팅 취소 단추가 오류 옆에 뜨고, 취소하면 다시 시작할 수 있다', async () => {
    const stuckId = await seedStuckSession();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSetupPage();
    await requestNewSetup();

    const error = await screen.findByTestId('setup-submit-error');
    expect(error.textContent).toContain('이미 진행 중인 세팅 세션이 있습니다');
    const cancel = await within(error).findByRole('button', { name: '11월 10일 세팅 취소' });
    fireEvent.click(cancel);
    expect(confirmSpy).toHaveBeenCalledWith(
      '11월 10일 작업의 세팅을 취소할까요? 취소하면 그 세팅은 처음부터 다시 해야 합니다.',
    );

    await waitFor(() => expect(screen.queryByTestId('setup-submit-error')).toBeNull());
    expect(setupMock.sessions.get(stuckId)?.failure_code).toBe('CANCELLED_BY_ADMIN');

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.sessions.size).toBe(2));
    expect([...setupMock.sessions.values()].map((session) => session.work_unit_id)).toEqual([3, 1]);
    confirmSpy.mockRestore();
  }, 30_000);

  it('막는 세팅의 취소를 확인 창에서 거절하면 요청 없이 오류가 그대로 남는다', async () => {
    const stuckId = await seedStuckSession();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSetupPage();
    await requestNewSetup();

    const error = await screen.findByTestId('setup-submit-error');
    fireEvent.click(await within(error).findByRole('button', { name: '11월 10일 세팅 취소' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(setupMock.sessions.get(stuckId)?.failure_code).toBeNull();
    expect(screen.getByTestId('setup-submit-error')).toBeTruthy();
    confirmSpy.mockRestore();
  }, 30_000);

  it('막는 세팅을 취소하다 실패하면 그 이유를 단추 옆에 보이고 오류는 남는다', async () => {
    const stuckId = await seedStuckSession();
    server.use(
      http.post('*/api/setup-sessions/:id/cancel', () =>
        HttpResponse.json(
          { message: '이미 끝난 세팅 세션은 취소할 수 없습니다', code: 'SETUP_CANCEL_NOT_ALLOWED' },
          { status: 409 },
        ),
      ),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSetupPage();
    await requestNewSetup();

    const error = await screen.findByTestId('setup-submit-error');
    fireEvent.click(await within(error).findByRole('button', { name: '11월 10일 세팅 취소' }));
    expect((await screen.findByTestId('blocking-setup-cancel-error')).textContent).toBe(
      '이미 끝난 세팅 세션은 취소할 수 없습니다',
    );
    expect(setupMock.sessions.get(stuckId)?.failure_code).toBeNull();
    expect(screen.getByTestId('setup-submit-error')).toBeTruthy();
    confirmSpy.mockRestore();
  }, 30_000);

  it('작업 목록에서 막는 세션을 못 찾으면 단추 없이 오류 글만 보인다', async () => {
    await seedStuckSession();
    server.use(
      http.get('*/api/work-units', ({ request }) =>
        new URL(request.url).searchParams.has('from')
          ? HttpResponse.json({
              works: [workDayOf({ work_id: '3', active_setup_session_id: null })],
            })
          : undefined,
      ),
    );
    renderSetupPage();
    await requestNewSetup();

    const error = await screen.findByTestId('setup-submit-error');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(within(error).queryByRole('button')).toBeNull();
  }, 30_000);

  it('보정·생성에서 현재 시도 중단이 실패하면 실패 이유를 보인다', async () => {
    await startSetupSession();
    server.use(
      http.post('*/api/setup-sessions/:id/cancel', () =>
        HttpResponse.json(
          { message: '이미 끝난 세팅 세션은 취소할 수 없습니다', code: 'SETUP_CANCEL_NOT_ALLOWED' },
          { status: 409 },
        ),
      ),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(await screen.findByRole('button', { name: '현재 시도 중단' }));
    const alert = await screen.findByTestId('setup-retry-error');
    expect(alert.textContent).toBe('이미 끝난 세팅 세션은 취소할 수 없습니다');
    confirmSpy.mockRestore();
  }, 30_000);
});

describe('배경 촬영 창(S15P31A101-686)', () => {
  const captureDialog = () => screen.getByRole('dialog', { name: '배경 촬영' });

  it('1단계 다음은 배경 촬영 창만 띄우고, 「시작」을 눌러야 세션을 만들며 Esc 로 닫히지 않는다', async () => {
    renderSetupPage();
    const cam1Input = (await screen.findByLabelText('카메라 1 높이 (m)')) as HTMLInputElement;
    await waitFor(() => expect(cam1Input.value).toBe('2.25'));
    fireEvent.change(screen.getByLabelText('카메라 4 높이 (m)'), { target: { value: '2.35' } });
    await pickNewModel();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    const dialog = await screen.findByRole('dialog', { name: '배경 촬영' });
    expect(within(dialog).getByRole('status').textContent).toContain(
      '모두 카메라 화면 밖으로 이동한 뒤',
    );
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(setupMock.submittedBodies).toHaveLength(0);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog', { name: '배경 촬영' })).toBeTruthy();

    // 시작 전 취소는 세션 없이 1단계에 머문다
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '배경 촬영' })).toBeNull();
    expect(setupMock.submittedBodies).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await pressCaptureStart();
    await waitFor(() => expect(setupMock.submittedBodies).toHaveLength(1));
    await waitForCalibrationStep();
    expect(captureDialog()).toBeTruthy();
  }, 20_000);

  it('카메라별 촬영 상태를 사용자 말로 보이고, 다음 단계로 넘어가면 저절로 닫힌다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      background_capture: {
        since_ms: 1_763_020_800_000,
        required_samples: 12,
        sample_interval_ms: 1000,
        cameras: {
          cam_A: { state: 'READY', sample_count: 14, person_visible: false },
          cam_B: { state: 'INSUFFICIENT_SAMPLES', sample_count: 6, person_visible: false },
          cam_C: { state: 'PERSON_OCCLUDED', sample_count: 5, person_visible: true },
          cam_D: { state: 'NO_VIDEO', sample_count: 0, person_visible: null },
        },
      },
    });
    await waitFor(
      () => expect(captureDialog().textContent).toContain('카메라 3 앞에 사람이 보입니다'),
      POLL_WAIT,
    );
    const dialog = captureDialog();
    expect(dialog.textContent).toContain('화면 밖으로 이동하면 촬영을 이어갑니다');
    expect(dialog.textContent).toContain('영상이 들어오지 않습니다');
    expect(dialog.textContent).toContain('촬영 중 6/12');
    expect(within(dialog).getByRole('status').textContent).toContain(
      '카메라 3, 카메라 4만 이어서 찍습니다',
    );
    expect(within(dialog).getByLabelText('남은 시간').textContent).toMatch(/^\d+초$/);

    setupMock.updateSession(sessionId, {
      stage: 'INITIAL_POSE_AND_WORLD',
      status: 'INITIAL_POSE_AND_WORLD',
      progress_pct: 20,
    });
    await waitFor(
      () => expect(screen.queryByRole('dialog', { name: '배경 촬영' })).toBeNull(),
      POLL_WAIT,
    );
  }, 20_000);

  it('배경을 끝내 못 찍어 끝나면 그 카메라를 알리고 다시 촬영하면 같은 높이로 다시 시도한다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      status: 'FAILED',
      stage: 'FAILED',
      failure_code: 'BACKGROUND_INCOMPLETE',
      failure_message: '사람 지운 배경 수집 미완료',
      background_capture: {
        since_ms: 1_763_020_800_000,
        required_samples: 12,
        cameras: {
          cam_A: { state: 'READY', sample_count: 12 },
          cam_B: { state: 'READY', sample_count: 12 },
          cam_C: { state: 'PERSON_OCCLUDED', sample_count: 12, person_visible: true },
          cam_D: { state: 'READY', sample_count: 12 },
        },
      },
    });
    await waitFor(
      () =>
        expect(within(captureDialog()).getByRole('status').textContent).toContain(
          '배경을 다 찍지 못했습니다: 카메라 3',
        ),
      POLL_WAIT,
    );
    fireEvent.click(within(captureDialog()).getByRole('button', { name: '다시 촬영' }));
    await waitFor(() => expect(setupMock.retryRequests).toHaveLength(1));
    expect(setupMock.retryRequests[0]!.sessionId).toBe(sessionId);
    await waitForTrackedSession(setupMock.retryRequests[0]!.retriedSessionId);
    // 새 세션도 배경 수집부터라 창은 촬영 중으로 남는다
    expect(within(captureDialog()).getByRole('button', { name: '촬영 취소' })).toBeTruthy();
  }, 20_000);
});

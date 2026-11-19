import { useCctvStore } from '@/features/cctv/cctv.store';
import { useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import { useAbandonedSetupStore } from '@/features/setup/abandonedSetup.store';
import { resetSetupFlowStore, useSetupFlowStore } from '@/features/setup/setup.store';
import { SETUP_COMPLETE_ERROR_TEXT } from '@/features/setup/setupErrorMessage';
import { SetupPage } from '@/features/setup/SetupPage';
import type { SetupSessionResponse } from '@/features/setup/types';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { useWorkActionState, WorkActionProvider } from '@/features/work/WorkActionContext';
import { problem } from '@/mocks/problem';
import { sceneHandlers } from '@/mocks/scenes';
import { buildCoverageGuidePayload, createSetupMock } from '@/mocks/setup';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock } from '@/mocks/zones';
import { useZoneEditStore } from '@/store/zoneEdit.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { delay, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** 저장한 구역이 없을 때 완료 전에 묻는 글(지금 관제 구역을 구체적으로 적는다, S15P31A101-691). */
const EMPTY_ZONES_CONFIRM = expect.stringContaining('저장한 구역이 없');

// 세팅 화면을 날짜 화면 안에 끼운 모양(embedded): 자기 제목·머리줄 단추 없이 단추를 아래 오른쪽 단추 줄(useWorkAction)에 등록한다.
// 단계별 라벨·켜짐은 단독 화면(SetupPage.test.tsx)의 머리줄 단추와 같아야 한다. 3D 뷰어·구역 편집 도구는 대역으로 둔다.

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({ baseUrl: 'http://api.invalid', getToken: () => 'mock-token.admin' }),
  };
});
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('@/features/viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewer3d')>();
  const { useEffect, useImperativeHandle, useRef } = await import('react');
  function FakeViewer({ ref, onStatusChange }: Viewer3DProps) {
    useImperativeHandle(
      ref,
      () =>
        ({
          select: () => ({ ok: true }),
          focus: () => ({ ok: true }),
          clearSelection: () => ({ ok: true }),
        }) as unknown as Viewer3DHandle,
    );
    const reportedRef = useRef(false);
    useEffect(() => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
    }, [onStatusChange]);
    return <div data-testid="viewer3d" />;
  }
  return { ...actual, Viewer3D: FakeViewer };
});
vi.mock('@/features/zones/ZonesPage', () => ({
  ZonesPage: ({ setupLayoutSync }: { setupLayoutSync?: { sessionId: string } }) => {
    useSpatialViewport();
    return (
      <div data-testid="zones-page-stub" data-setup-session={setupLayoutSync?.sessionId ?? ''} />
    );
  },
}));
vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn(), retry: vi.fn() }),
}));

let setupMock = createSetupMock();
const baseHandlers = () => {
  const objects = createStaticObjectsMock();
  const zonesMock = createZonesMock({ staticObjects: objects.store });
  return [...zonesMock.handlers, ...sceneHandlers, ...objects.handlers];
};

const server = setupServer(...baseHandlers(), ...setupMock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  useCctvStore.getState().reset();
  resetSetupFlowStore();
  useAbandonedSetupStore.setState({ entries: [] });
  useZoneEditStore.getState().clear();
  navigateMock.mockReset();
  setupMock = createSetupMock({
    cameraHeightsM: { cam_A: 2.25, cam_B: 2.3, cam_C: 2.2, cam_D: null },
    latestGuide: buildCoverageGuidePayload({ connectivity: 'DISCONNECTED' }),
  });
  server.resetHandlers(...baseHandlers(), ...setupMock.handlers);
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});
afterAll(() => server.close());

const POLL_WAIT = { timeout: 8_000 };

/** 날짜 화면 아래 오른쪽 단추 줄 대역(WorkActionLayer 자리): 등록된 단추를 그대로 그린다. */
function ActionLine() {
  const config = useWorkActionState();
  if (!config) return null;
  return (
    <div data-testid="action-line">
      {config.secondary?.map((item) => (
        <button key={item.label} type="button" disabled={item.disabled} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
      <button
        type="button"
        disabled={!config.enabled}
        title={config.title}
        onClick={config.onClick}
      >
        {config.label}
      </button>
    </div>
  );
}

/** 「세팅 취소」로 세팅에서 나갈 때 부르는 날짜 화면 처리(렌더할 때마다 새로 만든다). */
let onExit = vi.fn();

function renderEmbedded(onDone = vi.fn(), workUnitId = 1) {
  onExit = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkActionProvider>
        <div data-testid="page">
          <SetupPage embedded workUnitId={workUnitId} onDone={onDone} onExit={onExit} />
        </div>
        <ActionLine />
      </WorkActionProvider>
    </QueryClientProvider>,
  );
  return { ...view, onDone };
}

/** 단추 줄에서 이름이 같은 단추. */
const line = () => within(screen.getByTestId('action-line'));
/** 단추 줄의 단추 이름을 왼쪽부터(주 단추가 맨 뒤). */
const lineLabels = () =>
  within(screen.getByTestId('action-line'))
    .getAllByRole('button')
    .map((button) => button.textContent);
const mainButton = () => {
  const buttons = within(screen.getByTestId('action-line')).getAllByRole('button');
  return buttons[buttons.length - 1] as HTMLButtonElement;
};

/** 단계 줄('보정 단계')에서 지금 단계(aria-current="step")인 항목의 글. */
const currentStepText = () =>
  within(screen.getByRole('list', { name: '보정 단계' }))
    .getAllByRole('listitem')
    .find((step) => step.getAttribute('aria-current') === 'step')?.textContent;

/** 1단계 '다음' 뒤 뜨는 배경 촬영 창(-686)에서 「시작」을 눌러 세션을 만든다. */
async function pressCaptureStart() {
  const dialog = await screen.findByRole('dialog', { name: '배경 촬영' });
  fireEvent.click(within(dialog).getByRole('button', { name: '시작' }));
}

/** 1단계에서 cam_D 높이를 채우고 「맵」 '새 맵 만들기' → '다음' 으로 세션을 만들고 그 세션 id 를 돌려준다. */
async function startSetupSession() {
  const view = renderEmbedded();
  const cam_D = (await screen.findByLabelText('카메라 4 높이 (m)')) as HTMLInputElement;
  await waitFor(() => expect(mainButton().disabled).toBe(true));
  fireEvent.change(cam_D, { target: { value: '2.35' } });
  await waitFor(() => expect(mainButton().disabled).toBe(false));
  const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
  fireEvent.click(within(group).getByRole('radio', { name: /^새 맵 만들기/ }));
  fireEvent.click(mainButton());
  await pressCaptureStart();
  await waitFor(() => expect(setupMock.sessions.size).toBe(1));
  const sessionId = [...setupMock.sessions.keys()][0]!;
  // 세션 id 는 화면에 보이지 않으니 단계 줄이 보정·생성으로 넘어가고 흐름 저장소가 그 세션을 따라가는 것으로 본다.
  await waitFor(() => expect(currentStepText()).toBe('2보정·생성'), POLL_WAIT);
  await waitFor(
    () => expect(useSetupFlowStore.getState().activeSessionId).toBe(sessionId),
    POLL_WAIT,
  );
  return { ...view, sessionId };
}

/** 미리보기 맵만 있는 세션(정밀 3D 맵을 굽는 중): 보정·생성의 다음은 아직 꺼져 있다. */
const PREVIEW_PATCH: Partial<SetupSessionResponse> = {
  stage: 'PREVIEW_AND_VLM_DRAFT',
  status: 'PREVIEW_AND_VLM_DRAFT',
  progress_pct: 92,
  preview_scene_version: 'scene-preview-1',
  calibration_version: 'cal-8',
};

/** 정밀 3D 맵까지 끝난 세션: 보정·생성의 다음이 켜져 구역 단계로 갈 수 있다. */
const FINAL_PATCH: Partial<SetupSessionResponse> = {
  stage: 'COMPLETED',
  status: 'COMPLETED',
  progress_pct: 100,
  preview_scene_version: 'scene-preview-1',
  scene_version: 'scene-setup-final-1',
  calibration_version: 'cal-8',
};

/** 3D 맵이 다 만들어져 켜진 주 단추(다음)를 눌러 구역 단계에 들어선다(맵 보강 창은 끼어들지 않는다, S15P31A101-691). */
async function enterZoneStep() {
  await waitFor(() => expect(mainButton().disabled).toBe(false), POLL_WAIT);
  fireEvent.click(mainButton());
  expect(screen.queryByRole('dialog', { name: '맵 보강 촬영' })).toBeNull();
}

/** 구역 단계에 들어서서 구역 편집 도구 대역을 돌려준다. */
async function goToZoneStep() {
  await enterZoneStep();
  return screen.findByTestId('zones-page-stub', undefined, POLL_WAIT);
}

describe('세팅 화면 임베드', () => {
  it('자기 제목과 머리줄 단추를 그리지 않고 1단계 다음을 아래 단추 줄에 등록한다(단계 줄만 남는다)', async () => {
    renderEmbedded();
    await screen.findByLabelText('카메라 4 높이 (m)');

    const page = within(screen.getByTestId('page'));
    expect(page.queryByRole('heading', { level: 1 })).toBeNull();
    expect(page.queryByRole('button', { name: '다음' })).toBeNull();
    expect(page.queryByText('세팅 1단계 · 카메라 확인')).toBeNull();
    const steps = within(page.getByRole('list', { name: '보정 단계' }));
    expect(steps.getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      '1카메라 연결 관리',
      '2보정·생성',
      '3구역',
    ]);

    // 1단계 보조 단추 「세팅 취소」는 세팅에서 나간다(S15P31A101-689, 진행 중 시도가 없으면 묻지 않는다)
    expect(lineLabels()).toEqual(['세팅 취소', '다음']);
    expect(mainButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('카메라 4 높이 (m)'), { target: { value: '2.35' } });
    await waitFor(() => expect(mainButton().disabled).toBe(false));
  });

  it('보정·생성에서는 현재 시도 중단이 보조 단추이고, 다음은 정밀 3D 맵이 다 만들어져야 켜진다', async () => {
    const { sessionId } = await startSetupSession();

    // 머리줄에는 세션 id 도 1단계 안내 글도 없다.
    const page = screen.getByTestId('page');
    expect(page.textContent).not.toContain(sessionId);
    expect(page.textContent).not.toContain('세션 019a');
    expect(within(page).queryByText('세팅 1단계 · 카메라 확인')).toBeNull();
    expect(lineLabels()).toEqual(['현재 시도 중단', '다음']);
    expect(mainButton().disabled).toBe(true);
    expect(
      within(screen.getByTestId('page')).queryByRole('button', { name: '현재 시도 중단' }),
    ).toBeNull();

    // 미리보기 맵만 있는 동안은 꺼져 있고 이유를 title 과 「지금 할 일」 본문에 알린다(S15P31A101-691)
    setupMock.updateSession(sessionId, PREVIEW_PATCH);
    await waitFor(
      () =>
        expect(
          (screen.getByRole('tab', { name: '3D 미리보기' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      POLL_WAIT,
    );
    expect(mainButton().disabled).toBe(true);
    expect(mainButton().title).toBe('3D 맵을 다 만들면 넘어갈 수 있어요');
    expect(screen.getByTestId('setup-next-step').textContent).toContain(
      '다 만들면 「다음」이 켜집니다',
    );

    setupMock.updateSession(sessionId, FINAL_PATCH);
    await waitFor(() => expect(mainButton().disabled).toBe(false), POLL_WAIT);
    expect(mainButton().title).toBe('');
    // 끝난 세션은 멈출 수 없어 현재 시도 중단이 사라진다
    expect(lineLabels()).toEqual(['다음']);
  }, 20_000);

  it('보조 단추 현재 시도 중단은 확인한 뒤 세션을 취소하고 1단계로 돌아가 맵 방식을 다시 고르게 한다', async () => {
    const { sessionId } = await startSetupSession();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(line().getByRole('button', { name: '현재 시도 중단' }));
      await waitFor(() => expect(setupMock.sessions.get(sessionId)?.status).toBe('FAILED'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('radiogroup', { name: '맵 방식' }, POLL_WAIT)).toBeTruthy();
      expect(currentStepText()).toBe('1카메라 연결 관리');
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  }, 20_000);

  it('1단계 세팅 취소는 진행 중 시도가 없으면 묻지 않고 세팅에서 나간다(onExit)', async () => {
    renderEmbedded();
    await screen.findByLabelText('카메라 4 높이 (m)');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(line().getByRole('button', { name: '세팅 취소' }));
      expect(confirm).not.toHaveBeenCalled();
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });

  it('1단계 세팅 취소는 한 번 묻고 진행 중 시도를 멈춘 뒤 그 세션을 버리고 나가며, 다시 열면 이어받지 않고 1단계 기본값에서 시작한다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      ...PREVIEW_PATCH,
      height_checks: {
        cam_B: {
          input_height_m: 2.3,
          restored_height_m: 2.71,
          difference_cm: 41,
          within_tolerance: false,
          guidance: 'cam_B 높이를 다시 재서 입력해 주세요',
        },
      },
    });
    await screen.findByRole('alert', { name: '카메라 높이 불일치 경고' }, POLL_WAIT);
    // 단추 줄은 경고보다 한 번 늦게 그려진다(느린 CI 에서 바로 집으면 없다)
    fireEvent.click(await line().findByRole('button', { name: '카메라 다시 맞추기' }, POLL_WAIT));
    await screen.findByLabelText('카메라 2 높이 (m)');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(line().getByRole('button', { name: '세팅 취소' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
      expect(setupMock.sessions.get(sessionId)?.status).toBe('FAILED');
      expect(useAbandonedSetupStore.getState().entries).toEqual([['1', sessionId]]);
      expect(useSetupFlowStore.getState().activeSessionId).toBeNull();
    } finally {
      confirm.mockRestore();
    }

    cleanup();
    renderEmbedded();
    const group = await screen.findByRole('radiogroup', { name: '맵 방식' });
    expect(
      within(group)
        .getByRole('radio', { name: /^새 맵 만들기/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(currentStepText()).toBe('1카메라 연결 관리');
    expect(useSetupFlowStore.getState().activeSessionId).toBeNull();
  }, 20_000);

  it('세션 취소를 요청하는 동안 현재 시도 중단은 꺼진다(단독 화면과 같다)', async () => {
    const { sessionId } = await startSetupSession();
    server.use(http.post('*/api/setup-sessions/:id/cancel', () => delay('infinite')));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const cancel = () =>
        line().getByRole('button', { name: '현재 시도 중단' }) as HTMLButtonElement;
      expect(cancel().disabled).toBe(false);
      fireEvent.click(cancel());
      await waitFor(() => expect(cancel().disabled).toBe(true));
      expect(setupMock.sessions.get(sessionId)?.status).not.toBe('FAILED');
    } finally {
      confirm.mockRestore();
    }
  }, 20_000);

  it('높이 불일치 안내가 뜨면 카메라 다시 맞추기가 보조 단추로 생기고 누르면 1단계로 돌아간다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      ...PREVIEW_PATCH,
      height_checks: {
        cam_B: {
          input_height_m: 2.3,
          restored_height_m: 2.71,
          difference_cm: 41,
          within_tolerance: false,
          guidance: 'cam_B 높이를 다시 재서 입력해 주세요',
        },
      },
    });
    await screen.findByRole('alert', { name: '카메라 높이 불일치 경고' }, POLL_WAIT);
    await waitFor(
      () => expect(lineLabels()).toEqual(['현재 시도 중단', '카메라 다시 맞추기', '다음']),
      POLL_WAIT,
    );

    fireEvent.click(line().getByRole('button', { name: '카메라 다시 맞추기' }));
    expect(await screen.findByLabelText('카메라 2 높이 (m)')).toBeTruthy();
    expect(lineLabels()).toEqual(['세팅 취소', '다음']);
  }, 20_000);

  it('구역 단계: 다시 보정이 보조 단추이고 다음은 처음부터 켜져 있으며 구역 목록·완료 카드는 없다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();

    expect(lineLabels()).toEqual(['다시 보정', '다음']);
    expect(mainButton().disabled).toBe(false);
    expect(mainButton().title).toBe('');
    expect(screen.queryByRole('button', { name: '작업 관리로' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '세팅 구역 목록' })).toBeNull();
    expect(screen.queryByTestId('setup-zone-plan-card')).toBeNull();
    expect(screen.queryByTestId('setup-complete-card')).toBeNull();
    expect(screen.queryByRole('button', { name: '세팅 완료' })).toBeNull();
  }, 20_000);

  it('구역 단계의 다음은 세팅을 완료한 뒤 onDone 을 부르고 작업 관리로 이동하지 않는다', async () => {
    const { sessionId, onDone } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(mainButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(EMPTY_ZONES_CONFIRM);
    expect(setupMock.sessions.get(sessionId)?.setup_completed_at_ms ?? null).not.toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  }, 20_000);

  it('저장한 구역이 없다는 확인을 취소하면 완료하지 않고 onDone 도 부르지 않는다', async () => {
    const { sessionId, onDone } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(mainButton());
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(EMPTY_ZONES_CONFIRM));
    await waitFor(() => expect(mainButton().disabled).toBe(false));
    expect(onDone).not.toHaveBeenCalled();
    expect(setupMock.sessions.get(sessionId)?.setup_completed_at_ms ?? null).toBeNull();
  }, 20_000);

  it('세팅 완료가 거부되면 구역 편집 아래에 안내를 보이고 onDone 을 부르지 않으며 다음을 다시 누를 수 있다', async () => {
    const { sessionId, onDone } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.post('*/api/setup-sessions/:id/complete', () =>
        problem(409, 'SETUP_ZONE_WORLD_MISMATCH', 'World 좌표가 바뀐 세팅'),
      ),
    );

    fireEvent.click(mainButton());
    const alert = await screen.findByRole('alert', undefined, POLL_WAIT);
    expect(alert.textContent).toBe(SETUP_COMPLETE_ERROR_TEXT.SETUP_ZONE_WORLD_MISMATCH);
    expect(onDone).not.toHaveBeenCalled();
    expect(mainButton().disabled).toBe(false);
  }, 20_000);

  it('이미 세팅을 완료한 세션은 완료를 다시 부르지 않고 구역 단계에 들어서자 다음이 켜져 있어 누르면 onDone 만 부른다', async () => {
    const paths: string[] = [];
    server.events.on('request:start', ({ request }) => paths.push(new URL(request.url).pathname));
    const { sessionId, onDone } = await startSetupSession();
    setupMock.updateSession(sessionId, {
      ...FINAL_PATCH,
      setup_completed_at_ms: 1_800_000_000_000,
    });
    await enterZoneStep();

    expect(await screen.findByTestId('setup-complete-card')).toBeTruthy();
    expect(screen.queryByTestId('zones-page-stub')).toBeNull();
    expect(mainButton().disabled).toBe(false);
    fireEvent.click(mainButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(paths.some((path) => path.endsWith('/complete'))).toBe(false);
  }, 20_000);

  it('구역 단계의 다시 보정은 확인한 뒤 1단계로 돌아간다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(line().getByRole('button', { name: '다시 보정' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(await screen.findByLabelText('카메라 4 높이 (m)')).toBeTruthy();
      expect(lineLabels()).toEqual(['세팅 취소', '다음']);
    } finally {
      confirm.mockRestore();
    }
  }, 20_000);

  it('구역 단계의 다시 보정을 확인 창에서 취소하면 구역 단계에 머문다', async () => {
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      fireEvent.click(line().getByRole('button', { name: '다시 보정' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText('카메라 4 높이 (m)')).toBeNull();
      expect(lineLabels()).toEqual(['다시 보정', '다음']);
    } finally {
      confirm.mockRestore();
    }
  }, 20_000);

  it('날짜 작업에는 레이아웃이 없어서 구역 저장에 세션 id 는 싣되 가상 레이아웃 반영은 요청하지 않고 실패 안내도 띄우지 않는다', async () => {
    const layoutRequests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/layout/zones')) layoutRequests.push(request.url);
    });
    const { sessionId } = await startSetupSession();
    setupMock.updateSession(sessionId, FINAL_PATCH);
    await goToZoneStep();

    // 구역 저장이 세션에 이어지도록 세션 id 는 그대로 넘긴다(setup_session_id).
    expect(screen.getByTestId('zones-page-stub').getAttribute('data-setup-session')).toBe(
      sessionId,
    );
    expect(layoutRequests).toEqual([]);
    expect(screen.queryByText(/가상 레이아웃 반영에 실패/)).toBeNull();
  }, 20_000);
});

describe('단독 화면은 단추 줄을 쓰지 않는다', () => {
  it('제목과 머리줄 단추를 그대로 그리고 단추 줄에는 아무것도 등록하지 않는다', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WorkActionProvider>
          <div data-testid="page">
            <SetupPage workUnitId={1} />
          </div>
          <ActionLine />
        </WorkActionProvider>
      </QueryClientProvider>,
    );
    await screen.findByLabelText('카메라 4 높이 (m)');
    const page = within(screen.getByTestId('page'));
    expect(page.getByRole('heading', { level: 1, name: '설치 · 보정' })).toBeTruthy();
    expect(page.getByRole('button', { name: '다음' })).toBeTruthy();
    expect(screen.queryByTestId('action-line')).toBeNull();
  });
});

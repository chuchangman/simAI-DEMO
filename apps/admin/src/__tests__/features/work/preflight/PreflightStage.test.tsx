import { workDayOf } from '@/__tests__/features/work/workFixture';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import {
  deleteSignature,
  fetchSignatures,
  fetchWorkUnit,
  putDailyWorkUnit,
} from '@/features/work/api';
import { PreflightStage } from '@/features/work/preflight/PreflightStage';
import { useSigners } from '@/features/work/preflight/useSigners';
import type { DayProgress, WorkDayItem } from '@/features/work/types';
import { useWorkActionState, WorkActionProvider } from '@/features/work/WorkActionContext';
import { api } from '@/lib/api';
import { sceneHandlers } from '@/mocks/scenes';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock, type WorkMock } from '@/mocks/work';
import { createZonesMock } from '@/mocks/zones';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 작업 시작에 성공하면 실시간 관제로 간다(-692). 라우터 없이 그리므로 이동만 기록한다.
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));

// 보고서 종이(다른 일꾼 몫)·구역 편집 도구·3D 편집 틀은 대역을 쓴다. 이 시험은 작업 전 확인 화면의 짜임과 서명·시작을 본다.
vi.mock('@/features/work/report/ReportPanel', () => ({
  ReportPanel: (props: { workId: string; editable: boolean; withPrint?: boolean }) => (
    <div
      data-testid="report-panel"
      data-work={props.workId}
      data-editable={String(props.editable)}
      data-print={String(props.withPrint)}
    />
  ),
}));
// 서명자 훅은 그대로 쓰되 어떤 인자로 불렸는지 본다.
vi.mock('@/features/work/preflight/useSigners', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/work/preflight/useSigners')>();
  return { ...actual, useSigners: vi.fn(actual.useSigners) };
});
vi.mock('@/features/layout/SpatialViewportHost', async () => {
  const { createContext, useContext } = await import('react');
  const SpatialViewportContext = createContext<unknown>(null);
  return { SpatialViewportContext, useSpatialViewport: () => useContext(SpatialViewportContext) };
});
const editor = vi.hoisted(() => ({ selectTarget: vi.fn() }));
vi.mock('@/features/setup/SetupZoneStep', async () => {
  const { SpatialViewportContext } = await import('@/features/layout/SpatialViewportHost');
  return {
    SetupZoneStep: ({ title, children }: { title: string; children: React.ReactNode }) => (
      <SpatialViewportContext value={{ selectTarget: editor.selectTarget } as never}>
        <section aria-label={title}>{children}</section>
      </SpatialViewportContext>
    ),
  };
});
vi.mock('@/features/zones/ZonesPage', () => ({
  ZonesPage: ({ placement }: { placement?: string }) => (
    <div data-testid="zones-page-stub" data-placement={placement} />
  ),
}));

// 3D 뷰어 대역: 지정한 단계를 한 번 알리고 마지막 props 를 남긴다.
const fakeViewer = vi.hoisted(() => ({
  props: null as Viewer3DProps | null,
  phase: 'ready' as ViewerStatus['phase'],
  clearSelection: vi.fn(),
}));
// 진짜 입구(importOriginal)를 펼치지 않는다. 입구는 three·R3F·drei·후처리 묶음을 끌어와 화면이 3D 를 동적으로 받을 때 처음
// 변환·적재에 부하 없이도 10 s 가 걸려 15 s 대기를 넘겼다(S15P31A101-674). 이 화면이 런타임에 쓰는 것은 뷰어와 구역 입력
// Source 뿐이라, Source 는 three 를 쓰지 않는 data/spatialSource 에서 바로 가져온다.
vi.mock('@/features/viewer3d', async () => {
  const { createExternalSource } = await import('@/features/viewer3d/data/spatialSource');
  const { useEffect, useImperativeHandle } = await import('react');
  function FakeViewer(props: Viewer3DProps) {
    const { ref, onStatusChange } = props;
    useImperativeHandle(
      ref,
      () => ({ clearSelection: fakeViewer.clearSelection }) as unknown as Viewer3DHandle,
    );
    useEffect(() => {
      fakeViewer.props = props;
    });
    useEffect(() => {
      onStatusChange?.({ phase: fakeViewer.phase, mode: 'LIVE', error: null } as ViewerStatus);
    }, [onStatusChange]);
    return <div data-testid="viewer3d" />;
  }
  return { Viewer3D: FakeViewer, createExternalSource };
});

const TODAY = '2026-11-11';
const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

let clock = T0;
let workMock: WorkMock;
const server = setupServer();
/** 이 시험에서 서버로 간 요청('POST /api/work-units/9001/start' 꼴). */
let requests: string[] = [];
/** 워치 배정 응답(GET /api/watch-bindings). */
let watchBindings: unknown[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  clock = T0;
  requests = [];
  navigate.mockReset();
  fakeViewer.props = null;
  fakeViewer.phase = 'ready';
  fakeViewer.clearSelection.mockClear();
  editor.selectTarget.mockClear();
  workMock = createWorkMock({ now: () => clock });
  server.resetHandlers(
    http.get('*/api/watch-bindings', () => HttpResponse.json(watchBindings)),
    ...workMock.handlers,
    ...createTbmMock().handlers,
    ...createZonesMock().handlers,
    ...sceneHandlers,
  );
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
  );
});
afterEach(() => {
  cleanup();
  watchBindings = [];
  useRealtimeStore.setState({ health: null, phase: 'IDLE', openedAt: null });
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});

/** 날짜 화면이 단추 줄을 그리는 것을 대신하는 작은 단추(등록된 '다음'을 읽어 그린다). */
function ActionBar() {
  const action = useWorkActionState();
  if (!action) return null;
  return (
    <>
      {action.secondary?.map((item) => (
        <button key={item.label} type="button" onClick={item.onClick}>
          {item.label}
        </button>
      ))}
      <button type="button" disabled={!action.enabled} onClick={action.onClick}>
        {action.label}
      </button>
    </>
  );
}

function renderStage(
  day: WorkDayItem,
  onBackToSetup?: () => void,
  rerun?: { rerunNo: number; onCancelRerun: () => void },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkActionProvider>
        <PreflightStage
          day={day}
          date={TODAY}
          todayKey={TODAY}
          onNext={vi.fn()}
          onBackToSetup={onBackToSetup}
          {...rerun}
        />
        <ActionBar />
      </WorkActionProvider>
    </QueryClientProvider>,
  );
}

/** 오늘의 하루 작업을 서버 목에 만들고 세팅을 완료해(작업 시작 조건, -642) 화면에 넘길 작업 항목으로 돌려준다. */
async function openToday(): Promise<WorkDayItem> {
  const created = await putDailyWorkUnit(api, TODAY);
  workMock.markSetupDone(created.work_id);
  return workDayOf({ ...created, progress: 'SETUP_DONE' });
}

const draw = () =>
  fireEvent.pointerDown(screen.getByLabelText('서명 패드'), {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });

/**
 * 서명 추가처럼 mock 서버를 한 번 오가는(서명 목록 조회, 이미지 만들기·올리기·목록 다시 받기) 대기의 상한. 기본 1 s 는
 * CPU 가 바쁜 반복 실행에서 넘긴 적이 있다(S15P31A101-674, 「서명자 1명」 못 찾음). 이 대기는 준비라서, 쓰는 시험의
 * 시간 제한(30 s) 안에서 넉넉히 둔다.
 */
const ROUND_TRIP = { timeout: 5_000 };

/** 서명 창을 열어 한 명을 추가하고 완료로 닫는다. */
async function signAs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '서명하기' }));
  const dialog = await screen.findByRole('dialog', { name: '참석자 서명' });
  fireEvent.change(within(dialog).getByLabelText('서명자 이름'), { target: { value: name } });
  draw();
  const add = within(dialog).getByRole('button', { name: '서명 추가' });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false), ROUND_TRIP);
  fireEvent.click(add);
  await waitFor(() => expect(within(dialog).getByText('서명자 1명')).toBeTruthy(), ROUND_TRIP);
  fireEvent.click(within(dialog).getByRole('button', { name: '완료' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '참석자 서명' })).toBeNull());
}

/** '다음' → 확인창에서 두 체크를 켠다. */
async function openConfirmAndCheck() {
  fireEvent.click(await screen.findByRole('button', { name: '다음' }));
  const dialog = await screen.findByRole('dialog', { name: '작업 전 확인' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'TBM 보고서를 확인했습니다' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '가상 레이아웃을 확인했습니다' }));
  return dialog;
}

describe('PreflightStage 화면', () => {
  it('왼쪽에 고칠 수 있고 출력되는 보고서, 오른쪽에 가상 레이아웃·참석자 서명 카드를 둔다', async () => {
    renderStage(await openToday());
    const report = screen.getByTestId('report-panel');
    expect(report.dataset.work).toBe('9001');
    expect(report.dataset.editable).toBe('true');
    expect(report.dataset.print).toBe('true');

    expect(screen.getByRole('heading', { name: '가상 레이아웃' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '참석자 서명' })).toBeTruthy();
    expect(screen.getByText('0명')).toBeTruthy();
    expect(screen.getByRole('button', { name: '서명하기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '다음' })).toBeTruthy();
  });

  it('구역을 받으면 구역 수 칩과 구역 이름·위험 등급 목록을 보인다', async () => {
    renderStage(await openToday());
    const list = await screen.findByRole('list', { name: '구역 목록' });
    expect(screen.getByText('구역 2개')).toBeTruthy();
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('개구부 구역')).toBeTruthy();
    expect(within(rows[0]!).getByText('위험')).toBeTruthy();
    expect(within(rows[1]!).getByText('단상 구역')).toBeTruthy();
    expect(within(rows[1]!).getByText('경고')).toBeTruthy();
  });

  it('구역이 하나도 없으면 구역 없음을 보인다', async () => {
    server.use(http.get('*/api/zones', () => HttpResponse.json([])));
    renderStage(await openToday());
    expect(await screen.findByText('구역 없음')).toBeTruthy();
    expect(screen.getByText('구역 0개')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '구역 목록' })).toBeNull();
  });

  it('워치 카드에 등록된 워치마다 표시 이름·기기·연결을 보이고, 사람과 짝지어졌으면 그 표시를 붙인다(-692)', async () => {
    watchBindings = [
      {
        binding_id: 1,
        device_id: 'watch-a',
        world_id: 'w-0001',
        method: 'MOTION_MATCH',
        bound_at: T0,
        channel_state: 'BOUND',
      },
    ];
    useRealtimeStore.setState({
      phase: 'OPEN',
      openedAt: Date.now(),
      health: {
        receivedAt: Date.now(),
        clockOffsetMs: 0,
        payload: {
          watches: {
            registered: 2,
            connected: 1,
            items: [
              {
                device_id: 'watch-a',
                link: 'CONNECTED',
                last_heartbeat_at: T0,
                battery_pct: 80,
                transport: 'WIFI',
              },
              {
                device_id: 'watch-b',
                link: 'LOST',
                last_heartbeat_at: null,
                battery_pct: null,
                transport: null,
              },
            ],
          },
          watch_names: [
            { device_id: 'watch-a', display_name: '작업자 A' },
            { device_id: 'watch-b', display_name: '작업자 B' },
          ],
        },
      } as never,
    });
    renderStage(await openToday());
    expect(screen.getByRole('heading', { name: '워치' })).toBeTruthy();
    expect(screen.getByText('연결 1/2')).toBeTruthy();
    const list = screen.getByRole('list', { name: '워치 목록' });
    const rows = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows[0]).toContain('작업자 A');
    expect(rows[0]).toContain('watch-a');
    expect(rows[0]).toContain('연결됨');
    expect(rows[1]).toContain('작업자 B');
    expect(rows[1]).toContain('끊김');
    await waitFor(() => expect(within(list).getByText('사람 연결됨')).toBeTruthy());
  });

  it('워치 상태를 모르면(health 없음) 없다고 하지 않는다', async () => {
    renderStage(await openToday());
    expect(screen.getByText('워치 상태를 아직 모릅니다.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '다음' }));
    await screen.findByRole('dialog', { name: '작업 전 확인' });
    expect(screen.queryByRole('list', { name: '시작 전 경고' })).toBeNull();
  });

  it('연결된 워치가 0대면 확인창에 경고 한 줄을 보이고 시작은 막지 않는다(-730)', async () => {
    useRealtimeStore.setState({
      phase: 'OPEN',
      openedAt: Date.now(),
      health: {
        receivedAt: Date.now(),
        clockOffsetMs: 0,
        payload: {
          laptop: { link: 'CONNECTED', last_heartbeat_at: T0 },
          watches: { registered: 1, connected: 0, items: [] },
        },
      } as never,
    });
    renderStage(await openToday());
    const dialog = await openConfirmAndCheck();
    const warnings = within(dialog).getByRole('list', { name: '시작 전 경고' });
    expect(warnings.textContent).toContain('연결된 워치가 없어 현장 경보는 현장 노트북에서만');
  });

  it('구역을 받지 못했으면 없다고 하지 않고 안내만 보인다', async () => {
    server.use(http.get('*/api/zones', () => HttpResponse.json({ message: 'x' }, { status: 500 })));
    renderStage(await openToday());
    expect(await screen.findByText('구역을 불러오지 못했어요')).toBeTruthy();
    expect(screen.queryByText('구역 없음')).toBeNull();
  });
});

describe('PreflightStage 한 번 더 실행(S15P31A101-696)', () => {
  it('실행 번호와 카메라 재점검 안내를 위에 두고, 작업 종료로 단추가 종료 화면으로 돌려보낸다', async () => {
    const onCancelRerun = vi.fn();
    renderStage(await openToday(), undefined, { rerunNo: 2, onCancelRerun });
    const notice = screen.getByRole('region', { name: '한 번 더 실행' });
    expect(within(notice).getByText('실행 2 시작 전 확인')).toBeTruthy();
    expect(within(notice).getByText(/카메라를 옮기거나 다시 연결했다면/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '작업 종료로' }));
    expect(onCancelRerun).toHaveBeenCalledTimes(1);
  });

  it('처음 실행이면 안내도 작업 종료로 단추도 없다', async () => {
    renderStage(await openToday());
    expect(screen.queryByRole('region', { name: '한 번 더 실행' })).toBeNull();
    expect(screen.queryByRole('button', { name: '작업 종료로' })).toBeNull();
  });
});

describe('PreflightStage 서명자 훅', () => {
  it.each<[DayProgress, boolean]>([
    ['SETUP', false],
    ['SETUP_DONE', true],
    ['IN_PROGRESS', true],
    ['ENDED', true],
    ['SUBMITTED', true],
  ])('서버 진행이 %s 이면 세팅 끝남을 %s 로 넘긴다', async (progress, setupDone) => {
    const day = { ...(await openToday()), progress };
    renderStage(day);
    expect(vi.mocked(useSigners)).toHaveBeenLastCalledWith(day.work_id, setupDone);
  });
});

describe('PreflightStage 3D·구역 편집', () => {
  it('3D 에 구역을 넘겨 그리고, 3D 에서 구역을 누르면 그 구역의 편집 창이 열린다', async () => {
    renderStage(await openToday());
    const viewport = await screen.findByTestId('preflight-viewport');
    expect(
      await within(viewport).findByTestId('viewer3d', undefined, { timeout: 15_000 }),
    ).toBeTruthy();
    // 구역 입력 Source 가 붙고, 편집 상자·AI 윤곽 없는 읽기용 3D 다.
    expect(fakeViewer.props?.source?.kind).toBe('EXTERNAL');
    expect(fakeViewer.props?.boxEdit).toBeUndefined();

    act(() => fakeViewer.props?.onSelectionChange?.({ type: 'zone', id: 'z-04' }));
    const dialog = await screen.findByRole('dialog', { name: '구역 편집' });
    expect(within(dialog).getByTestId('zones-page-stub').dataset.placement).toBe('inline');
    // 눌러서 연 구역이 처음부터 골라진다. 이 3D 의 선택 표시는 풀린다.
    await waitFor(() =>
      expect(editor.selectTarget).toHaveBeenCalledWith(
        { type: 'zone', id: 'z-04' },
        { focus: true },
      ),
    );
    expect(fakeViewer.clearSelection).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '구역 편집' })).toBeNull());
  }, 30_000);

  it('3D 가 아닌 구역 목록에서 눌러도 그 구역의 편집 창이 열린다', async () => {
    renderStage(await openToday());
    const list = await screen.findByRole('list', { name: '구역 목록' });
    fireEvent.click(within(list).getByRole('button', { name: /단상 구역/ }));
    await screen.findByRole('dialog', { name: '구역 편집' });
    await waitFor(() =>
      expect(editor.selectTarget).toHaveBeenCalledWith(
        { type: 'zone', id: 'z-02' },
        { focus: true },
      ),
    );
  }, 30_000);

  it('3D 가 멈추면 3D 칸에 안내만 남고 구역 목록은 그대로 보인다', async () => {
    fakeViewer.phase = 'error';
    renderStage(await openToday());
    expect(
      await screen.findByText('3D 를 표시할 수 없습니다', undefined, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(screen.queryByTestId('viewer3d')).toBeNull();
    const list = await screen.findByRole('list', { name: '구역 목록' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('구역 2개')).toBeTruthy();
  }, 30_000);
});

describe('PreflightStage 서명·시작', () => {
  it('서명하기로 서명을 더하면 카드에 인원·이름·썸네일·삭제가 나오고, 삭제하면 사라진다', async () => {
    renderStage(await openToday());
    await screen.findByRole('list', { name: '구역 목록' });
    await signAs('박반장');

    await waitFor(() => expect(screen.getByText('1명')).toBeTruthy());
    const list = screen.getByRole('list', { name: '서명자 목록' });
    expect(within(list).getByText('박반장')).toBeTruthy();
    expect(within(list).getByAltText('박반장 서명')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: '박반장 서명 삭제' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: '서명자 목록' })).toBeNull());
    expect(screen.getByText('0명')).toBeTruthy();
    expect(requests).toContain('POST /api/reports/tbm/9001/signatures');
    expect(requests.some((r) => r.startsWith('DELETE /api/reports/tbm/9001/signatures/'))).toBe(
      true,
    );
  }, 30_000);

  it('서명이 없으면 확인창의 작업 시작이 꺼져 있고, 서명하기가 확인창을 닫고 서명 창을 연다', async () => {
    renderStage(await openToday());
    const dialog = await openConfirmAndCheck();
    expect(within(dialog).getByText('참석자 서명이 필요합니다')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: '작업 시작' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: '서명하기' }));
    await screen.findByRole('dialog', { name: '참석자 서명' });
    expect(screen.queryByRole('dialog', { name: '작업 전 확인' })).toBeNull();
  }, 30_000);

  it('서명을 더하고 두 체크를 켜면 작업을 시작해 서버 작업이 진행 중이 된다', async () => {
    const day = await openToday();
    renderStage(day);
    await signAs('박반장');

    const dialog = await openConfirmAndCheck();
    expect(within(dialog).getByText('참석자 서명 1명')).toBeTruthy();
    const start = within(dialog).getByRole('button', { name: '작업 시작' }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);

    await waitFor(() => expect(requests).toContain(`POST /api/work-units/${day.work_id}/start`));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '작업 전 확인' })).toBeNull());
    const started = await fetchWorkUnit(api, day.work_id);
    expect(started.progress).toBe('IN_PROGRESS');
    // 시작에 성공하면 실시간 관제로 가고(관제 화면이 현장 적용을 확인한다, -692), 시작 요청은 한 번뿐이다
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: '/live' });
    expect(requests.filter((r) => r.endsWith('/start'))).toHaveLength(1);
  }, 30_000);

  it('GPU 가 꺼져 있으면 작업 시작이 GPU 경고창을 띄우고 시작 요청을 보내지 않는다(S15P31A101-702)', async () => {
    server.use(
      http.get('*/api/gpu/sessions/current', () =>
        HttpResponse.json({
          session: null,
          server_time_ms: clock,
          launch: null,
          power: 'OFF',
          stop_block: null,
        }),
      ),
    );
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role: 'ADMIN' } });
    try {
      const day = await openToday();
      renderStage(day);
      await signAs('박반장');
      await waitFor(() => expect(requests).toContain('GET /api/gpu/sessions/current'));
      const dialog = await openConfirmAndCheck();
      fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));
      const gate = await screen.findByTestId('gpu-gate-off');
      expect(gate.textContent).toContain('세팅과 관제에는 GPU가 필요합니다(약 5~7분)');
      expect(requests.filter((r) => r.endsWith('/start'))).toHaveLength(0);
    } finally {
      useSessionStore.getState().signOut();
    }
  }, 30_000);

  it('작업 중 보호구는 기본 둘 다 필수이고, 끈 장비는 NOT_REQUIRED 로 시작 요청에 싣는다(-654)', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/start')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
      }
    });
    const day = await openToday();
    renderStage(day);
    await signAs('박반장');

    const dialog = await openConfirmAndCheck();
    const helmet = within(dialog).getByRole('checkbox', {
      name: '안전모 필수',
    }) as HTMLInputElement;
    const vest = within(dialog).getByRole('checkbox', { name: '조끼 필수' }) as HTMLInputElement;
    expect(helmet.checked && vest.checked).toBe(true);
    fireEvent.click(vest);
    fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));

    await waitFor(() => expect(bodies).toEqual([{ helmet: 'REQUIRED', vest: 'NOT_REQUIRED' }]));
  }, 30_000);

  it('확인창을 다시 열어도 앞서 켠 체크가 남아 있다', async () => {
    renderStage(await openToday());
    const dialog = await openConfirmAndCheck();
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '작업 전 확인' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    const reopened = await screen.findByRole('dialog', { name: '작업 전 확인' });
    expect(
      (
        within(reopened).getByRole('checkbox', {
          name: 'TBM 보고서를 확인했습니다',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  }, 30_000);

  it('서버가 서명이 없다고 거절하면 확인창 안에 이유를 보인다', async () => {
    const day = await openToday();
    renderStage(day);
    await signAs('박반장');
    // 다른 곳에서 서명을 지웠다: 이 화면은 아직 1명으로 알고 있어 작업 시작이 눌린다.
    const [signature] = await fetchSignatures(api, day.tbm_report!.report_id);
    await deleteSignature(api, day.tbm_report!.report_id, signature!.signature_id);

    const dialog = await openConfirmAndCheck();
    fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('참석자 서명이 필요합니다');
    // 닫히지 않고 다시 시도할 수 있다.
    expect(screen.getByRole('dialog', { name: '작업 전 확인' })).toBeTruthy();
  }, 30_000);

  it('작업 날짜가 오늘이 아니면 오늘 작업만 시작할 수 있다고 알린다', async () => {
    const day = await openToday();
    renderStage(day);
    await signAs('박반장');
    // 자정이 지나 서버의 오늘이 바뀌었다.
    clock += DAY_MS;

    const dialog = await openConfirmAndCheck();
    fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      '오늘 작업만 시작할 수 있어요',
    );
  }, 30_000);

  it('세팅 완료 전(progress SETUP)이면 작업 시작을 끄고 안내와 세팅으로 단추를 보인다', async () => {
    const created = await putDailyWorkUnit(api, TODAY);
    const onBackToSetup = vi.fn();
    renderStage(workDayOf({ ...created, progress: 'SETUP' }), onBackToSetup);
    fireEvent.click(await screen.findByRole('button', { name: '다음' }));
    const dialog = await screen.findByRole('dialog', { name: '작업 전 확인' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'TBM 보고서를 확인했습니다' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '가상 레이아웃을 확인했습니다' }));
    expect(
      (within(dialog).getByRole('button', { name: '작업 시작' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dialog).getByRole('alert').textContent).toBe(
      '세팅을 완료해야 시작할 수 있습니다',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: '세팅으로' }));
    expect(onBackToSetup).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '작업 전 확인' })).toBeNull());
    expect(requests.filter((r) => r.endsWith('/start'))).toEqual([]);
  }, 30_000);

  it('서버가 세팅 완료 전이라고 거절하면(409 WORK_SETUP_NOT_COMPLETED) 같은 안내와 세팅으로 단추를 보인다', async () => {
    const created = await putDailyWorkUnit(api, TODAY);
    // 화면은 세팅 완료(SETUP_DONE)로 알고 있지만 서버에는 완료 기록이 없다
    const day = workDayOf({ ...created, progress: 'SETUP_DONE' });
    const onBackToSetup = vi.fn();
    renderStage(day, onBackToSetup);
    await signAs('박반장');

    const dialog = await openConfirmAndCheck();
    fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      '세팅을 완료해야 시작할 수 있습니다',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '세팅으로' }));
    expect(onBackToSetup).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('시작 실패 안내는 확인창을 닫았다 다시 열면 사라진다', async () => {
    const day = await openToday();
    renderStage(day);
    await signAs('박반장');
    clock += DAY_MS;
    const dialog = await openConfirmAndCheck();
    fireEvent.click(within(dialog).getByRole('button', { name: '작업 시작' }));
    await within(dialog).findByRole('alert');

    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '작업 전 확인' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    const reopened = await screen.findByRole('dialog', { name: '작업 전 확인' });
    expect(within(reopened).queryByRole('alert')).toBeNull();
  }, 30_000);
});

import type { EventEntry } from '@/features/events/entries';
import {
  endWork,
  fetchReportsByWork,
  putDailyWorkUnit,
  signReport,
  startWork,
  submitReport,
  WORK_ERROR,
} from '@/features/work/api';
import { RunStage } from '@/features/work/run/RunStage';
import { useOpenDay } from '@/features/work/useWorkDays';
import { useWorkActionState, WorkActionProvider } from '@/features/work/WorkActionContext';
import { ZONES_KEY } from '@/features/zones/api';
import { api } from '@/lib/api';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock, type WorkMock } from '@/mocks/work';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 보고서 종이(B 일꾼 몫)는 받은 props 만 보이는 대역으로 바꾼다.
vi.mock('@/features/work/report/ReportPanel', () => ({
  ReportPanel: ({
    workId,
    editable,
    withPrint,
  }: {
    workId: string;
    editable: boolean;
    withPrint?: boolean;
  }) => (
    <div
      data-testid="report-panel"
      data-work={workId}
      data-editable={String(editable)}
      data-print={String(withPrint ?? false)}
    />
  ),
}));

// 오른쪽 카드가 읽는 관제 데이터는 대역으로 고정한다. 시계도 고정한다.
const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const MIN = 60_000;
/** 서버(mock)가 종료 뒤 종료 미팅을 채우기까지(mock 기본 초안 지연과 같다). */
const ENDING_DELAY_MS = 2_500;
const TODAY = '2026-11-11';
const NOW = vi.hoisted(() => ({ value: 0 }));
const live = vi.hoisted(() => ({ entries: [] as EventEntry[] }));
// GPU 상태: 기본은 관리자가 아니라 GPU 카드가 없다(-734). 시험이 켜진 모양으로 바꾼다.
const gpu = vi.hoisted(() => ({
  view: { isAdmin: false, status: undefined, dot: 'OFF', clockOffsetMs: 0 } as Record<
    string,
    unknown
  >,
}));

vi.mock('@/features/layout/useNow', () => ({ useNow: () => NOW.value }));
vi.mock('@/features/gpu/useGpu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/gpu/useGpu')>()),
  useGpuStatus: () => gpu.view,
}));
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: live.entries, loaded: true, failed: false }),
}));
vi.mock('@/features/layout/useCurrentScene', () => ({
  useCurrentScene: () => ({
    scene: { ok: true, raw: {} },
    sceneStatus: null,
    onSceneStatusChange: () => undefined,
  }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [{}, {}, {}], raw: [], failed: false }),
}));
vi.mock('@/features/cctv/useCameraStates', () => ({
  useCameraStates: () => ({
    cameras: [{ id: 'cam_A' }, { id: 'cam_B' }, { id: 'cam_C' }, { id: 'cam_D' }],
    fresh: true,
    stateOf: (id: string) => (id === 'cam_D' ? 'down' : 'live'),
  }),
}));

const eventAt = (
  id: string,
  raisedAt: number,
  severity: 'CRITICAL' | 'HIGH' | 'CAUTION',
  zone: string,
) =>
  ({
    event: {
      event_id: id,
      rule_id: 'R2',
      source: 'LIVE',
      lifecycle: 'RAISED',
      verification: 'VERIFIED',
      severity,
      confidence: 'HIGH',
      needs_check: false,
      world_ids: [],
      zone_id: zone,
      metrics: {},
      rationale: null,
      proposed_severity: null,
      raised_at: raisedAt,
    },
    stageStartedAt: null,
  }) satisfies EventEntry;

let clock = T0;
let mock: WorkMock;
const server = setupServer();
let requests: string[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  clock = T0;
  NOW.value = T0 + 65_000;
  requests = [];
  live.entries = [];
  gpu.view = { isAdmin: false, status: undefined, dot: 'OFF', clockOffsetMs: 0 };
  mock = createWorkMock({ now: () => clock });
  server.resetHandlers(...mock.handlers, ...createTbmMock().handlers);
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

type Stage = 'running' | 'ended' | 'submitted';

/**
 * 오늘 작업을 만들고 서명·시작(·종료·제출)까지 진행해 두고 작업 id 를 돌려준다.
 * 'ended' 는 종료 직후라 서버가 종료 미팅을 아직 채우는 중이다(시계를 ENDING_DELAY_MS 만큼 보내야 채워진다).
 */
async function prepare(upTo: Stage): Promise<string> {
  const day = await putDailyWorkUnit(api, TODAY);
  mock.markSetupDone(day.work_id); // 작업 시작은 세팅 완료 뒤다(-642)
  await signReport(api, day.tbm_report?.report_id ?? 0, {
    image: png(),
    signerName: '박반장',
    reportVersion: 1,
  });
  await startWork(api, day.work_id);
  if (upTo === 'running') return day.work_id;
  clock = T0 + 65 * MIN;
  await endWork(api, day.work_id);
  if (upTo === 'ended') return day.work_id;
  clock += ENDING_DELAY_MS;
  const { latest } = await fetchReportsByWork(api, day.work_id);
  await submitReport(api, latest?.report_id ?? 0);
  return day.work_id;
}

/** WorkActionLayer 대역: 단계 화면이 등록한 단추 줄의 주 단추와 보조 단추. */
function ActionButton() {
  const action = useWorkActionState();
  if (!action) return null;
  return (
    <>
      {action.secondary?.map((item) => (
        <button key={item.label} type="button" disabled={item.disabled} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
      {action.reason && <span data-testid="action-reason">{action.reason}</span>}
      <button type="button" disabled={!action.enabled} onClick={action.onClick}>
        {action.label}
      </button>
    </>
  );
}

/** 날짜 화면 대역: 하루 작업을 받아 서버 진행이 단계 화면을 정하게 한다(종료·제출 뒤 다시 받아 모양이 바뀐다). */
function Harness({ onSubmitted, onRerun }: { onSubmitted: () => void; onRerun?: () => void }) {
  const { data: day } = useOpenDay(TODAY, TODAY);
  if (!day) return null;
  return (
    <WorkActionProvider>
      <RunStage
        day={day}
        date={TODAY}
        todayKey={TODAY}
        onNext={() => undefined}
        onSubmitted={onSubmitted}
        onRerun={onRerun}
      />
      <ActionButton />
    </WorkActionProvider>
  );
}

function renderStage(onSubmitted: () => void = () => undefined, onRerun?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <Harness onSubmitted={onSubmitted} onRerun={onRerun} />
    </QueryClientProvider>,
  );
}

const putForms = () => requests.filter((r) => /^PUT \/api\/reports\/tbm\/\d+\/form$/.test(r));
const reportPanel = () => screen.getByTestId('report-panel');
const doneButton = () => screen.getByRole('button', { name: '보고서 제출' }) as HTMLButtonElement;

describe('RunStage — 진행 중', () => {
  it('왼쪽에 고칠 수 있는 보고서, 오른쪽에 작업 현황·경보 기록·관제 적용 상태를 보인다', async () => {
    const workId = await prepare('running');
    live.entries = [
      eventAt('before', T0 - MIN, 'CRITICAL', 'z-04'),
      eventAt('first', T0 + 10_000, 'CRITICAL', 'z-04'),
      eventAt('second', T0 + 20_000, 'HIGH', 'z-02'),
      eventAt('caution', T0 + 30_000, 'CAUTION', 'z-02'),
    ];
    renderStage();

    expect(await screen.findByRole('heading', { name: '작업 현황' })).toBeTruthy();
    expect(reportPanel().dataset).toMatchObject({
      work: workId,
      editable: 'true',
      print: 'true',
    });
    expect(screen.getByText('진행 중')).toBeTruthy();
    expect(screen.getByRole('timer', { name: '경과 시간' }).textContent).toBe('00:01:05');
    expect(screen.getByText('시작 시각 2026-11-11 09:00')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('서명 1명')).toBeTruthy());

    const events = screen.getByRole('list', { name: '경보 기록 목록' });
    expect(screen.getByText('2건 · 위험 1 · 경고 1')).toBeTruthy();
    expect(
      within(events)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('단상 구역'), expect.stringContaining('개구부 구역')]);

    expect(screen.getByRole('heading', { name: '관제 적용 상태' })).toBeTruthy();
    expect(screen.getByText('3D 모델 적용됨')).toBeTruthy();
    // 구역 수는 이번 작업 묶음이 현장에 적용됐을 때 그 묶음의 값이다. 묶음 목록이 없으면 줄을 만들지 않는다(-692)
    expect(screen.queryByText(/구역 \d+개 적용됨/)).toBeNull();
    expect(screen.getByText('카메라 3/4 연결')).toBeTruthy();
    expect((screen.getByRole('button', { name: '작업 종료' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('경보가 없으면 `경보 없음` 과 `0건` 을 보인다', async () => {
    await prepare('running');
    renderStage();
    expect(await screen.findByText('경보 없음')).toBeTruthy();
    expect(screen.getByText('0건')).toBeTruthy();
  });

  it('`작업 종료` 는 종료 확인창을 열고, 취소하면 종료하지 않으며, 종료하면 종료 모양(`보고서 제출`)으로 바뀐다', async () => {
    await prepare('running');
    renderStage();
    fireEvent.click(await screen.findByRole('button', { name: '작업 종료' }));

    const dialog = screen.getByRole('dialog', { name: '작업을 종료할까요?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requests.some((r) => r.endsWith('/end'))).toBe(false);

    clock = T0 + 65 * MIN;
    fireEvent.click(screen.getByRole('button', { name: '작업 종료' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '작업을 종료할까요?' })).getByRole('button', {
        name: '종료',
      }),
    );

    expect(await screen.findByRole('button', { name: '보고서 제출' })).toBeTruthy();
    expect(requests.filter((r) => r.endsWith('/end'))).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: '작업 현황' })).toBeNull();
    expect(reportPanel().dataset.editable).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('종료가 실패하면 확인창에 안내를 보이고 창은 그대로 둔다', async () => {
    await prepare('running');
    server.use(
      http.post('*/api/work-units/:id/end', () =>
        HttpResponse.json({ code: WORK_ERROR.INVALID_STATE, message: '안 됨' }, { status: 409 }),
      ),
    );
    renderStage();
    fireEvent.click(await screen.findByRole('button', { name: '작업 종료' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '작업을 종료할까요?' })).getByRole('button', {
        name: '종료',
      }),
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      '작업을 종료하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(screen.getByRole('dialog', { name: '작업을 종료할까요?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '작업 현황' })).toBeTruthy();
  });
});

describe('RunStage — 한 번 더 실행(S15P31A101-696)', () => {
  it('종료 화면은 `보고서 제출` 옆에 `한 번 더 실행` 을 두고, 누르면 onRerun 만 부른다', async () => {
    await prepare('ended');
    requests = [];
    const onRerun = vi.fn();
    renderStage(undefined, onRerun);
    fireEvent.click(await screen.findByRole('button', { name: '한 번 더 실행' }));
    expect(onRerun).toHaveBeenCalledTimes(1);
    expect(requests.some((r) => r.endsWith('/start'))).toBe(false);
  });

  it('실행 2 진행 중에는 경과·시작 시각·경보 기록이 실행 2 기준이고, 끝나면 실행 기록에 두 실행이 보인다', async () => {
    const workId = await prepare('ended');
    clock = T0 + 120 * MIN;
    await startWork(api, workId);
    NOW.value = T0 + 120 * MIN + 30_000;
    live.entries = [
      eventAt('run1', T0 + 10_000, 'CRITICAL', 'z-04'),
      eventAt('run2', T0 + 120 * MIN + 10_000, 'HIGH', 'z-02'),
    ];
    renderStage();
    expect(await screen.findByText('실행 2 · 진행 중')).toBeTruthy();
    expect(screen.getByRole('timer', { name: '경과 시간' }).textContent).toBe('00:00:30');
    expect(screen.getByText('시작 시각 2026-11-11 11:00')).toBeTruthy();
    expect(screen.getByText('1건 · 위험 0 · 경고 1')).toBeTruthy();

    clock = T0 + 150 * MIN;
    fireEvent.click(screen.getByRole('button', { name: '작업 종료' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '작업을 종료할까요?' })).getByRole('button', {
        name: '종료',
      }),
    );
    const history = await screen.findByRole('region', { name: '실행 기록' });
    expect(within(history).getByText('실행 1')).toBeTruthy();
    expect(within(history).getByText('실행 2')).toBeTruthy();
    expect(within(history).getByText('01:05:00')).toBeTruthy();
    expect(within(history).getByText('00:30:00')).toBeTruthy();
  });

  it('보고서를 낸 작업은 다시 시작하지 못한다(409 WORK_REPORT_SUBMITTED)', async () => {
    const workId = await prepare('submitted');
    await expect(startWork(api, workId)).rejects.toMatchObject({
      code: WORK_ERROR.REPORT_SUBMITTED,
    });
  });
});

describe('RunStage — 종료', () => {
  it('서버가 종료 미팅을 채우는 동안 `보고서 제출` 는 꺼 두고, 다 채우면 켜며, 화면은 양식을 저장하지 않는다', async () => {
    const workId = await prepare('ended');
    mock.setEventCounts(workId, { CRITICAL: 1, HIGH: 2 });
    renderStage();
    expect(await screen.findByRole('button', { name: '보고서 제출' })).toBeTruthy();
    expect(reportPanel().dataset).toMatchObject({ work: workId, editable: 'true', print: 'true' });
    expect(screen.queryByRole('heading', { name: '작업 현황' })).toBeNull();
    // 보고서를 받았지만 서버가 아직 채우는 중이다.
    await waitFor(() => expect(requests).toContain('GET /api/reports/tbm'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(doneButton().disabled).toBe(true);

    // 서버가 다 채운 뒤 보고서를 다시 받으면(2초마다) 켜진다.
    clock += ENDING_DELAY_MS;
    await waitFor(() => expect(doneButton().disabled).toBe(false), { timeout: 5_000 });
    const { latest } = await fetchReportsByWork(api, workId);
    expect(latest?.wrap_up_status).toBe('SUCCEEDED');
    expect(latest?.form?.review.ending).toBe('작업 종료 · 총 작업 시간 01:05:00, 사건 3건');
    expect(putForms()).toEqual([]);
  });

  it.each(['SKIPPED', 'FAILED'])(
    '서버가 종료 미팅을 채우지 못했으면(%s) 비어 있어도 `보고서 제출` 가 켜지고 화면이 채워 저장하지 않는다',
    async (wrapUpStatus) => {
      const workId = await prepare('ended');
      const { latest } = await fetchReportsByWork(api, workId);
      server.use(
        http.get('*/api/reports/tbm', () =>
          HttpResponse.json({ latest: { ...latest, wrap_up_status: wrapUpStatus }, versions: [] }),
        ),
      );
      renderStage();
      await waitFor(() => expect(doneButton().disabled).toBe(false));
      expect(latest?.form?.review.ending).toBe('');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(putForms()).toEqual([]);
    },
  );

  it('`보고서 제출` 는 보낼지 묻고, 취소하면 보내지 않으며, 보내면 제출하고 onSubmitted 를 부른다', async () => {
    await prepare('ended');
    clock += ENDING_DELAY_MS;
    const onSubmitted = vi.fn();
    renderStage(onSubmitted);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '보고서 제출' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: '보고서 제출' }));
    const dialog = screen.getByRole('dialog', { name: '보고서를 제출할까요?' });
    expect(within(dialog).getByText('제출한 뒤에는 고칠 수 없습니다.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requests.some((r) => r.endsWith('/submit'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '보고서 제출' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '보고서를 제출할까요?' })).getByRole('button', {
        name: '제출',
      }),
    );

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(requests.filter((r) => r.endsWith('/submit'))).toHaveLength(1);
    // 서버 진행이 SUBMITTED 로 바뀌면 이 단계는 비고(날짜 화면이 다시 보기 화면을 보인다) `보고서 제출` 도 사라진다.
    await waitFor(() => expect(screen.queryByRole('button', { name: '보고서 제출' })).toBeNull());
  });

  it.each([
    [null, 'AI 초안을 만들지 않았습니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.'],
    ['FAILED', 'AI 초안을 만들지 못했습니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.'],
    ['SUCCEEDED', null],
  ] as const)(
    '보낼지 묻는 창은 AI 초안(%s)이 끝나지 않았으면 경고하되 보내기는 막지 않는다(-625)',
    async (draftStatus, warning) => {
      const workId = await prepare('ended');
      const { latest } = await fetchReportsByWork(api, workId);
      server.use(
        http.get('*/api/reports/tbm', () =>
          HttpResponse.json({
            latest: {
              ...latest,
              status: draftStatus ?? 'PENDING',
              draft_status: draftStatus,
              wrap_up_status: 'SUCCEEDED',
            },
            versions: [],
          }),
        ),
      );
      renderStage();
      await waitFor(() => expect(doneButton().disabled).toBe(false));
      fireEvent.click(doneButton());
      const dialog = screen.getByRole('dialog', { name: '보고서를 제출할까요?' });
      if (warning) {
        expect(within(dialog).getByText(warning)).toBeTruthy();
      } else {
        expect(within(dialog).queryByText(/AI 초안을/)).toBeNull();
      }
      expect(
        (within(dialog).getByRole('button', { name: '제출' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  it('AI 초안을 쓰는 중(status GENERATING)이면 종료 미팅이 끝났어도 `보고서 제출` 는 꺼 두고, 다 쓰면 켠다', async () => {
    const workId = await prepare('ended');
    clock += ENDING_DELAY_MS;
    const { latest } = await fetchReportsByWork(api, workId);
    expect(latest?.wrap_up_status).toBe('SUCCEEDED');
    let drafting = true;
    server.use(
      http.get('*/api/reports/tbm', () => {
        const status = drafting ? 'GENERATING' : 'SUCCEEDED';
        return HttpResponse.json({
          latest: { ...latest, status, draft_status: status },
          versions: [],
        });
      }),
    );
    const reportGets = () => requests.filter((r) => r === 'GET /api/reports/tbm').length;
    const before = reportGets();
    renderStage();
    await waitFor(() => expect(reportGets()).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(doneButton().disabled).toBe(true);

    // 서버가 초안을 다 쓴 뒤 보고서를 다시 받으면(2초마다) 켜진다.
    drafting = false;
    await waitFor(() => expect(doneButton().disabled).toBe(false), { timeout: 5_000 });
  });

  it.each([
    [WORK_ERROR.REPORT_NOT_READY, '보고서를 쓰는 중이에요. 잠시 뒤 다시 보내 주세요'],
    [WORK_ERROR.REPORT_LOCKED, '이미 제출한 보고서예요'],
    [WORK_ERROR.INVALID_STATE, '작업이 아직 끝나지 않았어요'],
    [WORK_ERROR.REPORT_VERSION_STALE, '보고서를 보내지 못했습니다. 다시 시도해 주세요.'],
  ])(
    '제출이 %s 로 실패하면 확인창에 그 안내를 보이고 onSubmitted 는 부르지 않는다',
    async (code, message) => {
      await prepare('ended');
      clock += ENDING_DELAY_MS;
      server.use(
        http.post('*/api/reports/tbm/:id/submit', () =>
          HttpResponse.json({ code, message: '안 됨' }, { status: 409 }),
        ),
      );
      const onSubmitted = vi.fn();
      renderStage(onSubmitted);
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: '보고서 제출' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole('button', { name: '보고서 제출' }));
      fireEvent.click(
        within(screen.getByRole('dialog', { name: '보고서를 제출할까요?' })).getByRole('button', {
          name: '제출',
        }),
      );

      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(onSubmitted).not.toHaveBeenCalled();
    },
  );
});

/** 확인한 위험 경보·해소된 경보를 만든다(종료 확인창·종료 뒤 요약 시험). */
const withAck = (entry: EventEntry): EventEntry => ({
  ...entry,
  event: {
    ...entry.event,
    acks: [
      {
        ack_id: 'a1',
        channel: 'CONTROL_ROOM',
        actor_role: 'ADMIN',
        actor_id: 'u1',
        acked_at: T0 + MIN,
      },
    ],
  },
});
const resolved = (entry: EventEntry): EventEntry => ({
  ...entry,
  event: { ...entry.event, lifecycle: 'RESOLVED' },
});

describe('RunStage — 종료 확인창의 미확인 위험 경보(-734)', () => {
  const openEnd = async () => {
    renderStage();
    fireEvent.click(await screen.findByRole('button', { name: '작업 종료' }));
    return screen.getByRole('dialog', { name: '작업을 종료할까요?' });
  };

  it('이번 실행에서 열려 있는데 확인하지 않은 위험 경보 수를 알리고, 종료는 막지 않는다', async () => {
    await prepare('running');
    live.entries = [
      eventAt('before', T0 - MIN, 'CRITICAL', 'z-04'), // 작업 전
      eventAt('open-1', T0 + 10_000, 'CRITICAL', 'z-04'),
      eventAt('open-2', T0 + 20_000, 'HIGH', 'z-02'),
      withAck(eventAt('acked', T0 + 30_000, 'HIGH', 'z-02')),
      eventAt('caution', T0 + 40_000, 'CAUTION', 'z-02'), // 경고 등급은 세지 않는다
    ];
    const dialog = await openEnd();
    const note = within(dialog).getByRole('alert');
    expect(note.textContent).toContain('미확인 위험 경보 2건');
    expect(note.textContent).toContain('관제 화면에서 먼저 확인');
    expect(
      (within(dialog).getByRole('button', { name: '종료' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('열린 미확인 경보가 없으면 0건이라고 알린다(해소된 경보는 확인을 받지 않는다)', async () => {
    await prepare('running');
    live.entries = [
      resolved(eventAt('done', T0 + 10_000, 'CRITICAL', 'z-04')),
      withAck(eventAt('acked', T0 + 20_000, 'HIGH', 'z-02')),
    ];
    const dialog = await openEnd();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('status').textContent).toContain('미확인 위험 경보 0건');
  });
});

describe('RunStage — 종료 뒤 요약·꺼진 이유·GPU 안내(-734)', () => {
  it('`보고서 제출` 이 꺼진 동안 이유를 단추 옆에 보이고, 켜지면 지운다', async () => {
    await prepare('ended');
    renderStage();
    // 보고서를 받는 동안은 「불러오는 중」이고, 받으면 서버가 쓰는 중인 종료 미팅이 이유다
    await waitFor(() =>
      expect(screen.getByTestId('action-reason').textContent).toBe('종료 미팅 작성 중이에요'),
    );
    expect(doneButton().disabled).toBe(true);

    clock += ENDING_DELAY_MS;
    await waitFor(() => expect(doneButton().disabled).toBe(false), { timeout: 5_000 });
    expect(screen.queryByTestId('action-reason')).toBeNull();
  });

  it('AI 초안을 쓰는 중이면 그 이유를 보인다', async () => {
    const workId = await prepare('ended');
    clock += ENDING_DELAY_MS;
    const { latest } = await fetchReportsByWork(api, workId);
    server.use(
      http.get('*/api/reports/tbm', () =>
        HttpResponse.json({
          latest: { ...latest, status: 'GENERATING', draft_status: 'GENERATING' },
          versions: [],
        }),
      ),
    );
    renderStage();
    await waitFor(() =>
      expect(screen.getByTestId('action-reason').textContent).toBe('AI 초안 작성 중이에요'),
    );
  });

  it('경과·시각과 위험 경보 수·확인하지 않은 경보 수를 요약 카드에 보인다', async () => {
    await prepare('ended');
    live.entries = [
      eventAt('before', T0 - MIN, 'CRITICAL', 'z-04'),
      resolved(eventAt('done-1', T0 + 10_000, 'CRITICAL', 'z-04')),
      resolved(eventAt('done-2', T0 + 20_000, 'HIGH', 'z-02')),
      resolved(withAck(eventAt('done-acked', T0 + 30_000, 'HIGH', 'z-02'))),
    ];
    renderStage();
    const card = await screen.findByLabelText('작업 요약');
    expect(within(card).getByRole('heading', { name: '작업 요약' })).toBeTruthy();
    expect(within(card).getByText(/01:05:00/)).toBeTruthy();
    expect(within(card).getByText('09:00–10:05')).toBeTruthy();
    expect(card.textContent).toContain('3건');
    expect(card.textContent).toContain('확인하지 않은 경보 2건');
  });

  it('GPU 가 켜져 있으면(관리자) 끄기 안내 카드를 보이고, 「GPU 끄기」가 끄기 패널을 연다', async () => {
    await prepare('ended');
    gpu.view = {
      isAdmin: true,
      dot: 'CONNECTED',
      clockOffsetMs: 0,
      status: {
        session: null,
        server_time_ms: NOW.value,
        launch: {
          state: 'RUNNING',
          gpu_type: 'H100',
          region: 'US-KS-2',
          price_per_hour_usd: 4.39,
          requested_at_ms: NOW.value - 166 * MIN,
        },
        power: 'CONNECTED',
      },
    };
    renderStage(undefined, vi.fn());
    const card = await screen.findByLabelText('GPU 끄기 안내');
    expect(within(card).getByRole('heading', { name: 'GPU 가 아직 켜져 있어요' })).toBeTruthy();
    expect(card.textContent).toContain('요금이 멈춰요');
    expect(card.textContent).toContain('한 번 더 실행할 거라면 켜 둔 채 두세요');
    expect(card.textContent).toContain('H100');
    fireEvent.click(within(card).getByRole('button', { name: 'GPU 끄기' }));
    expect(screen.getByRole('dialog', { name: 'GPU' })).toBeTruthy();
  });

  it('GPU 가 꺼져 있거나 관리자가 아니면 끄기 안내 카드를 그리지 않는다', async () => {
    await prepare('ended');
    renderStage();
    expect(await screen.findByLabelText('작업 요약')).toBeTruthy();
    expect(screen.queryByLabelText('GPU 끄기 안내')).toBeNull();
    cleanup();
    gpu.view = {
      isAdmin: true,
      status: { session: null, server_time_ms: 1 },
      dot: 'OFF',
      clockOffsetMs: 0,
    };
    renderStage();
    expect(await screen.findByLabelText('작업 요약')).toBeTruthy();
    expect(screen.queryByLabelText('GPU 끄기 안내')).toBeNull();
  });
});

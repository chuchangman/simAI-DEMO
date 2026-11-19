import { workDayOf } from '@/__tests__/features/work/workFixture';
import type { ReplayIndex } from '@/features/history/replayIndex';
import { workTimeRange } from '@/features/history/works';
import { TBM_TASKS } from '@/features/tbm/tbmDemo';
import { PastDayPage } from '@/features/work/past/PastDayPage';
import { ZONES_KEY } from '@/features/zones/api';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock } from '@/mocks/work';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
/** 재생 엔진 대역: 화면이 쓰는 재생 Source 와 기록 색인, 화면이 고른 작업. */
const engine = vi.hoisted(() => ({
  replay: null as unknown,
  index: null as unknown,
  works: [] as string[],
}));

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
// 재생 엔진(three.js 입구)은 쓰지 않는다: 작업의 구간만 계산해 대역 Source 를 돌려주고, CCTV 화면은 자리만 둔다.
vi.mock('@/features/history/useWorkReplay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/history/useWorkReplay')>();
  return {
    ...actual,
    // 작업이 정해지기 전(목록을 받는 중)에는 실제 훅처럼 재생 Source 가 없다.
    useWorkReplay: (work?: {
      work_id: string;
      actual_started_at?: number | null;
      actual_ended_at?: number | null;
    }) => {
      if (work) engine.works.push(work.work_id);
      const from = work?.actual_started_at ?? null;
      const to = work?.actual_ended_at ?? (from === null ? null : from + 60_000);
      return {
        range: from !== null && to !== null && to > from ? { from, to } : null,
        stepMs: 1000,
        holdMs: 1000,
        loading: false,
        failed: false,
        error: null,
        replay: work ? engine.replay : null,
        index: work ? engine.index : null,
      };
    },
  };
});
vi.mock('@/features/history/ReplayStage', () => ({
  ReplayStage: ({ range }: { range: { from: number } }) => (
    <div data-testid="replay-stage" data-from={range.from} />
  ),
}));
vi.mock('@/features/work/past/PastReportPanel', () => ({
  PastReportPanel: ({ workId }: { workId: string }) => (
    <div data-testid="report-panel" data-work={workId} />
  ),
}));

const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const YESTERDAY = '2026-11-10';
const FIRST_FRAME = new Date(2026, 10, 10, 9, 0, 5).getTime();
const EVENT_AT = new Date(2026, 10, 10, 9, 10, 0).getTime();

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers(...createWorkMock({ now: () => T0 }).handlers, ...createTbmMock().handlers);
});
afterEach(() => {
  cleanup();
  navigate.mockClear();
  engine.replay = null;
  engine.index = null;
  engine.works = [];
});

/** 대역 재생 Source 와 색인(기록 한 칸 + 첫 기록 전의 사건 하나 + 첫 기록 뒤의 사건 하나). */
function fakeReplay() {
  const status = {
    playhead: null,
    start: null,
    end: null,
    playing: false,
    ended: false,
    speed: 1,
    worldT: null,
    recordAgeMs: null,
    gap: false,
  };
  const replay = {
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setSpeed: vi.fn(),
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
  };
  const index: ReplayIndex = {
    frames: [{ t: FIRST_FRAME, ids: [], tracks: [] }],
    workers: [],
    events: [
      {
        eventId: 'early',
        ruleId: 'R2',
        severity: 'HIGH',
        worldIds: [],
        zoneId: 'z-04',
        raisedAt: FIRST_FRAME - 1000,
        resolvedAt: null,
      },
      {
        eventId: 'e-1',
        ruleId: 'R2',
        severity: 'CRITICAL',
        worldIds: [],
        zoneId: 'z-04',
        raisedAt: EVENT_AT,
        resolvedAt: null,
      },
    ],
    gaps: [],
    pending: null,
  };
  engine.replay = replay;
  engine.index = index;
  return replay;
}

function renderPage(date = YESTERDAY) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <PastDayPage date={date} />
    </QueryClientProvider>,
  );
}

// 숨겨진 요소는 접근 가능한 이름이 비므로 aria-label 로 찾는다.
const tabpanel = (name: string) =>
  screen
    .getAllByRole('tabpanel', { hidden: true })
    .find((p) => p.getAttribute('aria-label') === name)!;

describe('PastDayPage — 머리', () => {
  it('달력 단추 · 날짜 · 칩 `지난 작업` 을 보이고, 달력 단추는 작업 관리 달력으로 보낸다', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: '2026년 11월 10일 (화)' })).toBeTruthy();
    expect(screen.getByText('지난 작업')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/work' });
  });

  it('그날 작업이 없으면 `기록된 작업이 없습니다.`', async () => {
    renderPage('2026-11-05');
    expect(await screen.findByText('기록된 작업이 없습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '달력' })).toBeTruthy();
    expect(screen.queryByTestId('replay-stage')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('끝나지 않은 작업(보고서·세팅·작업 중)만 있는 날은 달력 칸이 빈칸이므로 `기록된 작업이 없습니다.`', async () => {
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({ work_id: '8101', date: YESTERDAY, progress: 'REPORT' }),
            workDayOf({ work_id: '8102', date: YESTERDAY, progress: 'SETUP' }),
            workDayOf({
              work_id: '8103',
              date: YESTERDAY,
              progress: 'IN_PROGRESS',
              actual_started_at: new Date(2026, 10, 10, 9, 0).getTime(),
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('기록된 작업이 없습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '달력' })).toBeTruthy();
    expect(screen.queryByTestId('replay-stage')).toBeNull();
    expect(screen.queryByTestId('report-panel')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('끝난 작업과 끝나지 않은 작업이 섞인 날은 끝난 작업만 보인다', async () => {
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({ work_id: '8201', date: YESTERDAY, progress: 'IN_PROGRESS' }),
            workDayOf({
              work_id: '8202',
              date: YESTERDAY,
              progress: 'ENDED',
              actual_started_at: new Date(2026, 10, 10, 9, 0).getTime(),
              actual_ended_at: new Date(2026, 10, 10, 10, 0).getTime(),
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByTestId('report-panel')).toBeTruthy();
    expect(screen.getByTestId('report-panel').dataset.work).toBe('8202');
    // 끝난 작업이 하나뿐이라 작업 선택기가 없다.
    expect(screen.queryByRole('group', { name: '작업 선택' })).toBeNull();
  });

  it('작업 목록을 못 받으면 안내를 보인다', async () => {
    server.use(http.get('*/api/work-units', () => new HttpResponse(null, { status: 500 })));
    renderPage();
    expect(await screen.findByText('작업 목록을 불러오지 못했습니다.')).toBeTruthy();
  });
});

describe('PastDayPage — 작업 선택', () => {
  it('그날 작업이 2건 이상이면 `이름 · HH:mm–HH:mm` 선택기를 보이고, 고르면 그 작업의 보고서·다시 보기로 바뀐다', async () => {
    renderPage();
    const picker = await screen.findByRole('group', { name: '작업 선택' });
    const choices = within(picker).getAllByRole('button');
    expect(choices).toHaveLength(TBM_TASKS.length);
    expect(choices.map((c) => c.textContent)).toEqual(
      TBM_TASKS.map(
        (task) =>
          `${task.name} · ${workTimeRange({
            ...workDayOf(),
            actual_started_at: new Date(`2026-11-10T${task.from}:00`).getTime(),
            actual_ended_at: new Date(`2026-11-10T${task.to}:00`).getTime(),
          })}`,
      ),
    );
    expect(choices.map((c) => c.getAttribute('aria-pressed'))).toEqual(
      TBM_TASKS.map((_, i) => String(i === 0)),
    );

    const firstWork = screen.getByTestId('report-panel').dataset.work;
    fireEvent.click(choices[1]!);
    expect(choices[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(choices[0]!.getAttribute('aria-pressed')).toBe('false');
    const secondWork = screen.getByTestId('report-panel').dataset.work;
    expect(secondWork).not.toBe(firstWork);
    expect(engine.works.at(-1)).toBe(secondWork);
  });

  it('작업이 1건이면 선택기를 보이지 않는다', async () => {
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({
              work_id: '8001',
              date: YESTERDAY,
              name: '철근 배근',
              progress: 'SUBMITTED',
              actual_started_at: new Date(2026, 10, 10, 9, 0).getTime(),
              actual_ended_at: new Date(2026, 10, 10, 10, 0).getTime(),
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByTestId('report-panel')).toBeTruthy();
    expect(screen.getByTestId('report-panel').dataset.work).toBe('8001');
    expect(screen.queryByRole('group', { name: '작업 선택' })).toBeNull();
  });
});

describe('PastDayPage — 본문', () => {
  it('왼쪽 `CCTV 다시 보기` 와 타임라인, 오른쪽 열 탭을 보이고 작업자 목록은 없다', async () => {
    fakeReplay();
    renderPage();
    expect(await screen.findByTestId('replay-stage')).toBeTruthy();
    const cctv = screen.getByRole('region', { name: 'CCTV 다시 보기' });
    expect(within(cctv).getByTestId('replay-stage')).toBeTruthy();
    expect(screen.getByRole('region', { name: '타임라인' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'TBM 보고서',
      '이벤트 로그',
    ]);
    expect(screen.queryByRole('list', { name: '작업자 목록' })).toBeNull();
    expect(screen.queryByText('작업자')).toBeNull();
  });

  it('처음 보일 시각은 첫 기록 뒤의 첫 사건이고, 타임라인의 사건 표시를 누르면 그 시각으로 옮긴다', async () => {
    const replay = fakeReplay();
    renderPage();
    await waitFor(() => expect(replay.seek).toHaveBeenCalledWith(EVENT_AT));
    replay.seek.mockClear();

    fireEvent.click(screen.getAllByRole('button', { name: /^이벤트 / })[0]!);
    expect(replay.seek).toHaveBeenCalledTimes(1);
    expect(replay.seek).toHaveBeenCalledWith(FIRST_FRAME - 1000);
  });

  describe('긴 작업: 앞 구간만 받고 화면이 뜬 뒤 뒤 구간이 오는 경우의 처음 보일 시각', () => {
    /** 앞 구간만 받은 색인(첫 사건은 아직 못 받은 뒤 구간에 있다). */
    const partialIndex = (): ReplayIndex => ({
      ...(engine.index as ReplayIndex),
      events: [],
      pending: { from: FIRST_FRAME + 1000, to: EVENT_AT + 1000 },
    });

    /** seek 이 재생 시각을 실제처럼 바꾸는 대역과, 같은 화면을 다시 그리게 하는 함수. */
    function renderGrowing() {
      const replay = fakeReplay();
      const status = replay.getStatus() as { playhead: number | null; playing: boolean };
      replay.seek.mockImplementation((t: number) => {
        status.playhead = t;
        return true;
      });
      const full = engine.index as ReplayIndex;
      engine.index = partialIndex();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(ZONES_KEY, MOCK_ZONES);
      const tree = () => (
        <QueryClientProvider client={client}>
          <PastDayPage date={YESTERDAY} />
        </QueryClientProvider>
      );
      const { rerender } = render(tree());
      return {
        replay,
        status,
        /** 뒤 구간이 와서 첫 사건이 보이게 된 색인으로 바꾸고 다시 그린다. */
        grow: () => {
          engine.index = full;
          rerender(tree());
        },
      };
    }

    it('앞 구간만으로 첫 기록 시각에서 시작하고, 사용자가 건드리지 않았으면 뒤 구간에서 첫 사건이 나올 때 그 시각으로 옮긴다', async () => {
      const { replay, grow } = renderGrowing();
      await waitFor(() => expect(replay.seek).toHaveBeenCalledWith(FIRST_FRAME));
      expect(replay.seek).toHaveBeenCalledTimes(1);

      grow();
      await waitFor(() => expect(replay.seek).toHaveBeenLastCalledWith(EVENT_AT));
      expect(replay.seek).toHaveBeenCalledTimes(2);
    });

    it('사용자가 재생 시각을 옮겼으면 첫 사건이 나와도 그 자리를 지킨다', async () => {
      const { replay, status, grow } = renderGrowing();
      await waitFor(() => expect(replay.seek).toHaveBeenCalledWith(FIRST_FRAME));
      status.playhead = FIRST_FRAME + 5_000;

      grow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replay.seek).toHaveBeenCalledTimes(1);
    });

    it('사용자가 재생을 눌렀으면 첫 사건이 나와도 그 자리를 지킨다', async () => {
      const { replay, status, grow } = renderGrowing();
      await waitFor(() => expect(replay.seek).toHaveBeenCalledWith(FIRST_FRAME));
      status.playing = true;

      grow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replay.seek).toHaveBeenCalledTimes(1);
    });

    it('같은 시각으로 다시 계산돼도(앞 구간이 늘 뿐 첫 사건은 그대로) 다시 옮기지 않는다', async () => {
      const { replay, grow } = renderGrowing();
      await waitFor(() => expect(replay.seek).toHaveBeenCalledWith(FIRST_FRAME));
      grow();
      await waitFor(() => expect(replay.seek).toHaveBeenLastCalledWith(EVENT_AT));
      const calls = replay.seek.mock.calls.length;

      grow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replay.seek).toHaveBeenCalledTimes(calls);
    });
  });

  it('시작하지 않아 다시 볼 구간이 없으면 안내를 보이고 오른쪽 열은 그대로 둔다', async () => {
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({
              work_id: '8002',
              date: YESTERDAY,
              progress: 'SUBMITTED',
              actual_started_at: null,
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('아직 다시 볼 구간이 없습니다.')).toBeTruthy();
    expect(screen.queryByTestId('replay-stage')).toBeNull();
    expect(screen.queryByRole('region', { name: '타임라인' })).toBeNull();
    expect(screen.getByTestId('report-panel').dataset.work).toBe('8002');
  });

  it('시작과 종료가 같은 0초 작업이나 빈 기록이면 0초 타임라인 없이 사유를 가운데 한 번만 보인다(S15P31A101-749)', async () => {
    const startMs = new Date(2026, 10, 10, 15, 26, 14).getTime();
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({
              work_id: '8003',
              date: YESTERDAY,
              progress: 'ENDED',
              actual_started_at: startMs,
              actual_ended_at: startMs,
            }),
          ],
        }),
      ),
    );
    renderPage();
    expect(
      await screen.findAllByText('작업이 시작 직후 바로 종료되어(0초) 저장된 기록이 없습니다.'),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'CCTV 다시 보기' })).getByRole('status'),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: '타임라인' })).toBeNull();
    cleanup();

    fakeReplay();
    engine.index = {
      frames: [],
      workers: [],
      events: [],
      gaps: [{ from: startMs, to: startMs + 500 }],
      pending: null,
    } satisfies ReplayIndex;
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({
          works: [
            workDayOf({
              work_id: '8004',
              date: YESTERDAY,
              progress: 'ENDED',
              actual_started_at: startMs,
              actual_ended_at: startMs + 500,
            }),
          ],
        }),
      ),
    );
    renderPage();
    // 빈 기록 사유는 가운데 ReplayStage 가 보인다(위 띠에는 두지 않는다).
    expect(await screen.findByTestId('replay-stage')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '타임라인' })).toBeNull();
    expect(screen.queryByText(/저장된 기록이 없습니다/)).toBeNull();
  });
});

describe('PastDayPage — 오른쪽 열 탭', () => {
  it('탭을 바꿔도 `TBM 보고서` 와 `이벤트 로그` 두 패널이 모두 마운트돼 있다', async () => {
    fakeReplay();
    renderPage();
    const report = await screen.findByTestId('report-panel');
    expect(screen.getByRole('tab', { name: 'TBM 보고서' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(tabpanel('TBM 보고서').hidden).toBe(false);
    expect(tabpanel('이벤트 로그').hidden).toBe(true);
    // 이벤트 로그도 이미 그려져 있다(숨겨져 있을 뿐).
    expect(
      within(tabpanel('이벤트 로그')).getAllByRole('listitem', { hidden: true }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '이벤트 로그' }));
    expect(screen.getByRole('tab', { name: '이벤트 로그' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(tabpanel('이벤트 로그').hidden).toBe(false);
    expect(tabpanel('TBM 보고서').hidden).toBe(true);
    // 보고서는 그대로 마운트돼 있다(같은 요소).
    expect(screen.getByTestId('report-panel')).toBe(report);

    fireEvent.click(screen.getByRole('tab', { name: 'TBM 보고서' }));
    expect(tabpanel('TBM 보고서').hidden).toBe(false);
  });

  it('이벤트 로그의 사건을 누르면 그 시각으로 옮긴다', async () => {
    const replay = fakeReplay();
    renderPage();
    await screen.findByTestId('report-panel');
    await waitFor(() => expect(replay.seek).toHaveBeenCalled());
    replay.seek.mockClear();

    fireEvent.click(screen.getByRole('tab', { name: '이벤트 로그' }));
    const log = screen.getByRole('list', { name: '이벤트 로그' });
    const rows = within(log).getAllByRole('button');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!);
    expect(replay.seek).toHaveBeenCalledWith(EVENT_AT);
  });
});

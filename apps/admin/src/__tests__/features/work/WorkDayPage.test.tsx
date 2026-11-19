import { workDayOf } from '@/__tests__/features/work/workFixture';
import { useAbandonedSetupStore } from '@/features/setup/abandonedSetup.store';
import { WORK_ERROR } from '@/features/work/api';
import type { DayProgress, WorkDayItem } from '@/features/work/types';
import { WorkDayPage } from '@/features/work/WorkDayPage';
import { openDayKey, WORK_KEY } from '@/lib/queryKeys';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { POLL_MS } = vi.hoisted(() => ({ POLL_MS: 40 }));

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
// 하루 작업을 다시 받는 주기(실제 3초)를 시험에서 짧게 한다.
vi.mock('@/features/work/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/work/api')>()),
  WORK_DAY_POLL_MS: POLL_MS,
}));
// 단계 화면은 일꾼마다 따로 채우는 파일이라 대역으로 갈아 끼운다(어느 단계인지만 data-work-stub 로 보인다).
vi.mock('@/features/work/report/ReportStage', async () => ({
  ReportStage: (await import('@/__tests__/features/work/stageStub')).stubStage('report-stage'),
}));
vi.mock('@/features/work/SetupStage', async () => ({
  SetupStage: (await import('@/__tests__/features/work/stageStub')).stubStage('setup-stage'),
}));
vi.mock('@/features/work/preflight/PreflightStage', async () => ({
  PreflightStage: (await import('@/__tests__/features/work/stageStub')).stubStage(
    'preflight-stage',
  ),
}));
vi.mock('@/features/work/run/RunStage', async () => ({
  RunStage: (await import('@/__tests__/features/work/stageStub')).stubStage('run-stage'),
}));

// 날짜 화면(오늘·예정인 날): 머리줄 + 단계 줄 + 서버 progress 가 정한 단계 화면. 서버는 '하루 작업 열기(PUT daily)' 만 흉내 낸다.

const TODAY = '2026-11-11';
const TOMORROW = '2026-11-12';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 서버가 지금 돌려주는 하루 작업(시험이 progress 를 바꾼다). */
let serverDay: WorkDayItem;
/** 이 시험에서 하루 작업 열기가 간 날짜. */
let opened: string[] = [];
let failOpen = false;
/** 하루 작업 열기가 오늘 이전 날짜라 거절되는 경우(409 WORK_DATE_PAST). */
let openInPast = false;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  useAbandonedSetupStore.setState({ entries: [] });
  serverDay = workDayOf({ work_id: '9001', progress: 'REPORT' });
  opened = [];
  failOpen = false;
  openInPast = false;
  server.resetHandlers(
    http.put('*/api/work-units/daily/:date', ({ params }) => {
      opened.push(String(params.date));
      if (openInPast) return HttpResponse.json({ code: WORK_ERROR.DATE_PAST }, { status: 409 });
      if (failOpen) return HttpResponse.json({ code: 'SERVER_ERROR' }, { status: 500 });
      return HttpResponse.json({ ...serverDay, date: String(params.date) });
    }),
  );
});
afterEach(cleanup);

function renderDay({
  date = TODAY,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: { date?: string; client?: QueryClient } = {}) {
  const onBack = vi.fn();
  const onSubmitted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <WorkDayPage date={date} todayKey={TODAY} onBack={onBack} onSubmitted={onSubmitted} />
    </QueryClientProvider>,
  );
  return { client, onBack, onSubmitted };
}

const stageName = () =>
  document.querySelector('[data-work-stub]')?.getAttribute('data-work-stub') ?? null;
const navState = (label: string) =>
  within(screen.getByRole('navigation', { name: '작업 단계' }))
    .getByText(label)
    .closest('li')
    ?.getAttribute('data-state');

/** 서버 progress 가 바뀌었다고 치고 하루 작업을 다시 받게 한다. */
async function serverMoves(client: QueryClient, progress: DayProgress) {
  serverDay = { ...serverDay, progress };
  await act(() => client.invalidateQueries({ queryKey: WORK_KEY }));
}

describe('WorkDayPage 머리줄', () => {
  it('오늘 날짜는 달력 단추 · 날짜 · 오늘 칩 · 단계 줄을 보이고 보고서 단계에서 시작한다', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    expect(screen.getByRole('button', { name: '달력' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2026년 11월 11일 (수)' })).toBeTruthy();
    expect(screen.getByText('오늘')).toBeTruthy();
    expect(screen.queryByText('예정')).toBeNull();
    const nav = screen.getByRole('navigation', { name: '작업 단계' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(4);
    expect(navState('TBM 보고서')).toBe('current');
    expect(opened).toEqual([TODAY]);
  });

  it('예정인 날짜는 예정 칩을 보이고 그 날짜로 하루 작업을 연다', async () => {
    renderDay({ date: TOMORROW });
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    expect(screen.getByRole('heading', { name: '2026년 11월 12일 (목)' })).toBeTruthy();
    expect(screen.getByText('예정')).toBeTruthy();
    expect(screen.queryByText('오늘')).toBeNull();
    expect(opened).toEqual([TOMORROW]);
  });

  it('단계 화면에 작업·날짜·오늘 키를 넘긴다', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    const stage = document.querySelector('[data-work-stub]');
    expect(stage?.getAttribute('data-work')).toBe('9001');
    expect(stage?.getAttribute('data-date')).toBe(TODAY);
    expect(stage?.getAttribute('data-today')).toBe(TODAY);
  });

  it('달력 단추를 누르면 알린다', async () => {
    const { onBack } = renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('WorkDayPage 단계 선택', () => {
  it.each([
    ['REPORT', 'report-stage', 'TBM 보고서', 'current'],
    ['SETUP', 'setup-stage', '세팅', 'current'],
    ['SETUP_DONE', 'preflight-stage', '작업 전 확인', 'current'],
    ['IN_PROGRESS', 'run-stage', '작업 종료', 'current'],
    ['ENDED', 'run-stage', '작업 종료', 'done'],
  ] as const)(
    '서버 progress %s 는 %s 를 열고 단계 줄의 %s 단계가 %s 다',
    async (progress, stub, label, state) => {
      serverDay = { ...serverDay, progress };
      renderDay();
      await waitFor(() => expect(stageName()).toBe(stub));
      expect(navState(label)).toBe(state);
    },
  );

  it('머리줄에 진행 상태 글(세팅 전·관제 중·끝남 등)을 보이지 않는다', async () => {
    serverDay = { ...serverDay, progress: 'ENDED' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    expect(screen.queryByText('끝남')).toBeNull();
  });

  it('지난 단계는 완료(✓), 남은 단계는 대기로 보인다', async () => {
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    expect(navState('TBM 보고서')).toBe('done');
    expect(navState('세팅')).toBe('done');
    expect(navState('작업 종료')).toBe('todo');
  });

  it('진행 값을 모르는 작업(progress null)은 보고서 단계다', async () => {
    serverDay = { ...serverDay, progress: null };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
  });

  it('단계 줄은 표시만 한다: 눌러도 단계가 바뀌지 않는다', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByText('작업 전 확인'));
    fireEvent.click(screen.getByText('작업 종료'));
    expect(stageName()).toBe('report-stage');
    expect(navState('TBM 보고서')).toBe('current');
  });
});

describe('WorkDayPage 다음(onNext)', () => {
  it('서버 progress 가 아직 REPORT 여도 보고서 → 세팅은 로컬에서 넘어가지만, 작업 전 확인은 서버가 세팅 완료를 알린 뒤에만 연다', async () => {
    const { client } = renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));

    fireEvent.click(screen.getByRole('button', { name: 'report-stage 다음' }));
    expect(stageName()).toBe('setup-stage');
    expect(navState('TBM 보고서')).toBe('done');
    expect(navState('세팅')).toBe('current');

    // 세팅 단계의 다음(onNext)은 단계를 옮기지 않는다: 작업 시작 단추가 있는 단계는 세팅 완료(setup_completed_at) 뒤다(-642)
    fireEvent.click(screen.getByRole('button', { name: 'setup-stage 다음' }));
    expect(stageName()).toBe('setup-stage');
    await serverMoves(client, 'SETUP');
    expect(stageName()).toBe('setup-stage');

    await serverMoves(client, 'SETUP_DONE');
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    expect(navState('세팅')).toBe('done');
    expect(navState('작업 전 확인')).toBe('current');
  });

  it('작업 전 확인·작업 종료 단계의 onNext 는 단계를 옮기지 않는다(그 뒤는 서버 progress 가 따라온다)', async () => {
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'preflight-stage 다음' }));
    expect(stageName()).toBe('preflight-stage');
  });

  it('우측 아래 단추 줄(다음)을 누르면 단계 화면의 onNext 가 불린다', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(stageName()).toBe('setup-stage');
  });

  it('마지막 단계의 단추는 완료이고, 누르면 달력으로 나가도록 알린다', async () => {
    serverDay = { ...serverDay, progress: 'ENDED' };
    const { onSubmitted } = renderDay();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('작업 종료 단계가 보고서를 보냈다고 알리면 날짜 화면이 그대로 알린다', async () => {
    serverDay = { ...serverDay, progress: 'ENDED' };
    const { onSubmitted } = renderDay();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'run-stage 보내기' }));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});

describe('WorkDayPage 한 번 더 실행(S15P31A101-696)', () => {
  const T = new Date(2026, 10, 11, 9, 0).getTime();
  const ended = (runs: number) =>
    workDayOf({
      progress: 'ENDED',
      status: 'DONE',
      actual_started_at: T,
      actual_ended_at: T + runs * 3_600_000 - 1_800_000,
      runs: Array.from({ length: runs }, (_, i) => ({
        run_no: i + 1,
        started_at: T + i * 3_600_000,
        ended_at: T + i * 3_600_000 + 1_800_000,
      })),
    });

  it('종료 화면에서 한 번 더 실행을 누르면 다음 실행 번호로 작업 전 확인을 열고, 작업 종료로 돌아갈 수 있다', async () => {
    serverDay = ended(1);
    renderDay();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'run-stage 한 번 더' }));
    expect(stageName()).toBe('preflight-stage');
    expect(document.querySelector('[data-work-stub]')?.getAttribute('data-rerun')).toBe('2');
    expect(navState('작업 전 확인')).toBe('current');
    fireEvent.click(screen.getByRole('button', { name: 'preflight-stage 작업 종료로' }));
    expect(stageName()).toBe('run-stage');
  });

  it('그 실행이 시작되고 끝나면(마지막 실행 번호가 바뀌면) 다시 종료 화면이다', async () => {
    serverDay = ended(1);
    const { client } = renderDay();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'run-stage 한 번 더' }));
    expect(stageName()).toBe('preflight-stage');
    serverDay = ended(2);
    await act(() => client.invalidateQueries({ queryKey: WORK_KEY }));
    await waitFor(() => expect(stageName()).toBe('run-stage'));
  });
});

describe('WorkDayPage 서버 progress 가 앞서면 따라간다', () => {
  it('보고서에 있다가 서버가 세팅 완료가 되면 작업 전 확인으로 간다', async () => {
    const { client } = renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    await serverMoves(client, 'SETUP_DONE');
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    expect(navState('작업 전 확인')).toBe('current');
  });

  it('로컬이 세팅에 있다가 서버가 작업 중이 되면 작업 종료로 간다', async () => {
    const { client } = renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'report-stage 다음' }));
    expect(stageName()).toBe('setup-stage');
    await serverMoves(client, 'IN_PROGRESS');
    await waitFor(() => expect(stageName()).toBe('run-stage'));
  });

  it('서버 progress 가 로컬보다 뒤(REPORT)여도 로컬 단계를 되돌리지 않는다', async () => {
    const { client } = renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'report-stage 다음' }));
    await serverMoves(client, 'REPORT');
    expect(stageName()).toBe('setup-stage');
  });
});

describe('WorkDayPage 서버가 못 따라온 동안 다시 받는다', () => {
  it('로컬이 보고서 → 세팅으로 앞서 있고 서버가 아직 REPORT 여도, 서버가 세팅 완료가 되면 작업 전 확인으로 따라온다', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    fireEvent.click(screen.getByRole('button', { name: 'report-stage 다음' }));
    expect(stageName()).toBe('setup-stage');

    // 세션을 만든 쪽이 캐시를 건드리지 않아도 하루 작업을 계속 다시 받는다.
    const opens = opened.length;
    await waitFor(() => expect(opened.length).toBeGreaterThan(opens + 1));
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    expect(navState('작업 전 확인')).toBe('current');
  });

  it('서버 progress 가 세팅 중(SETUP)이면 SETUP_DONE 이 될 때까지 다시 받는다', async () => {
    serverDay = { ...serverDay, progress: 'SETUP' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('setup-stage'));
    const opens = opened.length;
    await waitFor(() => expect(opened.length).toBeGreaterThan(opens + 1));
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
  });

  it('화면이 서버와 같은 단계면 다시 받지 않는다(보고서·작업 전 확인)', async () => {
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    await sleep(POLL_MS * 5);
    expect(opened).toEqual([TODAY]);
    cleanup();

    opened = [];
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    await sleep(POLL_MS * 5);
    expect(opened).toEqual([TODAY]);
  });
});

describe('WorkDayPage 「세팅 취소」로 버린 세팅', () => {
  const abandon = (sessionId: string) =>
    act(() => useAbandonedSetupStore.getState().abandon(serverDay.work_id, sessionId));

  it('서버가 세팅 중(SETUP)이어도 작업의 세팅 세션을 버리면 TBM 보고서로 돌아가고, 다음을 누르면 세팅으로 간다', async () => {
    serverDay = { ...serverDay, progress: 'SETUP', active_setup_session_id: 'sess-1' };
    renderDay();
    await waitFor(() => expect(stageName()).toBe('setup-stage'));

    abandon('sess-1');
    expect(stageName()).toBe('report-stage');

    fireEvent.click(screen.getByRole('button', { name: 'report-stage 다음' }));
    expect(stageName()).toBe('setup-stage');
  });

  it('다시 열어도 보고서이고, 새 세팅을 시작해 작업의 세션이 바뀌면 서버 단계를 따른다', async () => {
    serverDay = { ...serverDay, progress: 'SETUP', active_setup_session_id: 'sess-1' };
    abandon('sess-1');
    renderDay();
    await waitFor(() => expect(stageName()).toBe('report-stage'));

    serverDay = { ...serverDay, active_setup_session_id: 'sess-2' };
    await waitFor(() => expect(stageName()).toBe('setup-stage'));
  });
});

describe('WorkDayPage 열 때 캐시', () => {
  it('달력에 나갔다 돌아오면 낡은 캐시(REPORT)로 단계를 보이지 않고 새로 받은 값으로 연다', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(openDayKey(TODAY), workDayOf({ work_id: '9001', progress: 'REPORT' }));
    serverDay = { ...serverDay, progress: 'SETUP_DONE' };

    renderDay({ client });
    // 첫 화면부터 보고서 단계가 아니라 불러오는 중이다.
    expect(stageName()).toBeNull();
    expect(screen.getByText('불러오는 중입니다…')).toBeTruthy();
    await waitFor(() => expect(stageName()).toBe('preflight-stage'));
    expect(opened).toEqual([TODAY]);
  });
});

describe('WorkDayPage 불러오기', () => {
  it('하루 작업을 여는 동안은 머리줄과 불러오는 중 글을 보이고 단계 줄·단계 화면은 없다', async () => {
    renderDay();
    expect(screen.getByRole('heading', { name: '2026년 11월 11일 (수)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '달력' })).toBeTruthy();
    expect(screen.getByText('불러오는 중입니다…')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '작업 단계' })).toBeNull();
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    expect(screen.queryByText('불러오는 중입니다…')).toBeNull();
  });

  it('못 열면 알리고, 다시 시도하면 연다', async () => {
    failOpen = true;
    const { onBack } = renderDay();
    expect(await screen.findByText('작업을 불러오지 못했습니다.')).toBeTruthy();
    expect(stageName()).toBeNull();
    // 오류 중에도 달력으로 돌아갈 수 있다.
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    failOpen = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(stageName()).toBe('report-stage'));
    expect(screen.queryByText('작업을 불러오지 못했습니다.')).toBeNull();
  });

  it('지난 날짜라 거절되면(WORK_DATE_PAST) 다시 시도 단추 없이 새로 열 수 없다고 알린다', async () => {
    openInPast = true;
    const { onBack } = renderDay();
    expect(await screen.findByText('지난 날짜는 새로 열 수 없어요.')).toBeTruthy();
    expect(screen.queryByText('작업을 불러오지 못했습니다.')).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

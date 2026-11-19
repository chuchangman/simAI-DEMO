import { workDayOf } from '@/__tests__/features/work/workFixture';
import { WorkPage } from '@/features/work/WorkPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
// 단계 화면·지난 날짜 화면은 일꾼마다 따로 채우는 파일이라 대역으로 갈아 끼운다.
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
// 지난 날짜 화면 대역: 날짜와 '작업을 골랐는가'(화면 안 상태)를 보인다.
vi.mock('@/features/work/past/PastDayPage', async () => {
  const { useState } = await import('react');
  return {
    PastDayPage: function PastDayPage({ date }: { date: string }) {
      const [picked, setPicked] = useState(false);
      return (
        <div data-work-stub="past-day" data-date={date} data-picked={String(picked)}>
          <button type="button" onClick={() => setPicked(true)}>
            작업 고르기
          </button>
        </div>
      );
    },
  };
});

// 작업 관리 첫 화면(날짜가 없으면 달력, 지난 날은 다시 보기, 그 밖은 작업 흐름). 오늘은 2026-11-11(수).

const TODAY = '2026-11-11';

/** 하루 작업 열기가 간 날짜. 지난 날은 하루 작업을 열지 않는다. */
let opened: string[] = [];
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  opened = [];
  server.resetHandlers(
    http.get('*/api/work-units', () => HttpResponse.json({ works: [] })),
    http.put('*/api/work-units/daily/:date', ({ params }) => {
      opened.push(String(params.date));
      return HttpResponse.json(workDayOf({ date: String(params.date), progress: 'ENDED' }));
    }),
  );
});
afterEach(cleanup);

/** 부모가 알린 날짜 요청(date 또는 null). */
let calls: (string | null)[] = [];

/** 주소의 ?date= 를 대신 들고 있는 부모(실제로는 라우트가 한다). 날짜 요청을 기록한다. */
function Harness({ initial }: { initial?: string }) {
  const [date, setDate] = useState<string | undefined>(initial);
  return (
    <WorkPage
      date={date}
      todayKey={TODAY}
      onOpenDate={(next) => {
        calls.push(next);
        setDate(next ?? undefined);
      }}
    />
  );
}
function renderPage(initial?: string) {
  calls = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const stageName = () =>
  document.querySelector('[data-work-stub]')?.getAttribute('data-work-stub') ?? null;

describe('WorkPage', () => {
  it('날짜가 없으면 달력이다(오늘이 든 달)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeTruthy();
    expect(stageName()).toBeNull();
  });

  it('지난 날짜는 지난 날짜 화면이고 하루 작업을 열지 않는다', async () => {
    renderPage('2026-11-10');
    expect(stageName()).toBe('past-day');
    expect(document.querySelector('[data-work-stub]')?.getAttribute('data-date')).toBe(
      '2026-11-10',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(opened).toEqual([]);
  });

  it('지난 날짜에서 다른 지난 날짜로 바로 옮기면 지난 날짜 화면의 선택이 초기화된다', () => {
    function Jump() {
      const [date, setDate] = useState('2026-11-10');
      return (
        <>
          <button type="button" onClick={() => setDate('2026-11-09')}>
            옆 날짜로
          </button>
          <WorkPage date={date} todayKey={TODAY} onOpenDate={() => undefined} />
        </>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Jump />
      </QueryClientProvider>,
    );
    const stage = () => document.querySelector('[data-work-stub="past-day"]');
    fireEvent.click(screen.getByRole('button', { name: '작업 고르기' }));
    expect(stage()?.getAttribute('data-picked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '옆 날짜로' }));
    expect(stage()?.getAttribute('data-date')).toBe('2026-11-09');
    expect(stage()?.getAttribute('data-picked')).toBe('false');
  });

  it('오늘·예정인 날짜는 날짜 화면(작업 흐름)이다', async () => {
    renderPage(TODAY);
    expect(await screen.findByRole('heading', { name: '2026년 11월 11일 (수)' })).toBeTruthy();
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    expect(opened).toEqual([TODAY]);
  });

  it('달력의 칸을 누르면 날짜를 열라고 알리고, 지난 날이면 지난 날짜 화면이 뜬다', async () => {
    // 작업한 지난 날만 눌린다.
    server.use(
      http.get('*/api/work-units', () =>
        HttpResponse.json({ works: [workDayOf({ date: '2026-11-09', progress: 'SUBMITTED' })] }),
      ),
    );
    renderPage();
    const past = screen.getByRole('button', { name: '11월 9일' });
    await waitFor(() => expect((past as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(past);
    expect(calls).toEqual(['2026-11-09']);
    expect(stageName()).toBe('past-day');
  });

  it('날짜 화면의 달력 단추는 달력으로 나가라고 알린다', async () => {
    renderPage('2026-11-12');
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(calls).toEqual([null]);
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeTruthy();
  });

  it('달력을 다른 달로 옮겨 날짜를 열었다가 돌아오면 마지막에 연 날짜의 달이다', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '12월 15일' }));
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeTruthy();
  });

  it('주소로 날짜가 바뀌어도(링크·뒤로 가기) 달력은 그 날짜의 달로 돌아온다', async () => {
    renderPage('2026-12-15');
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeTruthy();
  });

  it('작업 종료 단계에서 보고서를 보내면 달력으로 나가고 알림을 2.4초 보인다', async () => {
    renderPage(TODAY);
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole('button', { name: '완료' }));
      expect(calls).toEqual([null]);
      expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe('보고서를 보냈습니다');

      act(() => {
        vi.advanceTimersByTime(2_300);
      });
      expect(screen.getByRole('status').textContent).toBe('보고서를 보냈습니다');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('보고서를 보내지 않고 달력으로 나가면 알림이 없다', async () => {
    renderPage(TODAY);
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    fireEvent.click(screen.getByRole('button', { name: '달력' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('작업 관리 화면(달력·지난 날·오늘)에서만 바탕 모눈을 낮추는 가림막을 깐다', async () => {
    renderPage();
    expect(screen.getByTestId('work-grid-veil').className).toContain('bg-background/75');
    cleanup();

    renderPage('2026-11-10');
    expect(screen.getByTestId('work-grid-veil').className).toContain('bg-background/75');
    cleanup();

    renderPage(TODAY);
    await waitFor(() => expect(stageName()).toBe('run-stage'));
    expect(screen.getByTestId('work-grid-veil').className).toContain('bg-background/75');
  });
});

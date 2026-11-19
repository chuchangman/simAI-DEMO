import { workDayOf } from '@/__tests__/features/work/workFixture';
import { WorkRoutePage } from '@/features/work/WorkRoutePage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
// 작업 관리 화면은 받은 props 만 확인한다.
vi.mock('@/features/work/WorkPage', () => ({
  WorkPage: ({
    date,
    onOpenDate,
  }: {
    date?: string;
    onOpenDate: (date: string | null) => void;
  }) => (
    <div data-testid="work-page" data-date={date ?? ''}>
      <button type="button" onClick={() => onOpenDate('2026-11-12')}>
        날짜 열기
      </button>
      <button type="button" onClick={() => onOpenDate(null)}>
        달력으로
      </button>
    </div>
  ),
}));

// /work 라우트 ↔ 작업 관리 화면: ?date= 로 날짜를 열고 닫고, 옛 링크 ?workUnitId= 는 그 작업의 날짜로 바꿔 연다.

/** GET /api/work-units/:id 가 돌려줄 작업(id → 작업). */
let units: Record<string, ReturnType<typeof workDayOf>> = {};
/** 이 시험에서 작업 하나를 받으러 간 id. */
let fetched: string[] = [];
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  navigate.mockReset();
  fetched = [];
  units = {
    '9001': workDayOf({ work_id: '9001', date: '2026-11-11' }),
    '8001': workDayOf({ work_id: '8001', date: '2026-11-03', daily: false }),
  };
  server.resetHandlers(
    http.get('*/api/work-units/:id', ({ params }) => {
      const id = String(params.id);
      fetched.push(id);
      const unit = units[id];
      return unit
        ? HttpResponse.json(unit)
        : HttpResponse.json({ code: 'WORK_NOT_FOUND' }, { status: 404 });
    }),
  );
});
afterEach(cleanup);

function renderRoute(props: { date?: string; workUnitId?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkRoutePage {...props} />
    </QueryClientProvider>,
  );
}

describe('WorkRoutePage', () => {
  it('검색 값이 없으면 날짜 없는 작업 관리 화면(달력)을 연다', () => {
    renderRoute({});
    expect(screen.getByTestId('work-page').getAttribute('data-date')).toBe('');
    expect(fetched).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('?date= 가 있으면 그 날짜를 연다', () => {
    renderRoute({ date: '2026-11-12' });
    expect(screen.getByTestId('work-page').getAttribute('data-date')).toBe('2026-11-12');
  });

  it('날짜를 열라는 요청은 ?date= 로 이동하고, 달력으로 나가라는 요청은 검색 없이 /work 로 간다', () => {
    renderRoute({});
    fireEvent.click(screen.getByRole('button', { name: '날짜 열기' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/work', search: { date: '2026-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: '달력으로' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/work', search: {} });
  });

  it('옛 링크 ?workUnitId= 는 그 작업의 날짜를 알아 ?date= 로 바꿔(replace) 연다', async () => {
    renderRoute({ workUnitId: '9001' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/work',
        search: { date: '2026-11-11' },
        replace: true,
      }),
    );
    expect(fetched).toEqual(['9001']);
  });

  it('옛 링크의 작업이 지난 날 작업이어도 그 날짜로 연다', async () => {
    renderRoute({ workUnitId: '8001' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/work',
        search: { date: '2026-11-03' },
        replace: true,
      }),
    );
  });

  it('날짜를 알아내는 동안은 작업 관리 화면(달력)을 비추지 않는다', async () => {
    renderRoute({ workUnitId: '9001' });
    expect(screen.queryByTestId('work-page')).toBeNull();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByTestId('work-page')).toBeNull();
  });

  it('작업을 못 찾으면 검색 없이 달력으로 바꾼다', async () => {
    renderRoute({ workUnitId: '12345' });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/work', search: {}, replace: true }),
    );
  });

  it('날짜와 workUnitId 가 함께 오면 날짜를 따르고 작업을 받으러 가지 않는다', async () => {
    renderRoute({ date: '2026-11-12', workUnitId: '9001' });
    expect(screen.getByTestId('work-page').getAttribute('data-date')).toBe('2026-11-12');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
});

import { workReportOf } from '@/__tests__/features/work/workFixture';
import { useSigners } from '@/features/work/preflight/useSigners';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
// 초안을 기다리는 다시 받기 주기를 짧게 해 시험이 오래 걸리지 않게 한다.
vi.mock('@/features/work/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/work/api')>()),
  WORK_REPORT_POLL_MS: 30,
}));

// 작업 전 확인의 서명자. 서버가 세팅을 끝내기 전(setupDone false)에는 초안이 시작되지 않았으므로 보고서를 기다리며 다시 받지 않는다.

const WORK_ID = '9001';
let reportRequests: number;
const server = setupServer(
  // 초안이 아직 시작되지 않은 보고서(PENDING).
  http.get('*/api/reports/tbm', () => {
    reportRequests += 1;
    return HttpResponse.json({ latest: workReportOf({ work_id: WORK_ID }), versions: [] });
  }),
  http.get('*/api/reports/tbm/:id/signatures', () => HttpResponse.json({ items: [] })),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  reportRequests = 0;
});
afterEach(cleanup);

function setup(setupDone: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSigners(WORK_ID, setupDone), { wrapper });
}

describe('useSigners', () => {
  it('서버가 세팅을 끝내기 전에는 보고서를 한 번만 받고 초안을 기다리며 다시 받지 않는다', async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reportRequests).toBe(1);
  });

  it('세팅이 끝났는데 초안이 아직 PENDING 이면 초안이 시작되길 기다리며 다시 받는다', async () => {
    const { result } = setup(true);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(reportRequests).toBeGreaterThanOrEqual(3));
  });
});

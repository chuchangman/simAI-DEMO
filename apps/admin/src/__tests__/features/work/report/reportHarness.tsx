import {
  endWork,
  fetchReportsByWork,
  putDailyWorkUnit,
  signReport,
  startWork,
  submitReport,
} from '@/features/work/api';
import type { WorkReport } from '@/features/work/types';
import { api } from '@/lib/api';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock, type WorkMock } from '@/mocks/work';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { setupServer, type SetupServer } from 'msw/node';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

// 보고서 화면 시험이 함께 쓰는 준비물: 작업 관리 mock 서버, 시계, 하루를 한 바퀴 돌리는 도우미.
// '@/lib/api' 는 시험 파일이 vi.mock 으로 시험 주소의 http 로 바꿔 둔다.

export const TODAY = '2026-11-11';
export const TOMORROW = '2026-11-12';
export const T0 = new Date(2026, 10, 11, 9, 0).getTime();
export const DRAFT_DELAY_MS = 2_500;

/** 시험 안에서 바꿀 수 있는 시계와 mock. 시험마다 새로 만든다. */
export interface ReportServer {
  mock: WorkMock;
  clock: number;
  /** 시험 안에서 핸들러를 덧붙일 때 쓴다(`server.use(...)`). 시험이 끝나면 사라진다. */
  server: SetupServer;
}

/** 작업 관리 mock 서버를 시험 파일에 붙인다(파일 맨 위에서 한 번 부른다). */
export function installReportServer(): ReportServer {
  const server = setupServer();
  const state: ReportServer = { clock: T0, mock: createWorkMock(), server };
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());
  beforeEach(() => {
    state.clock = T0;
    state.mock = createWorkMock({ now: () => state.clock, draftDelayMs: DRAFT_DELAY_MS });
    server.resetHandlers(...state.mock.handlers, ...createTbmMock().handlers);
  });
  afterEach(cleanup);
  return state;
}

/** 시험마다 새 캐시를 가진 QueryClientProvider 로 감싸 그린다. */
export function renderWithClient(ui: ReactElement): RenderResult & { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** 날짜를 열어 그 날의 작업과 빈 보고서를 만든다. */
export const openDay = (date = TODAY) => putDailyWorkUnit(api, date);

/** 작업의 최신 보고서. */
export async function latestReport(workId: string): Promise<WorkReport> {
  const { latest } = await fetchReportsByWork(api, workId);
  if (!latest) throw new Error('보고서가 없다');
  return latest;
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

/** 서명 한 명을 더한다(최신 판에). */
export async function signAs(workId: string, signerName = '박반장') {
  const report = await latestReport(workId);
  await signReport(api, report.report_id, {
    image: png(),
    signerName,
    reportVersion: report.report_version,
  });
}

/** 세팅 끝 → 서명 → 시작 → 종료 요청까지 보낸다. 서버는 아직 종료 미팅을 채우는 중이다(종료해도 같은 보고서). */
export async function requestEnd(server: ReportServer, workId: string): Promise<void> {
  server.mock.markSetupDone(workId);
  await signAs(workId);
  await startWork(api, workId);
  server.clock += 60_000;
  await endWork(api, workId);
}

/** 종료까지 보내고 서버가 종료 미팅을 다 채운 보고서를 돌려준다. */
export async function endDay(server: ReportServer, workId: string): Promise<WorkReport> {
  await requestEnd(server, workId);
  server.clock += DRAFT_DELAY_MS;
  return latestReport(workId);
}

/** 종료한 하루를 제출해 잠근다. 제출한 보고서를 돌려준다. */
export async function submitDay(server: ReportServer, workId: string): Promise<WorkReport> {
  const ended = await endDay(server, workId);
  await submitReport(api, ended.report_id);
  return latestReport(workId);
}

import { WORK_ERROR, workErrorOf } from '@/features/work/api';
import { blankReportForm } from '@/features/work/reportForm';
import type { WorkReport } from '@/features/work/types';
import { useAddSignature, useDeleteSignature, useSignatures } from '@/features/work/useSignatures';
import { useOpenDay, useWorkDays, useWorkTasks } from '@/features/work/useWorkDays';
import { useSaveReportForm, useWorkReport } from '@/features/work/useWorkReport';
import { useEndWork, useStartWork, useSubmitReport } from '@/features/work/useWorkRun';
import { createTbmMock } from '@/mocks/tbm';
import { createWorkMock, type WorkMock } from '@/mocks/work';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 작업 관리 훅을 mock(src/mocks/work.ts)에 붙여 본다. 시계는 시험이 정한다.

const TODAY = '2026-11-11';
const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const DRAFT_DELAY_MS = 2_500;

let clock = T0;
let mock: WorkMock;
const server = setupServer();
/** 이 시험에서 서버로 간 요청('PUT /api/work-units/daily/…' 꼴). */
let requests: string[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  clock = T0;
  requests = [];
  mock = createWorkMock({ now: () => clock, draftDelayMs: DRAFT_DELAY_MS });
  server.resetHandlers(...mock.handlers, ...createTbmMock().handlers);
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

/** 날짜 화면을 열고 그 작업의 보고서를 받아 둔 훅 묶음. */
function useDay() {
  const day = useOpenDay(TODAY, TODAY);
  const workId = day.data?.work_id;
  const report = useWorkReport(workId);
  return { day, report };
}

describe('useOpenDay', () => {
  it('지난 날은 요청을 보내지 않는다', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useOpenDay('2026-11-10', TODAY), { wrapper });
    expect(result.current).toMatchObject({
      kind: 'past',
      data: undefined,
      reportId: null,
      pending: false,
      error: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.filter((r) => r.startsWith('PUT'))).toEqual([]);
  });

  it('오늘·예정인 날은 하루 작업을 만들고 보고서 id 를 돌려준다', async () => {
    const { wrapper } = setup();
    const today = renderHook(() => useOpenDay(TODAY, TODAY), { wrapper });
    expect(today.result.current).toMatchObject({ kind: 'today', pending: true });
    await waitFor(() => expect(today.result.current.data).toBeDefined());
    expect(today.result.current).toMatchObject({
      kind: 'today',
      pending: false,
      data: { date: TODAY, daily: true, progress: 'REPORT' },
    });
    expect(today.result.current.reportId).toBe(today.result.current.data?.tbm_report?.report_id);

    const future = renderHook(() => useOpenDay('2026-11-12', TODAY), { wrapper });
    await waitFor(() => expect(future.result.current.data).toBeDefined());
    expect(future.result.current.kind).toBe('future');
    expect(future.result.current.data?.work_id).not.toBe(today.result.current.data?.work_id);
  });

  it('오늘 이전 날짜가 서버에서 거절되면 error 로 올라온다(지난 날을 잘못 열었을 때)', async () => {
    const { wrapper } = setup();
    // 시계가 하루 지난 것처럼: 훅은 '2026-11-10' 을 오늘로 알지만 서버는 11-11 이다.
    const { result } = renderHook(() => useOpenDay('2026-11-10', '2026-11-10'), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(workErrorOf(result.current.error)).toBe(WORK_ERROR.DATE_PAST);
  });
});

describe('useWorkDays·useWorkTasks', () => {
  it('월 목록에 하루 작업이 들어온다', async () => {
    const { wrapper } = setup();
    const open = renderHook(() => useOpenDay(TODAY, TODAY), { wrapper });
    await waitFor(() => expect(open.result.current.data).toBeDefined());
    const { result } = renderHook(() => useWorkDays({ from: '2026-11-01', to: '2026-11-30' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.some((w) => w.daily && w.date === TODAY)).toBe(true);
    expect(result.current.data?.some((w) => !w.daily)).toBe(true);
  });

  it('꺼 두면 요청하지 않는다', () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useWorkDays({ from: '2026-11-01', to: '2026-11-30' }, false),
      { wrapper },
    );
    expect(result.current).toMatchObject({ data: undefined, pending: false });
    expect(requests).toEqual([]);
  });

  it('작업내용 항목 7개', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkTasks(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(7));
  });
});

describe('useWorkReport', () => {
  it('최신 보고서를 준다(작업이 없으면 받지 않는다)', async () => {
    const { wrapper } = setup();
    const none = renderHook(() => useWorkReport(null), { wrapper });
    expect(none.result.current).toMatchObject({ data: undefined, pending: false });

    const { result } = renderHook(() => useDay(), { wrapper });
    await waitFor(() => expect(result.current.report.data).toBeDefined());
    expect(result.current.report.data).toMatchObject({ status: 'PENDING', report_version: 1 });
  });

  it('세팅이 끝났는데 초안이 만들어지는 동안은 2초마다 다시 받아 SUCCEEDED 까지 간다', async () => {
    const { wrapper } = setup();
    const open = renderHook(() => useOpenDay(TODAY, TODAY), { wrapper });
    await waitFor(() => expect(open.result.current.data).toBeDefined());
    const workId = open.result.current.data?.work_id ?? '';
    mock.markSetupDone(workId);

    const { result } = renderHook(() => useWorkReport(workId, { setupDone: true }), { wrapper });
    await waitFor(() => expect(result.current.data?.draft_status).toBe('GENERATING'));
    clock += DRAFT_DELAY_MS;
    await waitFor(() => expect(result.current.data?.draft_status).toBe('SUCCEEDED'), {
      timeout: 5_000,
    });
    expect(result.current.data?.form?.info.risk_assessed).toBe(true);
  });
});

describe('useWorkReport — 종료 미팅', () => {
  it('종료한 뒤 서버가 종료 미팅을 채우는 동안은 2초마다 다시 받아 SUCCEEDED 까지 간다(같은 보고서)', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRunHooks(), { wrapper });
    const { workId, first } = await startDay(result);
    await act(async () => {
      await result.current.end.mutateAsync(workId);
    });

    await waitFor(() => expect(result.current.report.data?.wrap_up_status).toBe('GENERATING'));
    expect(result.current.report.data?.form?.review.ending).toBe('');
    clock += DRAFT_DELAY_MS;
    await waitFor(() => expect(result.current.report.data?.wrap_up_status).toBe('SUCCEEDED'), {
      timeout: 5_000,
    });
    expect(result.current.report.data).toMatchObject({
      report_id: first.report_id,
      report_version: 1,
    });
    expect(result.current.report.data?.form?.review.ending).toBe(
      '작업 종료 · 총 작업 시간 00:01:00, 사건 0건',
    );
  });
});

describe('useSaveReportForm', () => {
  it('저장하면 캐시의 최신 보고서가 바뀌고 같은 revision 으로 또 저장하면 충돌한다', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ ...useDay(), save: useSaveReportForm() }), { wrapper });
    await waitFor(() => expect(result.current.report.data).toBeDefined());
    const report = result.current.report.data as WorkReport;
    const form = {
      ...blankReportForm(T0),
      info: { ...blankReportForm(T0).info, tasks: [{ code: 'REBAR' }] },
    };

    await act(async () => {
      await result.current.save.mutateAsync({
        reportId: report.report_id,
        form,
        form_revision: report.form_revision,
      });
    });
    await waitFor(() => expect(result.current.report.data?.form_revision).toBe(1));
    expect(result.current.report.data?.form?.info.task_name).toBe('철근 배근');
    // 작업명이 바뀌었으니 하루 작업도 다시 받는다.
    await waitFor(() => expect(result.current.day.data?.name).toBe('철근 배근'));

    await act(async () => {
      await expect(
        result.current.save.mutateAsync({
          reportId: report.report_id,
          form,
          form_revision: report.form_revision,
        }),
      ).rejects.toSatisfy(
        (error: unknown) => workErrorOf(error) === WORK_ERROR.REPORT_FORM_CONFLICT,
      );
    });
  });
});

/** 날짜 화면의 훅에 서명·시작·종료·제출 훅을 더한 묶음. */
function useRunHooks() {
  return {
    ...useDay(),
    add: useAddSignature(),
    start: useStartWork(),
    end: useEndWork(),
    submit: useSubmitReport(),
  };
}

/** 하루를 열어 세팅을 끝내고 서명 한 명을 받은 뒤 1분 지난 시각에 작업을 시작해 두고 작업 id 와 처음 보고서를 돌려준다. */
async function startDay(result: { current: ReturnType<typeof useRunHooks> }) {
  await waitFor(() => expect(result.current.report.data).toBeDefined());
  const workId = result.current.day.data?.work_id ?? '';
  const first = result.current.report.data as WorkReport;
  mock.markSetupDone(workId);
  await act(async () => {
    await result.current.add.mutateAsync({
      reportId: first.report_id,
      reportVersion: 1,
      signerName: '박반장',
      image: png(),
    });
    await result.current.start.mutateAsync(workId);
  });
  clock += 60_000;
  return { workId, first };
}

describe('서명·시작·종료·제출 훅', () => {
  it('서명 추가·삭제가 목록과 보고서의 서명 수에 반영된다', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => {
        const base = useDay();
        const reportId = base.report.data?.report_id;
        return {
          ...base,
          signatures: useSignatures(reportId),
          add: useAddSignature(),
          remove: useDeleteSignature(),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.signatures.data).toEqual([]));
    const report = result.current.report.data as WorkReport;

    await act(async () => {
      await result.current.add.mutateAsync({
        reportId: report.report_id,
        reportVersion: report.report_version,
        signerName: '박반장',
        image: png(),
      });
    });
    await waitFor(() => expect(result.current.signatures.data).toHaveLength(1));
    await waitFor(() => expect(result.current.report.data?.signature_count).toBe(1));

    const [signature] = result.current.signatures.data ?? [];
    await act(async () => {
      await result.current.remove.mutateAsync({
        reportId: report.report_id,
        signatureId: signature?.signature_id ?? '',
      });
    });
    await waitFor(() => expect(result.current.signatures.data).toEqual([]));
  });

  it('시작·종료·제출하면 하루 작업과 보고서가 다시 받아져 진행이 앞으로 간다(종료해도 같은 보고서)', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRunHooks(), { wrapper });
    const { workId, first } = await startDay(result);
    await waitFor(() => expect(result.current.day.data?.progress).toBe('IN_PROGRESS'));

    await act(async () => {
      await result.current.end.mutateAsync(workId);
    });
    await waitFor(() => expect(result.current.day.data?.progress).toBe('ENDED'));
    await waitFor(() => expect(result.current.report.data?.wrap_up_status).toBe('GENERATING'));
    expect(result.current.report.data).toMatchObject({
      report_id: first.report_id,
      report_version: 1,
    });

    // 서버가 종료 미팅을 다 채운 뒤에야 제출을 받는다.
    clock += DRAFT_DELAY_MS;
    await act(async () => {
      await result.current.submit.mutateAsync(first.report_id);
    });
    await waitFor(() => expect(result.current.day.data?.progress).toBe('SUBMITTED'));
    expect(result.current.report.data?.submitted_at).toBe(clock);
  });

  it('종료하면 보고서(종료 미팅 채우는 중)가 먼저 갱신돼, 하루 작업이 ENDED 로 보일 때는 이미 채우는 중이다', async () => {
    const { wrapper } = setup();
    const wrapUpWhenEnded: (string | null | undefined)[] = [];
    const { result } = renderHook(
      () => {
        const state = useRunHooks();
        if (state.day.data?.progress === 'ENDED') {
          wrapUpWhenEnded.push(state.report.data?.wrap_up_status);
        }
        return state;
      },
      { wrapper },
    );
    const { workId } = await startDay(result);

    await act(async () => {
      await result.current.end.mutateAsync(workId);
    });
    await waitFor(() => expect(result.current.day.data?.progress).toBe('ENDED'));
    expect(wrapUpWhenEnded.length).toBeGreaterThan(0);
    expect(wrapUpWhenEnded.every((status) => status === 'GENERATING')).toBe(true);
  });

  it('오늘이 아닌 작업을 시작하면 WORK_NOT_TODAY 로 실패하고 error 에 담긴다', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ day: useOpenDay('2026-11-12', TODAY), start: useStartWork() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.day.data).toBeDefined());
    await act(async () => {
      await result.current.start
        .mutateAsync(result.current.day.data?.work_id ?? '')
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.start.error).not.toBeNull());
    expect(workErrorOf(result.current.start.error)).toBe(WORK_ERROR.NOT_TODAY);
  });
});

describe('제출 훅 — 거절된 뒤 다시 받기', () => {
  const reportGets = () => requests.filter((r) => r === 'GET /api/reports/tbm').length;

  it.each([
    { status: 409, code: WORK_ERROR.REPORT_NOT_READY, refetch: true },
    { status: 409, code: WORK_ERROR.REPORT_LOCKED, refetch: true },
    { status: 409, code: WORK_ERROR.INVALID_STATE, refetch: true },
    { status: 403, code: 'FORBIDDEN', refetch: false },
  ])(
    '제출이 $code 로 거절되면 보고서를 다시 받는다($refetch)',
    async ({ status, code, refetch }) => {
      const { wrapper } = setup();
      const { result } = renderHook(() => ({ ...useDay(), submit: useSubmitReport() }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.report.data).toBeDefined());
      const report = result.current.report.data as WorkReport;
      server.use(
        http.post('*/api/reports/tbm/:id/submit', () =>
          HttpResponse.json({ code, message: '안 됨' }, { status }),
        ),
      );
      const reports = reportGets();
      await act(async () => {
        await result.current.submit.mutateAsync(report.report_id).catch(() => undefined);
      });
      await waitFor(() => expect(result.current.submit.error).not.toBeNull());
      if (refetch) {
        await waitFor(() => expect(reportGets()).toBeGreaterThan(reports));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(reportGets()).toBe(reports);
      }
    },
  );
});

describe('서명 훅 — 거절된 뒤 다시 받기', () => {
  const signatureGets = () =>
    requests.filter((r) => /^GET \/api\/reports\/tbm\/\d+\/signatures$/.test(r)).length;
  const reportGets = () => requests.filter((r) => r === 'GET /api/reports/tbm').length;

  /** 하루를 열어 서명 목록과 보고서를 받아 둔 훅 묶음과 처음 보고서. */
  async function mountSigners() {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => {
        const base = useDay();
        return {
          ...base,
          signatures: useSignatures(base.report.data?.report_id),
          add: useAddSignature(),
          remove: useDeleteSignature(),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.signatures.data).toEqual([]));
    return { result, report: result.current.report.data as WorkReport };
  }

  const reject = (status: number, code: string) =>
    HttpResponse.json({ code, message: '안 됨' }, { status });

  it.each([
    { status: 409, code: WORK_ERROR.REPORT_LOCKED, refetch: true },
    { status: 404, code: WORK_ERROR.SIGNATURE_NOT_FOUND, refetch: true },
    { status: 409, code: WORK_ERROR.INVALID_STATE, refetch: false },
  ])(
    '서명 삭제가 $code 로 거절되면 서명 목록과 보고서를 다시 받는다($refetch)',
    async ({ status, code, refetch }) => {
      const { result, report } = await mountSigners();
      server.use(
        http.delete('*/api/reports/tbm/:id/signatures/:signatureId', () => reject(status, code)),
      );
      const [signatures, reports] = [signatureGets(), reportGets()];
      await act(async () => {
        await result.current.remove
          .mutateAsync({ reportId: report.report_id, signatureId: '1' })
          .catch(() => undefined);
      });
      await waitFor(() => expect(workErrorOf(result.current.remove.error)).toBe(code));
      if (refetch) {
        await waitFor(() => expect(signatureGets()).toBeGreaterThan(signatures));
        await waitFor(() => expect(reportGets()).toBeGreaterThan(reports));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(signatureGets()).toBe(signatures);
        expect(reportGets()).toBe(reports);
      }
    },
  );

  it.each([
    { code: WORK_ERROR.REPORT_LOCKED, refetch: true },
    { code: WORK_ERROR.REPORT_VERSION_STALE, refetch: true },
    { code: WORK_ERROR.SIGNATURE_LIMIT_REACHED, refetch: false },
  ])('서명 추가가 $code 로 거절되면 보고서를 다시 받는다($refetch)', async ({ code, refetch }) => {
    const { result, report } = await mountSigners();
    server.use(http.post('*/api/reports/tbm/:id/signatures', () => reject(409, code)));
    const reports = reportGets();
    await act(async () => {
      await result.current.add
        .mutateAsync({
          reportId: report.report_id,
          reportVersion: report.report_version,
          signerName: '박반장',
          image: png(),
        })
        .catch(() => undefined);
    });
    await waitFor(() => expect(workErrorOf(result.current.add.error)).toBe(code));
    if (refetch) {
      await waitFor(() => expect(reportGets()).toBeGreaterThan(reports));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reportGets()).toBe(reports);
    }
  });
});

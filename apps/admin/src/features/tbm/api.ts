import {
  layoutDetailSchema,
  layoutsListSchema,
  signatureSchema,
  tbmReportByWorkResponseSchema,
  tbmReportGenerateResponseSchema,
  tbmReportSchema,
  tbmWorkUnitSchema,
  tbmWorkUnitsResponseSchema,
  workTypesResponseSchema,
  type LayoutDetail,
  type LayoutObbItem,
  type LayoutSummary,
  type TbmReport,
  type TbmReportByWorkResponse,
  type TbmReportGenerateResponse,
  type TbmWorkUnit,
  type WorkTypeOption,
  type WorkUnitWriteBody,
} from '@/features/tbm/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// TBM 작업·공종·가상 레이아웃·보고서 REST 요청. http 를 인자로 받는다(테스트가 env 없이 createHttp 로 부를 수 있게 한다).

export const TBM_REPORT_POLL_INTERVAL_MS = 2000;

export const TBM_WORKS_KEY = ['tbm', 'works'] as const;
export const TBM_WORK_TYPES_KEY = ['tbm', 'work-types'] as const;
export const TBM_LAYOUTS_KEY = ['tbm', 'layouts'] as const;
export const tbmLayoutKey = (layoutId: number) => ['tbm', 'layout', layoutId] as const;
export const tbmLayoutDetailKey = tbmLayoutKey;
export const tbmReportsByWorkKey = (workId: string) => ['tbm', 'reports', workId] as const;
export const tbmReportKey = (reportId: number) => ['tbm', 'report', reportId] as const;
export const tbmReportDetailKey = tbmReportKey;
export const signatureKey = (report: TbmReport) =>
  ['tbm', 'signatures', report.report_id, report.report_version] as const;

export function requestReportSignatures(http: Http, report: TbmReport, signal?: AbortSignal) {
  return http(`/api/reports/tbm/${report.report_id}/signatures?version=${report.report_version}`, {
    schema: z.object({ items: z.array(signatureSchema) }),
    signal,
  });
}

/** 받은 작업 배열에서 형식이 맞는 것만 고른다. */
export function readTbmWorks(items: readonly unknown[]): TbmWorkUnit[] {
  return items.flatMap((item) => {
    const parsed = tbmWorkUnitSchema.safeParse(item);
    return parsed.success && parsed.data.to_ms > parsed.data.from_ms ? [parsed.data] : [];
  });
}

// ── C. 작업 (/api/work-units) ────────────────────────────────────────────────

export async function requestTbmWorks(http: Http, signal?: AbortSignal): Promise<TbmWorkUnit[]> {
  const response = await http('/api/work-units', {
    schema: tbmWorkUnitsResponseSchema,
    signal,
  });
  return readTbmWorks(response.works);
}

export function createTbmWork(http: Http, body: WorkUnitWriteBody): Promise<TbmWorkUnit> {
  return http('/api/work-units', {
    method: 'POST',
    body,
    schema: tbmWorkUnitSchema,
  });
}
export const requestCreateWorkUnit = createTbmWork;

export function updateTbmWork(
  http: Http,
  workId: string,
  body: WorkUnitWriteBody,
): Promise<TbmWorkUnit> {
  return http(`/api/work-units/${encodeURIComponent(workId)}`, {
    method: 'PUT',
    body,
    schema: tbmWorkUnitSchema,
  });
}
export const requestUpdateWorkUnit = updateTbmWork;

export async function deleteTbmWork(http: Http, workId: string): Promise<void> {
  await http(`/api/work-units/${encodeURIComponent(workId)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}
export const requestDeleteWorkUnit = deleteTbmWork;

// ── C. 공종 (/api/work-types) ────────────────────────────────────────────────

export function requestWorkTypes(http: Http, signal?: AbortSignal): Promise<WorkTypeOption[]> {
  return http('/api/work-types', {
    schema: workTypesResponseSchema,
    signal,
  });
}

// ── 가상 레이아웃 (/api/layouts) ─────────────────────────────────────────────

export interface LayoutWriteBody {
  name: string;
  items: readonly LayoutObbItem[];
  revision?: number;
}

export function requestLayouts(http: Http, signal?: AbortSignal): Promise<LayoutSummary[]> {
  return http('/api/layouts', {
    schema: layoutsListSchema,
    signal,
  });
}

export function requestLayout(
  http: Http,
  layoutId: number,
  signal?: AbortSignal,
): Promise<LayoutDetail> {
  return http(`/api/layouts/${encodeURIComponent(String(layoutId))}`, {
    schema: layoutDetailSchema,
    signal,
  });
}
export const requestLayoutDetail = requestLayout;

export function createLayout(http: Http, body: LayoutWriteBody): Promise<LayoutDetail> {
  return http('/api/layouts', {
    method: 'POST',
    body,
    schema: layoutDetailSchema,
  });
}

export function updateLayout(
  http: Http,
  layoutId: number,
  body: LayoutWriteBody,
): Promise<LayoutDetail> {
  return http(`/api/layouts/${encodeURIComponent(String(layoutId))}`, {
    method: 'PUT',
    body,
    schema: layoutDetailSchema,
  });
}

// ── B. TBM 보고서 (/api/reports/tbm) ─────────────────────────────────────────

export function requestTbmReportsByWork(
  http: Http,
  workId: string,
  signal?: AbortSignal,
): Promise<TbmReportByWorkResponse> {
  const query = new URLSearchParams({ work_id: workId });
  return http(`/api/reports/tbm?${query}`, {
    schema: tbmReportByWorkResponseSchema,
    signal,
  });
}

export function requestTbmReport(
  http: Http,
  reportId: number,
  signal?: AbortSignal,
): Promise<TbmReport> {
  return http(`/api/reports/tbm/${encodeURIComponent(String(reportId))}`, {
    schema: tbmReportSchema,
    signal,
  });
}
export const requestTbmReportById = requestTbmReport;

export function generateTbmReport(http: Http, workId: string): Promise<TbmReportGenerateResponse> {
  const numeric = Number(workId);
  const payloadWorkId = Number.isInteger(numeric) && numeric > 0 ? numeric : workId;
  return http('/api/reports/tbm', {
    method: 'POST',
    body: { work_id: payloadWorkId },
    schema: tbmReportGenerateResponseSchema,
  });
}
export const requestGenerateTbmReport = generateTbmReport;

export function startTbmWork(http: Http, id: string) {
  return http(`/api/work-units/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    schema: tbmWorkUnitSchema,
  });
}

export function endTbmWork(http: Http, id: string) {
  return http(`/api/work-units/${encodeURIComponent(id)}/end`, {
    method: 'POST',
    schema: z.object({
      work_unit: tbmWorkUnitSchema,
      wrap_up: z.object({
        status: z.enum(['GENERATING', 'SKIPPED']),
        report_id: z.number().nullable(),
        reason: z.string().nullable(),
      }),
    }),
  });
}

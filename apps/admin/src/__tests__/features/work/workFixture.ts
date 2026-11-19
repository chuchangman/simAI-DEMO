import { blankReportForm } from '@/features/work/reportForm';
import type { WorkDayItem, WorkReport, WorkSignature } from '@/features/work/types';

// 작업 관리 새 흐름 시험이 함께 쓰는 샘플. 칸을 일부만 덮어써서 시험마다 필요한 모양을 만든다.

/** 시험 기준 날짜(2026-11-11 수요일). */
export const SAMPLE_DATE = '2026-11-11';

/** 하루 작업 항목 샘플(오늘, 보고서 단계). */
export function workDayOf(overrides: Partial<WorkDayItem> = {}): WorkDayItem {
  return {
    work_id: '9001',
    date: SAMPLE_DATE,
    name: '',
    daily: true,
    progress: 'REPORT',
    tbm_report: { report_id: 9001, draft_status: null, submitted_at: null },
    status: 'PLANNED',
    from_ms: new Date(2026, 10, 11, 7, 30).getTime(),
    to_ms: new Date(2026, 10, 11, 17, 0).getTime(),
    active_setup_session_id: null,
    actual_started_at: null,
    actual_ended_at: null,
    event_counts: null,
    incident_counts: null,
    zone_id: null,
    place: null,
    lead: null,
    layout_id: null,
    work_type: null,
    planned_people: 0,
    ...overrides,
  };
}

/** 보고서 샘플(빈 보고서 PENDING). */
export function workReportOf(overrides: Partial<WorkReport> = {}): WorkReport {
  return {
    report_id: 9001,
    work_id: '9001',
    report_version: 1,
    status: 'PENDING',
    draft_status: null,
    failure_reason: null,
    form: blankReportForm(new Date(2026, 10, 11, 9, 0).getTime()),
    form_revision: 0,
    leader: { user_id: 1, name: '김안전', org: '(주)안전건설', title: '안전관리자' },
    header: null,
    locked_at: null,
    submitted_at: null,
    submitted_by_name: null,
    signature_count: 0,
    content_sha256: null,
    wrap_up_summary: null,
    wrap_up_status: null,
    created_at_ms: 0,
    completed_at_ms: null,
    ...overrides,
  };
}

/** 서명 목록 한 줄 샘플. */
export function workSignatureOf(overrides: Partial<WorkSignature> = {}): WorkSignature {
  return {
    signature_id: '1',
    signer_name: '박반장',
    signer_role: 'PARTICIPANT',
    signed_at: 0,
    report_version: 1,
    image_url: 'data:image/png;base64,',
    ...overrides,
  };
}

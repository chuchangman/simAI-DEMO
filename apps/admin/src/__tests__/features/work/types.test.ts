import { workDayOf } from '@/__tests__/features/work/workFixture';
import {
  blankReportForm,
  formatDuration,
  taskLabelOf,
  taskNameOf,
} from '@/features/work/reportForm';
import {
  readWorkDays,
  REPORT_CHECKS,
  reportFormSchema,
  reportsByWorkSchema,
  WORK_TASKS,
  workDayItemSchema,
  workDaysResponseSchema,
  workReportSchema,
} from '@/features/work/types';
import { describe, expect, it } from 'vitest';

const FULL_ITEM = {
  work_id: 9001,
  date: '2026-11-11',
  name: '철근 배근',
  daily: true,
  progress: 'SETUP_DONE',
  tbm_report: { report_id: 9001, draft_status: 'SUCCEEDED', submitted_at: null },
  status: 'PLANNED',
  from_ms: 1,
  to_ms: 2,
  active_setup_session_id: null,
  actual_started_at: null,
  actual_ended_at: null,
  event_counts: { CRITICAL: 1 },
};

describe('작업 항목 읽기', () => {
  it('숫자 id 를 문자열로 바꾸고 칸을 그대로 읽는다', () => {
    const item = workDayItemSchema.parse(FULL_ITEM);
    expect(item.work_id).toBe('9001');
    expect(item.progress).toBe('SETUP_DONE');
    expect(item.tbm_report).toEqual({
      report_id: 9001,
      draft_status: 'SUCCEEDED',
      submitted_at: null,
    });
    expect(item.event_counts).toEqual({ CRITICAL: 1 });
  });

  it('서버가 안 주는 칸은 비어 있는 값으로 읽고 모르는 칸은 버린다', () => {
    const item = workDayItemSchema.parse({
      work_id: '7',
      date: '2026-11-10',
      from_ms: 1,
      to_ms: 2,
      extra_field: 'x',
    });
    expect(item).toMatchObject({
      name: '',
      daily: false,
      progress: null,
      tbm_report: null,
      status: null,
      event_counts: null,
      planned_people: 0,
      place: null,
    });
    expect('extra_field' in item).toBe(false);
  });

  it('모르는 진행 값은 null 로 읽고 항목을 버리지 않는다', () => {
    expect(workDayItemSchema.parse({ ...FULL_ITEM, progress: 'NEW_STATE' }).progress).toBeNull();
  });

  it('초안 상태 PENDING 은 null 이다', () => {
    const item = workDayItemSchema.parse({
      ...FULL_ITEM,
      tbm_report: { report_id: 1, draft_status: 'PENDING' },
    });
    expect(item.tbm_report?.draft_status).toBeNull();
  });

  it('목록은 형식이 틀린 작업만 빼고 나머지를 준다', () => {
    const items = readWorkDays([
      FULL_ITEM,
      { work_id: '8' },
      null,
      'x',
      { ...FULL_ITEM, work_id: '9002' },
    ]);
    expect(items.map((i) => i.work_id)).toEqual(['9001', '9002']);
    const response = workDaysResponseSchema.parse({ works: [FULL_ITEM, { date: 'bad' }] });
    expect(response.works).toHaveLength(1);
  });
});

describe('보고서 읽기', () => {
  it('빈 보고서: draft_status null·form_revision 0·leader', () => {
    const report = workReportSchema.parse({
      report_id: 1,
      work_id: 5,
      report_version: 1,
      status: 'PENDING',
      draft_status: null,
      form: blankReportForm(100),
      form_revision: 0,
      leader: { user_id: 1, name: '김안전', org: null, title: '안전관리자' },
      brand_new_field: 1,
    });
    expect(report.work_id).toBe('5');
    expect(report.status).toBe('PENDING');
    expect(report.leader).toEqual({ user_id: 1, name: '김안전', org: null, title: '안전관리자' });
    expect(report.locked_at).toBeNull();
    expect(report.submitted_at).toBeNull();
    expect(report.submitted_by_name).toBeNull();
    expect(report.signature_count).toBe(0);
  });

  it('예전 방식 보고서(form 없음)와 제출 칸을 읽는다', () => {
    const report = workReportSchema.parse({
      report_id: 2,
      work_id: '6',
      report_version: 2,
      status: 'SUCCEEDED',
      locked_at: 10,
      submitted_at: 10,
      submitted_by_name: '김안전',
      signature_count: 4,
    });
    expect(report.form).toBeNull();
    expect(report.form_revision).toBe(0);
    expect(report.submitted_by_name).toBe('김안전');
    expect(report.signature_count).toBe(4);
  });

  it('보고서가 없으면 latest 는 null 이고 판 목록은 비어 있다', () => {
    expect(reportsByWorkSchema.parse({ latest: null })).toEqual({ latest: null, versions: [] });
  });

  it('양식은 null 칸을 빈 글자·null 로 읽는다', () => {
    const form = reportFormSchema.parse({
      info: {
        date_time_ms: null,
        same_day: null,
        task_name: null,
        tasks: null,
        place: null,
        risk_assessed: null,
      },
      risks: [{ risk: null, measure: 'x' }],
      focus: { risk: null, measure: null },
      checks: [{ code: 'PPE', label: null, yes: null, action: null }],
      review: { daily: null, ending: null },
    });
    expect(form.info).toEqual({
      date_time_ms: null,
      same_day: null,
      task_name: '',
      tasks: [],
      place: '',
      risk_assessed: null,
    });
    expect(form.risks).toEqual([{ risk: '', measure: 'x' }]);
    expect(form.checks[0]).toEqual({ code: 'PPE', label: '', yes: null, action: '' });
  });
});

describe('빈 양식', () => {
  it('일시와 작업일 동일(예)만 채우고 위험 3줄·점검 5줄이 서버 코드 순서다', () => {
    const form = blankReportForm(1_762_750_000_000);
    expect(form.info).toEqual({
      date_time_ms: 1_762_750_000_000,
      same_day: true,
      task_name: '',
      tasks: [],
      place: '',
      risk_assessed: null,
    });
    expect(form.risks).toHaveLength(3);
    expect(form.checks.map((c) => c.code)).toEqual([
      'PPE',
      'ZONE_CONTROL',
      'OPENING_GUARD',
      'WORK_SURFACE_FALL',
      'HEALTH',
    ]);
    expect(form.checks.map((c) => c.label)).toEqual(REPORT_CHECKS.map((c) => c.label));
    expect(form.checks.every((c) => c.yes === null && c.action === '')).toBe(true);
    expect(form.review).toEqual({ daily: '', ending: '' });
  });

  it('서버가 읽는 모양과 같다(읽어도 그대로)', () => {
    const form = blankReportForm(null);
    expect(reportFormSchema.parse(JSON.parse(JSON.stringify(form)))).toEqual(form);
  });
});

describe('작업명·종료 문장', () => {
  it('작업명은 첫 항목 문구에 둘 이상이면 외 N건을 붙인다', () => {
    expect(taskNameOf([], WORK_TASKS)).toBe('');
    expect(taskNameOf([{ code: 'REBAR' }], WORK_TASKS)).toBe('철근 배근');
    expect(taskNameOf([{ code: 'REBAR' }, { text: '직접 쓴 작업' }], WORK_TASKS)).toBe(
      '철근 배근 외 1건',
    );
    expect(
      taskNameOf([{ text: '직접' }, { code: 'REBAR' }, { code: 'FORMWORK' }], WORK_TASKS),
    ).toBe('직접 외 2건');
  });

  it('모르는 코드는 코드 그대로 보인다', () => {
    expect(taskLabelOf({ code: 'UNKNOWN' }, WORK_TASKS)).toBe('UNKNOWN');
  });

  it('작업 시간은 HH:MM:SS 다', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
    expect(formatDuration(-5)).toBe('00:00:00');
  });
});

describe('샘플', () => {
  it('샘플 작업 항목은 스키마를 지난다', () => {
    const item = workDayOf();
    expect(workDayItemSchema.parse(item)).toEqual(item);
  });
});

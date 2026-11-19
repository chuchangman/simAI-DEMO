import {
  REPORT_CHECKS,
  REPORT_RISK_ROWS,
  type ReportCheckRow,
  type ReportForm,
  type ReportRiskRow,
  type ReportTask,
  type WorkReport,
  type WorkTask,
} from '@/features/work/types';
import { pad2, toDateKey } from '@/features/work/workDay';

// 하루 양식(report.form)의 순수 계산: 빈 양식, 작업명, 종료 미팅 문장, 편집 창 상태 → 저장할 양식. 서버 TbmForm·프로토타입 규칙과 같다.

/** 빈 양식. 일시만 채우고 '작업일 동일(예)' 로 둔다(서버 TbmForm.blank 와 같다). */
export function blankReportForm(dateTimeMs: number | null): ReportForm {
  return {
    info: {
      date_time_ms: dateTimeMs,
      same_day: true,
      task_name: '',
      tasks: [],
      place: '',
      risk_assessed: null,
    },
    risks: Array.from({ length: REPORT_RISK_ROWS }, () => ({ risk: '', measure: '' })),
    focus: { risk: '', measure: '' },
    checks: REPORT_CHECKS.map(({ code, label }) => ({ code, label, yes: null, action: '' })),
    review: { daily: '', ending: '' },
  };
}

/** 작업내용 한 줄의 글자: 항목이면 서버 문구, 직접 쓴 작업이면 그 글, 모르는 코드면 코드 그대로. */
export function taskLabelOf(task: ReportTask, catalog: readonly WorkTask[]): string {
  if ('code' in task) return catalog.find((item) => item.code === task.code)?.label ?? task.code;
  return task.text;
}

/** 작업명: 첫 항목 문구 + (2개 이상이면 ' 외 N건'). 작업내용이 없으면 ''. 서버가 양식 저장 때 같은 규칙으로 채운다. */
export function taskNameOf(tasks: readonly ReportTask[], catalog: readonly WorkTask[]): string {
  const [first] = tasks;
  if (!first) return '';
  const rest = tasks.length - 1;
  return taskLabelOf(first, catalog) + (rest > 0 ? ` 외 ${rest}건` : '');
}

/** 걸린 시간(ms) → 'HH:MM:SS'. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}`;
}

const EMPTY_FORM = blankReportForm(null);

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** 잠재위험·대책 줄 번호(0부터)의 동그라미 숫자. 열 줄을 넘으면 그냥 숫자. */
export function circledNumber(index: number): string {
  return CIRCLED[index] ?? String(index + 1);
}

/** 보고서의 양식. 보고서가 아직 없거나(받는 중) 예전 방식이라 양식이 없으면 빈 양식이다. */
export function reportFormOf(report: Pick<WorkReport, 'form'> | null | undefined): ReportForm {
  return report?.form ?? EMPTY_FORM;
}

/**
 * 초안 칸이 채워졌거나(SUCCEEDED) 더는 채워질 일이 없는(FAILED) 보고서인가.
 * 아니면(PENDING·GENERATING) 시스템이 채울 칸은 줄무늬이고 편집 창은 작업내용만 보인다.
 */
export function isDrafted(report: Pick<WorkReport, 'draft_status'> | null | undefined): boolean {
  return report?.draft_status === 'SUCCEEDED' || report?.draft_status === 'FAILED';
}

/** 제출해 잠긴 보고서인가(양식 수정·서명이 막힌다). */
export function isReportLocked(report: Pick<WorkReport, 'locked_at' | 'submitted_at'>): boolean {
  return report.locked_at !== null || report.submitted_at !== null;
}

// ── 필수 칸 ──────────────────────────────────────────────────────────────────

export type ReportMissingKey = 'tasks';

/** '다음' 을 막는 빈 칸. 사람이 꼭 정해야 하는 것은 작업내용뿐이다(나머지는 세팅 뒤 초안이 채운다). */
export function missingKeys(form: ReportForm | null | undefined): ReportMissingKey[] {
  return form !== null && form !== undefined && form.info.tasks.length > 0 ? [] : ['tasks'];
}

// ── 일시 ─────────────────────────────────────────────────────────────────────

/** 일시(ms) → 'YYYY-MM-DD HH:mm'(현장 시각). 없으면 ''. */
export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const date = new Date(ms);
  return `${toDateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 일시 입력 칸(datetime-local)의 값 'YYYY-MM-DDTHH:mm'. 없으면 ''. */
export function dateTimeInputValue(ms: number | null | undefined): string {
  return formatDateTime(ms).replace(' ', 'T');
}

/** 일시 입력 칸의 값 → ms. 비었거나 형식이 틀리면 null. */
export function parseDateTimeInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const time = new Date(year, month - 1, day, hour, minute).getTime();
  return Number.isNaN(time) ? null : time;
}

// ── 작업내용 고르기 ──────────────────────────────────────────────────────────

/** 작업내용 편집 상태: 고른 항목 코드, 그리고 '기타' 체크·직접 쓴 글. */
export interface TaskSelection {
  codes: readonly string[];
  etcChecked: boolean;
  etcText: string;
}

/** 양식의 작업내용 → 편집 상태. 직접 쓴 작업이 여럿이면 쉼표로 이어 '기타' 칸에 담는다. */
export function selectionOfTasks(tasks: readonly ReportTask[]): TaskSelection {
  const codes = tasks.flatMap((task) => ('code' in task ? [task.code] : []));
  const texts = tasks.flatMap((task) => ('text' in task ? [task.text] : []));
  return { codes, etcChecked: texts.length > 0, etcText: texts.join(', ') };
}

/** 항목 하나를 켜거나 끈다. */
export function toggleTaskCode(selection: TaskSelection, code: string): TaskSelection {
  const codes = selection.codes.includes(code)
    ? selection.codes.filter((item) => item !== code)
    : [...selection.codes, code];
  return { ...selection, codes };
}

/** '기타' 체크를 바꾼다(쓴 글은 그대로 둔다). */
export function withEtcChecked(selection: TaskSelection, etcChecked: boolean): TaskSelection {
  return { ...selection, etcChecked };
}

/** '기타' 글을 바꾼다. 글자를 쓰면 체크가 켜진다. */
export function withEtcText(selection: TaskSelection, etcText: string): TaskSelection {
  return { ...selection, etcText, etcChecked: selection.etcChecked || etcText.trim() !== '' };
}

/**
 * 편집 상태 → 양식의 작업내용: 항목은 목록 순서대로(목록에 없는 코드는 뒤에 그대로), 직접 쓴 글은 맨 끝에 하나.
 * 체크를 켠 '기타' 에 글이 없으면 넣지 않는다.
 */
export function tasksOfSelection(
  selection: TaskSelection,
  catalog: readonly WorkTask[],
): ReportTask[] {
  const known = catalog.filter((item) => selection.codes.includes(item.code));
  const unknown = selection.codes.filter((code) => !catalog.some((item) => item.code === code));
  const text = selection.etcChecked ? selection.etcText.trim() : '';
  return [
    ...known.map(({ code }) => ({ code })),
    ...unknown.map((code) => ({ code })),
    ...(text === '' ? [] : [{ text }]),
  ];
}

// ── 편집 창 상태 → 저장할 양식 ───────────────────────────────────────────────

/**
 * 초안 뒤 편집 창이 고치는 나머지 칸. 일시는 입력 칸의 글('YYYY-MM-DDTHH:mm' 또는 '')로 들고,
 * 점검 줄은 코드·문구까지 그대로 둔다(저장하면 서버가 문구를 제 값으로 덮는다). 리더·참석자는 양식에 없다.
 */
export interface ReportFieldEdits {
  dateTime: string;
  sameDay: boolean | null;
  taskName: string;
  place: string;
  riskAssessed: boolean | null;
  risks: ReportRiskRow[];
  focus: ReportRiskRow;
  checks: ReportCheckRow[];
  review: ReportForm['review'];
}

/** 편집 창 상태. 초안 전에는 작업내용만 있고 `fields` 가 없다. */
export interface ReportEdits {
  tasks: TaskSelection;
  fields?: ReportFieldEdits;
}

/** 양식 → 편집 창이 처음 보여 줄 나머지 칸(원본을 건드리지 않게 복사한다). */
export function fieldEditsOf(form: ReportForm): ReportFieldEdits {
  return {
    dateTime: dateTimeInputValue(form.info.date_time_ms),
    sameDay: form.info.same_day,
    taskName: form.info.task_name,
    place: form.info.place,
    riskAssessed: form.info.risk_assessed,
    risks: form.risks.map((row) => ({ ...row })),
    focus: { ...form.focus },
    checks: form.checks.map((row) => ({ ...row })),
    review: { ...form.review },
  };
}

const trimmed = ({ risk, measure }: ReportRiskRow): ReportRiskRow => ({
  risk: risk.trim(),
  measure: measure.trim(),
});

/**
 * TBM 작성 시각(S15P31A101-734): 서버는 빈 양식을 작업(보고서)을 만들 때 만들고 일시에 그 시각을 넣는다. 그 값은 TBM 을 쓴 시각이 아니라
 * 작업이 생긴 시각이라(예: 자정 0시 9분), 사람이 처음 작업내용을 골라 TBM 을 쓰는 저장에서 지금 시각으로 바꿔 저장한다.
 * 작업내용이 비어 있는 동안은 아직 쓰지 않은 양식이다.
 */
export const isTbmWritten = (form: Pick<ReportForm, 'info'>): boolean => form.info.tasks.length > 0;

/**
 * 받아 둔 양식에 편집 창에서 고친 것을 입혀 저장할 양식을 만든다. 초안 전(`fields` 없음)에는 작업내용만 바뀐다.
 * 작업내용을 처음 고르는 저장이면 일시는 지금(now)으로 바뀐다(`isTbmWritten`). 사람이 일시 칸을 직접 고쳤으면 그 값이 먼저다.
 * 점검의 조치 내용은 '아니오' 일 때만 남긴다. 작업명은 작업내용이 바뀌면 서버가 다시 채운다.
 */
export function applyEdits(
  form: ReportForm,
  { tasks, fields }: ReportEdits,
  catalog: readonly WorkTask[],
  now: number = Date.now(),
): ReportForm {
  const nextTasks = tasksOfSelection(tasks, catalog);
  const firstWrite = !isTbmWritten(form) && nextTasks.length > 0;
  const writtenAt = firstWrite ? now : form.info.date_time_ms;
  if (!fields) {
    return { ...form, info: { ...form.info, tasks: nextTasks, date_time_ms: writtenAt } };
  }
  const untouched = fields.dateTime === dateTimeInputValue(form.info.date_time_ms);
  return {
    info: {
      date_time_ms: untouched ? writtenAt : parseDateTimeInput(fields.dateTime),
      same_day: fields.sameDay,
      task_name: fields.taskName.trim(),
      tasks: nextTasks,
      place: fields.place.trim(),
      risk_assessed: fields.riskAssessed,
    },
    risks: fields.risks.map(trimmed),
    focus: trimmed(fields.focus),
    checks: fields.checks.map((row) => ({
      ...row,
      action: row.yes === false ? row.action.trim() : '',
    })),
    review: { daily: fields.review.daily.trim(), ending: fields.review.ending.trim() },
  };
}

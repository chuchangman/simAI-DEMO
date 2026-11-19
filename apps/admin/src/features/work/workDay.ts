import type { DayProgress, WorkDayItem, WorkReport } from '@/features/work/types';

// 하루 작업의 순수 계산: 진행 단계 ↔ 화면 단계, 달력 칸 표시에 쓰는 진행 값 판정, 날짜 키 도우미. 시계에 직접 기대지 않는다(오늘 키는 인자로 받는다).

// ── 화면 단계 ────────────────────────────────────────────────────────────────

/** 날짜 화면의 네 단계(오른쪽 단계 줄·아래 단추 줄이 따른다). */
export const WORK_STAGE_IDS = ['report', 'setup', 'preflight', 'run'] as const;
export type WorkStageId = (typeof WORK_STAGE_IDS)[number];

/** 단계 이름(단계 줄에 보이는 글). */
export const WORK_STAGE_LABELS: Record<WorkStageId, string> = {
  report: 'TBM 보고서',
  setup: '세팅',
  preflight: '작업 전 확인',
  run: '작업 종료',
};

/** 단계 줄에 순서대로 놓는 이름 표. */
export const WORK_STAGES: readonly { id: WorkStageId; label: string }[] = WORK_STAGE_IDS.map(
  (id) => ({ id, label: WORK_STAGE_LABELS[id] }),
);

/** 서버 진행 값이 정하는 화면 단계. REPORT→보고서, SETUP→세팅, SETUP_DONE→작업 전 확인, 나머지(작업 중·종료·제출)→작업 종료. */
export function stageOfProgress(progress: DayProgress): WorkStageId {
  switch (progress) {
    case 'REPORT':
      return 'report';
    case 'SETUP':
      return 'setup';
    case 'SETUP_DONE':
      return 'preflight';
    case 'IN_PROGRESS':
    case 'ENDED':
    case 'SUBMITTED':
      return 'run';
  }
}

/** 단계 순서(0부터). 단계 줄에서 지난 단계(✓)·지금 단계를 가릴 때 쓴다. */
export const stageIndexOf = (stage: WorkStageId): number => WORK_STAGE_IDS.indexOf(stage);

/** 작업내용을 고르기 전에는 날짜 작업의 이름이 비어 온다. 화면에는 이 글로 대신 보인다. */
export const EMPTY_WORK_NAME = '작업';

/** 화면에 보일 작업 이름(서버 이름이 비어 있으면 `EMPTY_WORK_NAME`). */
export const workNameOf = (name: string): string => name || EMPTY_WORK_NAME;

// ── 달력 칸 표시 ─────────────────────────────────────────────────────────────

/**
 * 오늘 칸 단추 글: 서버 진행 값마다 지금 할 일이다. 제출(SUBMITTED)은 할 일이 없어 단추 대신 완료 표시가 되므로 null 이다.
 * S15P31A101-691: 보고서 단계는 날짜를 열어 준비(보고서·세팅)를 시작하는 것이라 「작업 시작」(실제 시작은 작업 전 확인의 단추)과
 * 헷갈리지 않게 「오늘 작업 준비」, 종료 뒤는 작업 종료 단계 단추와 같은 「보고서 제출」이다.
 */
export const TODAY_ACTION: Record<DayProgress, string | null> = {
  REPORT: '오늘 작업 준비',
  SETUP: '세팅 이어하기',
  SETUP_DONE: '작업 전 확인',
  IN_PROGRESS: '관제 중',
  ENDED: '보고서 제출',
  SUBMITTED: null,
};

/** 작업의 진행 값. 진행 값을 모르는 옛 응답은 실제로 끝난 작업이면 제출한 것(SUBMITTED)으로, 아니면 null 로 본다. */
export function workProgressOf(work: WorkDayItem): DayProgress | null {
  return work.progress ?? (work.actual_ended_at !== null ? 'SUBMITTED' : null);
}

/**
 * 끝난 작업(종료 ENDED·제출 SUBMITTED)인가. 시작한 작업은 그날 안에 반드시 끝난다고 보고,
 * 지난 날 달력 칸과 지난 날짜 화면은 끝난 작업만 다룬다.
 */
export function isEndedWork(work: WorkDayItem): boolean {
  const progress = workProgressOf(work);
  return progress === 'ENDED' || progress === 'SUBMITTED';
}

/**
 * 초안을 기다리는 중인가: 초안을 만드는 중(GENERATING)이거나, 세팅이 끝났는데 서버가 아직 초안을 시작하지 않았다(PENDING).
 * 보고서를 짧게 다시 받아 줄무늬 칸이 채워지는 때를 잡는 데 쓴다. 실패(FAILED)·완료(SUCCEEDED)면 멈춘다.
 */
export function isDraftPending(report: WorkReport | null | undefined, setupDone: boolean): boolean {
  if (!report || report.locked_at !== null) return false;
  if (report.draft_status === 'GENERATING') return true;
  return setupDone && report.draft_status === null && report.status === 'PENDING';
}

/**
 * 종료 미팅을 서버가 채우는 중인가(`wrap_up_status` 가 GENERATING): 작업을 끝낸 직후 `종료 미팅` 칸이 채워지는 동안이다.
 * 보고서를 짧게 다시 받아 칸이 채워지는 때를 잡고, 이때 보고서를 보내면 종료 미팅이 빈 채 잠기므로 보내기는 미룬다.
 * 서버가 건너뛰거나(SKIPPED) 실패하면 GENERATING 이 아니라서 사람이 직접 쓸 수 있다.
 */
export function isEndingGenerating(report: WorkReport | null | undefined): boolean {
  return report?.wrap_up_status === 'GENERATING';
}

/**
 * 서버가 보고서를 쓰는 중이라 제출을 받지 않는가(409 REPORT_NOT_READY): AI 초안(`status` GENERATING)이나
 * 종료 미팅(`wrap_up_status` GENERATING)을 쓰는 동안이다.
 */
export function isReportGenerating(report: WorkReport | null | undefined): boolean {
  return report?.status === 'GENERATING' || isEndingGenerating(report);
}

/**
 * 작업 시작·보고서 보내기 확인창에 띄울 AI 초안 경고(-625). 날짜 작업 양식(form)이 있고 잠기지 않았는데 초안이 끝나지 않았으면
 * 위험·대책·점검 칸이 비어 있을 수 있다고 알린다. 막지는 않는다(사람이 직접 채웠을 수 있다). 초안이 끝났거나 양식이 없으면 null.
 */
export function draftWarning(report: WorkReport | null | undefined): string | null {
  if (!report || report.form === null || report.locked_at !== null) return null;
  switch (report.draft_status) {
    case null:
      return 'AI 초안을 만들지 않았습니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.';
    case 'FAILED':
      return 'AI 초안을 만들지 못했습니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.';
    case 'GENERATING':
      return 'AI 초안을 아직 만드는 중입니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.';
    default:
      return null;
  }
}

// ── 날짜 키 ──────────────────────────────────────────────────────────────────

/** 날짜 키는 현장(브라우저) 시각의 'YYYY-MM-DD' 다. 문자열 순서가 날짜 순서와 같다. */
export type DateKey = string;

export type DayKind = 'past' | 'today' | 'future';

/** 날짜가 오늘 기준 지난 날·오늘·예정인 날인지. 오늘 키는 부르는 쪽이 정한다. */
export function dayKind(dateKey: DateKey, todayKey: DateKey): DayKind {
  if (dateKey < todayKey) return 'past';
  return dateKey === todayKey ? 'today' : 'future';
}

/** 숫자를 두 자리로 0 을 채운다(날짜·시각·시간 글에 쓴다). */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD'(현장 시각). */
export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 'YYYY-MM-DD' → 그날 0시(현장 시각) Date. 형식이 틀리거나 없는 날짜(2월 30일 등)면 null. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return toDateKey(date) === key ? date : null;
}

/** 요일 이름. 일요일부터 센다(Date.getDay 와 같은 순서). */
export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 날짜 화면 머리글: 'YYYY년 M월 D일 (요일)'. 잘못된 키면 받은 그대로. */
export function formatDayTitle(key: DateKey): string {
  const date = parseDateKey(key);
  if (!date) return key;
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_NAMES[date.getDay()]})`;
}

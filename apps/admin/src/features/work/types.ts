import { workRunsField } from '@/lib/workRuns';
import { z } from 'zod';

// 작업 관리 새 흐름(하루 = 작업 하나)의 요청·응답 스키마와 상수. 서버 -609(양식)·-610(날짜 작업)·-611(서명·제출) 계약이다.
// 서버가 아직 안 준 칸·모르는 칸에서 화면이 깨지지 않게, 칸은 너그럽게 읽고(null·빠짐 허용) 모르는 칸은 버린다(실패시키지 않는다).
// 인터페이스 정본: docs/design/tbm-daily-form.md, server/.../domain/{report,work}.

/** 서버 id 는 숫자·문자열 어느 쪽으로 와도 문자열로 다룬다. */
const idString = z.union([z.string().min(1), z.number().int()]).transform(String);
/** 없거나 null 이면 null 로 통일한다. */
const orNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);
/** 글자 칸. 없거나 null 이면 빈 글자다(서버도 빠진 글자 칸을 "" 로 본다). */
const formText = z
  .string()
  .nullish()
  .transform((v) => v ?? '');
/** 예·아니오 칸. 아직 고르지 않았으면 null 이다. */
const formFlag = z
  .boolean()
  .nullish()
  .transform((v) => v ?? null);

/** 날짜 키 'YYYY-MM-DD'(현장 시각). */
export const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── 하루 진행 단계 ───────────────────────────────────────────────────────────

/**
 * 하루 작업의 진행 단계(서버 `progress`). 화면은 이 값을 다시 계산하지 않고 그대로 쓴다.
 * REPORT 보고서 작성 · SETUP 세팅 중 · SETUP_DONE 세팅 끝(작업 전 확인) · IN_PROGRESS 작업 중 · ENDED 작업 종료(제출 전) · SUBMITTED 제출·잠금.
 */
export const DAY_PROGRESS = [
  'REPORT',
  'SETUP',
  'SETUP_DONE',
  'IN_PROGRESS',
  'ENDED',
  'SUBMITTED',
] as const;
export const dayProgressSchema = z.enum(DAY_PROGRESS);
export type DayProgress = z.infer<typeof dayProgressSchema>;

/** 작업 상태(서버 work_unit.status). */
export const WORK_STATUS = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
export type WorkStatus = (typeof WORK_STATUS)[number];

/** 보고서 초안 상태(`draft_status`). 아직 세팅 전(PENDING)이면 서버는 null 을 준다. */
export const DRAFT_STATUS = ['GENERATING', 'SUCCEEDED', 'FAILED'] as const;
export type DraftStatus = (typeof DRAFT_STATUS)[number];
const draftStatusSchema = z
  .enum(['PENDING', ...DRAFT_STATUS])
  .nullish()
  .transform((v): DraftStatus | null => (v == null || v === 'PENDING' ? null : v));

// ── 작업 항목 (/api/work-units) ──────────────────────────────────────────────

/** 작업 항목에 붙는 보고서 요약(작업 목록·하루 작업 응답의 `tbm_report`). */
export const workDayReportRefSchema = z.object({
  report_id: z.number().int(),
  draft_status: draftStatusSchema,
  /** 제출 시각(ms). 제출 전이면 null(티켓 -611). */
  submitted_at: orNull(z.number()),
});
export type WorkDayReportRef = z.infer<typeof workDayReportRefSchema>;

/**
 * 하루 작업 하나. 날짜 작업(daily)과 예전 방식 작업(daily: false)이 같은 모양으로 온다.
 * 히스토리의 `WorkUnit`(features/history/types)과 같은 칸(from_ms·to_ms·actual_*·event_counts·planned_people)을 모두 갖는다.
 * 서버가 안 주는 옛 응답에서도 읽히도록 progress·tbm_report 는 null 을 허용한다(null = 새 흐름이 모르는 작업).
 */
export const workDayItemSchema = z.object({
  /** 작업 id(문자열). 세팅 세션의 work_unit_id 는 이 값을 숫자로 바꾼 것이다. */
  work_id: idString,
  date: dateKeySchema,
  /** 작업명. 날짜 작업은 처음에 비어 있고, 작업내용을 고르면 서버가 '첫 항목 외 N건' 으로 채운다. */
  name: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  daily: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  progress: dayProgressSchema
    .nullish()
    .catch(null)
    .transform((v) => v ?? null),
  tbm_report: orNull(workDayReportRefSchema),
  status: orNull(z.enum(WORK_STATUS).catch('PLANNED')),
  from_ms: z.number(),
  to_ms: z.number(),
  /** 진행 중인 세팅 세션 id. 없으면 null. */
  active_setup_session_id: orNull(z.string()),
  /** 첫 실행 시작 · 마지막 실행 종료(실행 중이면 null). 실행별 시각은 runs 다(S15P31A101-696). */
  actual_started_at: orNull(z.number()),
  actual_ended_at: orNull(z.number()),
  /** 실행 목록(번호순, 진행 중 실행은 ended_at null). 옛 서버는 칸이 없다(`runsOf` 가 actual_* 로 실행 1 을 만든다). */
  runs: workRunsField,
  /** 구간에 발생한 이벤트 수(등급별). 모르면 null. */
  event_counts: orNull(z.object({ CRITICAL: z.number().int(), HIGH: z.number().int() }).partial()),
  /** 관제 카드 기준 사건 수(등급별, S15P31A101-751). 이전 서버는 칸이 없다. */
  incident_counts: orNull(
    z.object({ CRITICAL: z.number().int(), HIGH: z.number().int() }).partial(),
  ),
  zone_id: orNull(z.string()),
  place: orNull(z.string()),
  lead: orNull(z.string()),
  layout_id: orNull(z.number().int()),
  work_type: orNull(z.string().catch('')),
  /** 작업 중 안전모·조끼 요구(S15P31A101-654). 서버 기본은 REQUIRED, 이전 서버는 칸이 없다(모름). */
  helmet: z.enum(['REQUIRED', 'NOT_REQUIRED']).optional().catch(undefined),
  vest: z.enum(['REQUIRED', 'NOT_REQUIRED']).optional().catch(undefined),
  /** 날짜 작업은 계획 인원이 없어 0 이다. */
  planned_people: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? 0),
});
export type WorkDayItem = z.infer<typeof workDayItemSchema>;

/** 받은 작업 배열에서 형식이 맞는 것만 고른다(하나가 틀려도 달력이 비지 않게). */
export function readWorkDays(items: readonly unknown[]): WorkDayItem[] {
  return items.flatMap((item) => {
    const parsed = workDayItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** GET /api/work-units?from=&to= 응답 `{ works }`. 형식이 틀린 작업은 뺀다. */
export const workDaysResponseSchema = z.object({
  works: z.array(z.unknown()).transform(readWorkDays),
});
export type WorkDaysResponse = z.infer<typeof workDaysResponseSchema>;

/** 달력 월 목록의 날짜 범위(양 끝 포함). */
export interface WorkDaysRange {
  from: string;
  to: string;
}

// ── 작업내용 항목 (/api/work-tasks) ──────────────────────────────────────────

export const workTaskSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  rule_tags: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});
export type WorkTask = z.infer<typeof workTaskSchema>;
export const workTasksResponseSchema = z.array(workTaskSchema);

/**
 * 서버 GET /api/work-tasks 와 같은 7개(server/.../domain/work/WorkTasks.java). 모의 서버와 시험의 기본 목록이다.
 * 화면은 이 상수를 쓰지 않고 `useWorkTasks()` 로 받는다.
 */
export const WORK_TASKS: readonly WorkTask[] = [
  { code: 'SLAB_OPENING_COVER', label: '슬래브 개구부 덮개 설치', rule_tags: ['R1', 'R2', 'R5'] },
  { code: 'WORK_PLATFORM', label: '고소 작업면(발판) 설치·해체', rule_tags: ['R2', 'R3', 'R4'] },
  { code: 'FORMWORK', label: '거푸집 설치·해체', rule_tags: ['R2', 'R3', 'R4'] },
  { code: 'REBAR', label: '철근 배근', rule_tags: ['R1', 'R2', 'R4'] },
  { code: 'MATERIAL_HANDLING', label: '자재 반입·정리', rule_tags: ['R1', 'R5'] },
  { code: 'EXTERIOR_SCAFFOLD_CHECK', label: '외벽 비계 점검', rule_tags: ['R2', 'R3', 'R4'] },
  { code: 'FLOOR_FINISHING', label: '바닥 마감', rule_tags: ['R1', 'R4'] },
];

// ── 하루 양식 (report.form) ──────────────────────────────────────────────────

/** 잠재위험·대책 줄 수(서버는 정확히 3줄만 받는다). */
export const REPORT_RISK_ROWS = 3;

/** 안전조치 점검 5줄의 코드·순서·문구(서버 TbmForm.CHECKS 와 같다. 저장 때 서버가 문구를 이 값으로 덮는다). */
export const REPORT_CHECKS = [
  { code: 'PPE', label: '안전모 등 보호구 착용 상태 확인' },
  { code: 'ZONE_CONTROL', label: '작업 구간 위험구역 표시 및 접근 통제' },
  { code: 'OPENING_GUARD', label: '개구부 덮개·난간 설치 확인' },
  { code: 'WORK_SURFACE_FALL', label: '고소 작업면 상태 및 추락 방호 확인' },
  { code: 'HEALTH', label: '작업자 건강 상태 확인' },
] as const;
export type ReportCheckCode = (typeof REPORT_CHECKS)[number]['code'];

/** 양식 칸 글자 수 한도(서버 TbmForm). 넘으면 400 INVALID_REPORT_FORM. */
export const REPORT_FORM_LIMITS = {
  /** 작업내용 항목 수 */
  tasks: 20,
  /** 작업명·직접 쓴 작업 */
  short: 100,
  place: 200,
  /** 위험·대책·점검 조치 */
  text: 500,
  /** 일일·종료 미팅 */
  review: 2000,
} as const;

/** 작업내용 한 줄: 항목 코드(`{code}`) 또는 직접 쓴 작업(`{text}`, '기타'). */
export const reportTaskSchema = z.union([
  z.object({ code: z.string() }),
  z.object({ text: z.string() }),
]);
export type ReportTask = z.infer<typeof reportTaskSchema>;

const riskRowSchema = z.object({ risk: formText, measure: formText });
export type ReportRiskRow = z.infer<typeof riskRowSchema>;

export const reportCheckRowSchema = z.object({
  code: z.string(),
  /** 서버가 정한 문구. 저장해도 서버 값으로 덮인다. */
  label: formText,
  yes: formFlag,
  action: formText,
});
export type ReportCheckRow = z.infer<typeof reportCheckRowSchema>;

/**
 * TBM 하루 양식. 글자 칸은 늘 문자열(빈 칸 ''), 예·아니오 칸은 true·false·null(아직 안 고름), 일시는 ms 또는 null 이다.
 * 사람이 입력하는 것은 `info.tasks` 뿐이고 나머지는 세팅이 끝난 뒤 서버 초안이 채운다(사람이 고칠 수 있다).
 * 리더·참석자는 양식에 없다(리더는 `WorkReport.leader`, 참석자는 서명).
 */
export const reportFormSchema = z.object({
  info: z.object({
    date_time_ms: orNull(z.number()),
    same_day: formFlag,
    task_name: formText,
    tasks: z
      .array(reportTaskSchema)
      .nullish()
      .transform((v) => v ?? []),
    place: formText,
    risk_assessed: formFlag,
  }),
  risks: z.array(riskRowSchema),
  focus: riskRowSchema,
  checks: z.array(reportCheckRowSchema),
  review: z.object({ daily: formText, ending: formText }),
});
export type ReportForm = z.infer<typeof reportFormSchema>;

// ── 보고서 (/api/reports/tbm) ────────────────────────────────────────────────

/** 보고서 상태. 빈 보고서는 PENDING, 세팅이 끝나면 초안 생성(GENERATING)을 거쳐 SUCCEEDED·FAILED. */
export const REPORT_STATUS = ['PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED'] as const;
export const workReportStatusSchema = z.enum(REPORT_STATUS);
export type WorkReportStatus = z.infer<typeof workReportStatusSchema>;

/** 리더(보고서를 만든 계정). 사람이 입력하지 않는다. */
export const reportLeaderSchema = z.object({
  user_id: z.number().int(),
  name: z.string(),
  org: orNull(z.string()),
  title: orNull(z.string()),
});
export type ReportLeader = z.infer<typeof reportLeaderSchema>;

const reportHeaderSchema = z.object({
  date: z.string(),
  name: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  from_ms: orNull(z.number()),
  to_ms: orNull(z.number()),
});

/** 보고서 한 판. 날짜 작업은 종료해도 같은 보고서(같은 report_id)를 쓰고, 예전 작업만 종료가 새 판을 만든다. 늘 `latest` 를 쓴다. */
export const workReportSchema = z.object({
  report_id: z.number().int(),
  work_id: idString,
  report_version: z.number().int(),
  status: workReportStatusSchema,
  /** 초안 상태. PENDING(세팅 전)이면 null. */
  draft_status: draftStatusSchema,
  failure_reason: orNull(z.string()),
  /** 하루 양식. 예전 방식 보고서는 null. */
  form: orNull(reportFormSchema),
  /** 양식 저장 때 되돌려 보내는 낙관적 잠금 값(저장마다 서버가 1 올린다). */
  form_revision: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? 0),
  leader: orNull(reportLeaderSchema),
  header: orNull(reportHeaderSchema),
  /** 잠긴 시각(ms). 제출하면 찍히고 이후 양식 수정·서명은 409 REPORT_LOCKED. */
  locked_at: orNull(z.number()),
  /** 제출 시각(ms)·제출한 계정의 표시 이름(-611). */
  submitted_at: orNull(z.number()),
  submitted_by_name: orNull(z.string()),
  signature_count: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? 0),
  content_sha256: orNull(z.string()),
  wrap_up_summary: orNull(z.string()),
  wrap_up_status: orNull(z.string()),
  created_at_ms: z
    .number()
    .nullish()
    .transform((v) => v ?? 0),
  completed_at_ms: orNull(z.number()),
});
export type WorkReport = z.infer<typeof workReportSchema>;

export const reportVersionSummarySchema = z.object({
  report_id: z.number().int(),
  report_version: z.number().int(),
  status: workReportStatusSchema,
  wrap_up_status: orNull(z.string()),
  created_at_ms: z
    .number()
    .nullish()
    .transform((v) => v ?? 0),
});
export type ReportVersionSummary = z.infer<typeof reportVersionSummarySchema>;

/** GET /api/reports/tbm?work_id= 응답. `versions` 는 최신 판이 먼저다. */
export const reportsByWorkSchema = z.object({
  latest: orNull(workReportSchema),
  versions: z
    .array(reportVersionSummarySchema)
    .nullish()
    .transform((v) => v ?? []),
});
export type ReportsByWork = z.infer<typeof reportsByWorkSchema>;

/** PUT /api/reports/tbm/{id}/form 요청 본문. */
export interface ReportFormSaveBody {
  form: ReportForm;
  /** 마지막으로 읽은 `form_revision`. 다르면 409 REPORT_FORM_CONFLICT. */
  form_revision: number;
}

/**
 * POST /api/work-units/{id}/end 응답(202). `wrap_up.mode` 가 FORM_ENDING 이면(날짜 작업) 같은 보고서(`report_id` 그대로)의
 * `review.ending` 을 서버가 채운다(status GENERATING, 보고서가 잠겼으면 SKIPPED·REPORT_LOCKED). NEW_VERSION 은 예전 작업으로 새 판의 id 가
 * `wrap_up.report_id` 다. mode 가 없을 수도 있다.
 */
export const workEndResponseSchema = z.object({
  work_unit: workDayItemSchema,
  wrap_up: z.object({
    status: z.string(),
    report_id: orNull(z.number().int()),
    reason: orNull(z.string()),
    mode: z.enum(['FORM_ENDING', 'NEW_VERSION']).optional(),
  }),
});
export type WorkEndResponse = z.infer<typeof workEndResponseSchema>;

// ── 서명 (/api/reports/tbm/{id}/signatures) ──────────────────────────────────

/** 서명 이미지 크기 상한(바이트). 서버가 256KiB 를 넘으면 받지 않는다. */
export const SIGNATURE_MAX_BYTES = 256 * 1024;
/** 보고서 판 하나의 서명 인원 상한. 넘으면 409 SIGNATURE_LIMIT_REACHED. */
export const SIGNATURE_MAX_COUNT = 50;
/** 서명자 이름 글자 수 한도(1~40). */
export const SIGNER_NAME_MAX = 40;

/** 서명 목록 한 줄. 이미지는 잠시 쓸 수 있는 주소(`image_url`)로 온다. */
export const workSignatureSchema = z.object({
  signature_id: idString,
  signer_name: z.string(),
  signer_role: z
    .string()
    .nullish()
    .transform((v) => v ?? 'PARTICIPANT'),
  signed_at: z.number(),
  report_version: z.number().int(),
  image_url: z.string(),
});
export type WorkSignature = z.infer<typeof workSignatureSchema>;
export const workSignaturesResponseSchema = z.object({ items: z.array(workSignatureSchema) });

/** 서명 추가 요청 본문. 결재(APPROVER)는 쓰지 않아 참석자(PARTICIPANT)만 보낸다. */
export interface SignatureRequestBody {
  report_version: number;
  signer_name: string;
  signer_role?: 'PARTICIPANT';
  image_key: string;
  image_sha256: string;
}

/** 서명 추가 응답(201). 첫 서명이 더는 잠그지 않아(-611) `locked_at` 은 제출 전에는 null 이다. */
export const signatureResultSchema = z.object({
  signature_id: idString,
  report_id: z.number().int(),
  report_version: z.number().int(),
  signer_name: z.string(),
  signed_at: z.number(),
  locked_at: orNull(z.number()),
  content_sha256: orNull(z.string()),
});
export type SignatureResult = z.infer<typeof signatureResultSchema>;

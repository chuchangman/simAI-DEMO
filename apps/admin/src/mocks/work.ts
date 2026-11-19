import type { SetupSessionResponse } from '@/features/setup/types';
import { WORK_ERROR } from '@/features/work/api';
import { blankReportForm, formatDuration, taskNameOf } from '@/features/work/reportForm';
import {
  REPORT_CHECKS,
  REPORT_FORM_LIMITS,
  REPORT_RISK_ROWS,
  reportFormSchema,
  SIGNATURE_MAX_COUNT,
  SIGNER_NAME_MAX,
  WORK_TASKS,
  type DayProgress,
  type DraftStatus,
  type ReportForm,
  type ReportLeader,
  type ReportTask,
  type WorkReport,
  type WorkStatus,
} from '@/features/work/types';
import { dayKind, isReportGenerating, parseDateKey, toDateKey } from '@/features/work/workDay';
import type { WorkRun } from '@/lib/workRuns';
import { historyWorks } from '@/mocks/history';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { http, HttpResponse } from 'msw/http';

// 작업 관리 새 흐름(하루 = 작업 하나) mock. 서버(-609·-610·-611·-624)를 따라 개발 서버·시험에서 하루 전체 흐름을 이 메모리 상태 하나로 돈다:
//   날짜 열기(PUT daily) → 양식 저장 → 세팅 → 초안 → 서명 → 시작 → 종료 → 제출.
// 상태 전이(progress):
//   REPORT      날짜 작업만 있다(세션 없음)
//   SETUP       그 작업의 세팅 세션이 있고 아직 끝나지 않았다(setupSessions 에서 읽는다)
//   SETUP_DONE  세팅이 끝났다: 세팅 완료(POST .../complete, -615)로 setup_completed_at_ms 가 찍혔거나, markSetupDone 을 불렀다
//               → 보고서 draft_status 가 GENERATING(draftDelayMs, 기본 2.5초) → SUCCEEDED 로 바뀌며 빈 칸이 채워진다
//   IN_PROGRESS POST /start 뒤(날짜가 오늘이고 세팅을 완료했고(-642) 서명이 있을 때만)
//   ENDED       POST /end 뒤(새 판 없이 같은 보고서: wrap_up_status 가 GENERATING → draftDelayMs 뒤 SUCCEEDED, 그때 review.ending 이 비어 있으면
//               종료 문장으로 채우고 form_revision+1. 서버 B10 의 날짜 작업 종료 미팅이다)
//   SUBMITTED   POST /submit 뒤(작업이 ENDED 이고 초안·종료 미팅 채우기가 끝났을 때만, 이후 양식 수정·서명은 409 REPORT_LOCKED)
// 시계는 now() 로 주입한다(타이머를 쓰지 않는다. 초안 진행은 요청이 올 때 now() 로 계산한다).
//
// 기존 mocks/tbm.ts 의 작업 CRUD·옛 보고서 핸들러는 그대로 두고, 이 mock 이 아는 작업·보고서(daily 작업, 합성 지난 이력)에
// 대해서만 먼저 답한다. 모르는 id·`?days=` 같은 옛 요청은 undefined 를 돌려 다음 핸들러로 넘긴다(handlers.ts 에서 먼저 등록).
// 서명 올리기(POST /api/uploads/sign·PUT 업로드·서명 이미지)는 mocks/tbm.ts 의 것을 그대로 쓴다.
// 서명은 서버처럼 보고서(report_id)별로 든다. 날짜 작업은 종료해도 같은 보고서라 서명이 그대로 남는다(예전 작업의 새 판 종료는 흉내 내지 않는다).
// 서명·제출·시작의 검사 순서와 오류 코드는 서버(ReportSignatureController·TbmReportRepository.submit·WorkUnitRepository.startSession)를 따른다.
// 오류 코드는 features/work/api 의 WORK_ERROR 를 쓴다(목 전용 코드만 아래 핸들러에 문자열로 있다).

/** 날짜 작업 id·보고서 id 의 시작 번호. 옛 TBM mock 의 번호(작업 1~, 보고서 301~)와 겹치지 않게 크게 둔다. */
const FIRST_WORK_ID = 9001;
const FIRST_REPORT_ID = 9001;
const FIRST_SIGNATURE_ID = 9001;
/** 합성 지난 이력 보고서 id 의 시작 번호. */
const FIRST_PAST_REPORT_ID = 8001;

/** 빈 보고서의 일시(예정인 날은 그날 07:30). */
const PLANNED_START = { hour: 7, minute: 30 };
/** 날짜 작업의 계획 시각(그날 07:30–17:00). */
const PLANNED_END = { hour: 17, minute: 0 };
/** 세팅이 끝난 뒤 초안이 만들어지기까지(ms). */
const DEFAULT_DRAFT_DELAY_MS = 2_500;
/** 달력 한 번에 받을 수 있는 날짜 범위(일). */
const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;

/** 목 계정(리더). 프로토타입 W3.mock.account 와 같다. */
const MOCK_LEADER: ReportLeader = {
  user_id: 1,
  name: '김안전',
  org: '(주)안전건설',
  title: '안전관리자',
};

/** 초안이 장소·잠재위험·점검에 쓰는 구역(프로토타입 W3.mock.aiZones 의 이름·종류·등급). */
export interface DraftZone {
  name: string;
  kind: 'OPENING' | 'ELEVATED' | 'EDGE' | 'CUSTOM';
  sev: 'CRITICAL' | 'HIGH' | 'CAUTION';
}
const DEFAULT_DRAFT_ZONES: readonly DraftZone[] = [
  { name: '개구부 위험 구역', kind: 'OPENING', sev: 'CRITICAL' },
  { name: '고소 작업면 둘레', kind: 'ELEVATED', sev: 'HIGH' },
  { name: '바닥 가장자리', kind: 'EDGE', sev: 'CAUTION' },
];
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, CAUTION: 2 } as const;
const RISK_BY_KIND: Partial<Record<DraftZone['kind'], { risk: string; measure: string }>> = {
  OPENING: { risk: '개구부 추락', measure: '덮개·난간 설치, 접근 통제' },
  ELEVATED: { risk: '작업 발판 위 추락·전도', measure: '안전대 체결, 발판 고정 확인' },
  EDGE: { risk: '바닥 가장자리 추락', measure: '임시 난간 설치, 접근 금지선' },
};
const OPENING_CHECK_ACTION = '덮개 설치 전까지 접근 통제';
/** 서명자 역할: 참석자(작업 전 확인)와 결재자(서버는 받지만 화면은 쓰지 않는다). */
const SIGNER_ROLES = ['PARTICIPANT', 'APPROVER'] as const;
type SignerRole = (typeof SIGNER_ROLES)[number];
const isSignerRole = (value: unknown): value is SignerRole =>
  SIGNER_ROLES.some((role) => role === value);

/** 세팅 mock(mocks/setup)의 세션 중 이 mock 이 읽는 칸. */
export type MockSetupSession = Pick<
  SetupSessionResponse,
  | 'setup_session_id'
  | 'work_unit_id'
  | 'status'
  | 'zones_committed_at'
  | 'started_at_ms'
  | 'setup_completed_at_ms'
>;

export interface WorkMockOptions {
  now?: () => number;
  /** 세팅 세션 목록(보통 `() => setupMock.sessions.values()`). 작업의 세팅 중·끝남을 여기서 읽는다. 없으면 세션이 없는 것으로 본다. */
  setupSessions?: () => Iterable<MockSetupSession>;
  /** 세팅이 끝난 뒤 초안(GENERATING)이 끝나기까지(ms). 기본 2500. */
  draftDelayMs?: number;
  /** 초안이 쓰는 구역. 기본은 프로토타입의 구역 셋(개구부·고소 작업면·바닥 가장자리). */
  draftZones?: readonly DraftZone[];
}

type MockReport = WorkReport & { form: ReportForm };

interface MockSignature {
  signature_id: string;
  signer_name: string;
  signer_role: SignerRole;
  signed_at: number;
  report_version: number;
  image_url: string;
}

/** 날짜 작업 하나의 메모리 상태. */
interface MockWork {
  work_id: string;
  date: string;
  name: string;
  from_ms: number;
  to_ms: number;
  status: WorkStatus;
  actual_started_at: number | null;
  actual_ended_at: number | null;
  /** 실행 목록(S15P31A101-696). 시작마다 하나 더하고 종료가 마지막 실행을 닫는다. */
  runs: WorkRun[];
  event_counts: { CRITICAL: number; HIGH: number };
  /** 세팅이 끝난 시각. null 이면 아직. */
  setupDoneAt: number | null;
  /** true 면 초안이 FAILED 로 끝난다. */
  draftFails: boolean;
  /** 화면에서 AI 초안을 요청한(POST form-draft) 시각. null 이면 요청하지 않았다(S15P31A101-624). */
  draftRequestedAt: number | null;
  /** 하루 보고서. 종료해도 같은 보고서(같은 report_id)를 쓴다. */
  report: MockReport;
}

/** 작업 항목 JSON(GET /api/work-units 의 한 건). */
export interface WorkItemJson {
  work_id: string;
  date: string;
  name: string;
  daily: boolean;
  progress: DayProgress;
  tbm_report: { report_id: number; draft_status: DraftStatus | null; submitted_at: number | null };
  status: WorkStatus;
  from_ms: number;
  to_ms: number;
  active_setup_session_id: string | null;
  actual_started_at: number | null;
  actual_ended_at: number | null;
  runs?: WorkRun[];
  event_counts: { CRITICAL: number; HIGH: number } | null;
  zone_id: string | null;
  place: string | null;
  lead: string | null;
  layout_id: number | null;
  work_type: string | null;
  planned_people: number;
}

/** 합성 지난 이력 한 건(작업 항목 JSON + 보고서). 서명은 보고서 id 로 `signaturesByReport` 에 든다. */
interface PastEntry {
  item: WorkItemJson;
  report: MockReport;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const dateTimeMs = (date: string, { hour, minute }: { hour: number; minute: number }) => {
  const d = parseDateKey(date) ?? new Date(0);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const hashOf = (text: string) => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

/** 사건 수: 위험 + 경고(서버 작업 항목의 `event_counts` 와 같은 기준). 모르면 0. */
const eventCountOf = (counts: { CRITICAL?: number; HIGH?: number } | null | undefined) =>
  (counts?.CRITICAL ?? 0) + (counts?.HIGH ?? 0);

/** 종료 미팅 문장(`review.ending`): '작업 종료 · 총 작업 시간 HH:MM:SS, 사건 N건'. */
export function endingMeetingText(totalMs: number, eventCount: number): string {
  return `작업 종료 · 총 작업 시간 ${formatDuration(totalMs)}, 사건 ${eventCount}건`;
}

/** 이름에서 모양이 정해지는 가짜 손서명(SVG 데이터 주소). 지난 이력의 서명 이미지다. */
function fakeSignatureImage(name: string): string {
  let seed = hashOf(name) + 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const points = Array.from(
    { length: 7 },
    (_, i) => `${14 + i * 32},${14 + Math.round(rnd() * 52)}`,
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80">` +
    `<rect width="240" height="80" fill="#fff"/>` +
    `<polyline points="${points.join(' ')}" fill="none" stroke="#0b2140" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 작업내용이 같은지(코드·글이 같은 순서로 같다). */
const sameTasks = (a: readonly ReportTask[], b: readonly ReportTask[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** 구역으로 초안을 만든다. 사람이 이미 쓴 칸은 지키고 빈 칸만 채운다(프로토타입 draftReport). */
export function draftReportForm(form: ReportForm, zones: readonly DraftZone[]): ReportForm {
  const next = clone(form);
  const sorted = [...zones].sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  if (next.info.task_name === '') next.info.task_name = taskNameOf(next.info.tasks, WORK_TASKS);
  if (next.info.place === '')
    next.info.place = sorted.length > 0 ? sorted.map((z) => z.name).join(', ') : '현장 전체';
  next.info.risk_assessed ??= true;

  const rows = sorted
    .slice(0, REPORT_RISK_ROWS)
    .map(
      (zone) => RISK_BY_KIND[zone.kind] ?? { risk: `${zone.name} 부근 위험`, measure: '접근 통제' },
    );
  next.risks.forEach((row, i) => {
    const draft = rows[i];
    if (!draft) return;
    if (row.risk === '') row.risk = draft.risk;
    if (row.measure === '') row.measure = draft.measure;
  });
  const [first] = rows;
  if (first) {
    if (next.focus.risk === '') next.focus.risk = first.risk;
    if (next.focus.measure === '') next.focus.measure = first.measure;
  }

  const hasOpening = zones.some((z) => z.kind === 'OPENING');
  for (const row of next.checks) {
    if (row.yes !== null) continue;
    if (row.code === 'OPENING_GUARD' && hasOpening) {
      row.yes = false;
      row.action = OPENING_CHECK_ACTION;
    } else {
      row.yes = true;
    }
  }
  if (next.review.daily === '')
    next.review.daily = `작업 전 위험구역 ${zones.length}곳 확인, 접근 통제 실시`;
  return next;
}

/**
 * 저장하려는 양식을 서버 TbmForm.normalize 처럼 검사하고 다시 만든다: 위험 3줄·점검 5줄(코드·순서 고정, 문구는 서버 값),
 * 작업내용은 알려진 코드 또는 1~100자 글(중복 없음, 최대 20개), 글자 수 한도. 틀리면 null(400 INVALID_REPORT_FORM).
 */
export function normalizeReportForm(raw: unknown): ReportForm | null {
  const parsed = reportFormSchema.safeParse(raw);
  if (!parsed.success) return null;
  const form = clone(parsed.data);
  const { info, risks, focus, checks, review } = form;
  if (risks.length !== REPORT_RISK_ROWS || checks.length !== REPORT_CHECKS.length) return null;
  if (checks.some((row, i) => row.code !== REPORT_CHECKS[i]?.code)) return null;

  const { short, place, text, review: reviewMax } = REPORT_FORM_LIMITS;
  const limits: [string, number][] = [
    [info.task_name, short],
    [info.place, place],
    ...[...risks, focus].flatMap((row): [string, number][] => [
      [row.risk, text],
      [row.measure, text],
    ]),
    ...checks.map((row): [string, number] => [row.action, text]),
    [review.daily, reviewMax],
    [review.ending, reviewMax],
  ];
  if (limits.some(([value, max]) => [...value].length > max)) return null;

  if (info.tasks.length > REPORT_FORM_LIMITS.tasks) return null;
  const seen = new Set<string>();
  const tasks: ReportTask[] = [];
  for (const task of info.tasks) {
    if ('code' in task) {
      if (!WORK_TASKS.some((item) => item.code === task.code) || seen.has(`code:${task.code}`))
        return null;
      seen.add(`code:${task.code}`);
      tasks.push({ code: task.code });
    } else {
      const value = task.text.trim();
      if (value === '' || [...value].length > short || seen.has(`text:${value}`)) return null;
      seen.add(`text:${value}`);
      tasks.push({ text: value });
    }
  }
  info.tasks = tasks;

  const trim = <T extends Record<string, unknown>>(row: T): T => {
    const out: Record<string, unknown> = { ...row };
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string') out[key] = value.trim();
    }
    return out as T;
  };
  return {
    info: { ...trim(info), tasks },
    risks: risks.map(trim),
    focus: trim(focus),
    checks: checks.map((row, i) => ({ ...trim(row), label: REPORT_CHECKS[i]?.label ?? row.label })),
    review: trim(review),
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const validDateKey = (value: string | null): value is string =>
  value !== null && parseDateKey(value) !== null;

export function createWorkMock(options: WorkMockOptions = {}) {
  const now = options.now ?? Date.now;
  const draftDelayMs = options.draftDelayMs ?? DEFAULT_DRAFT_DELAY_MS;
  const draftZones = options.draftZones ?? DEFAULT_DRAFT_ZONES;
  const todayKey = () => toDateKey(new Date(now()));

  const works: MockWork[] = [];
  /** 보고서(report_id)별 서명. 날짜 작업의 보고서는 처음 쓸 때 빈 목록이 생기고, 지난 이력은 만들 때 채운다. */
  const signaturesByReport = new Map<number, MockSignature[]>();
  let nextWorkId = FIRST_WORK_ID;
  let nextReportId = FIRST_REPORT_ID;
  let nextSignatureId = FIRST_SIGNATURE_ID;

  /** 그 보고서의 서명 목록(고치는 쪽이 이 배열을 바꾼다). */
  const signaturesOf = (reportId: number): MockSignature[] => {
    let list = signaturesByReport.get(reportId);
    if (!list) {
      list = [];
      signaturesByReport.set(reportId, list);
    }
    return list;
  };
  /** 그 보고서의 참석자 서명(작업 시작·인원 상한·삭제가 세는 서명. 결재자 서명은 뺀다). */
  const participantsOf = (reportId: number) =>
    signaturesOf(reportId).filter((s) => s.signer_role === 'PARTICIPANT');
  const sessionsOf = (work: MockWork) =>
    [...(options.setupSessions?.() ?? [])].filter((s) => String(s.work_unit_id) === work.work_id);

  // ── 상태 계산 ──────────────────────────────────────────────────────────────

  /** 세팅이 끝난 세션: 세팅 완료(C17, -615)를 받았다(서버의 work_unit.setup_completed_at 과 같음). 굽기 COMPLETED 만으로는 아니다. */
  const isSetupFinished = (s: MockSetupSession) => s.setup_completed_at_ms != null;

  /** 세팅 세션이 끝난 것을 알아채 세팅 끝 시각을 찍는다. */
  function syncSetup(work: MockWork) {
    if (work.setupDoneAt !== null) return;
    if (sessionsOf(work).some(isSetupFinished)) work.setupDoneAt = now();
  }

  /**
   * 세팅 완료 시각(완료 커밋 뒤 서버가 초안을 시작, -615) 또는 화면의 초안 요청 시각(-624)으로 초안 상태를 앞으로 보낸다:
   * PENDING → GENERATING → SUCCEEDED(빈 칸 채움)·FAILED.
   */
  function syncDraft(work: MockWork) {
    const { report } = work;
    const startedAt = work.draftRequestedAt ?? work.setupDoneAt;
    if (startedAt === null || report.locked_at !== null) return;
    if (report.status === 'PENDING') {
      report.status = 'GENERATING';
      report.draft_status = 'GENERATING';
    }
    if (report.status !== 'GENERATING' || now() - startedAt < draftDelayMs) return;
    report.completed_at_ms = now();
    if (work.draftFails) {
      report.status = 'FAILED';
      report.draft_status = 'FAILED';
      report.failure_reason = 'LLM_UNAVAILABLE';
      return;
    }
    report.form = draftReportForm(report.form, draftZones);
    report.form_revision += 1;
    report.status = 'SUCCEEDED';
    report.draft_status = 'SUCCEEDED';
  }

  /**
   * 종료 미팅 채우기(서버 B10): 종료한 뒤 draftDelayMs 가 지나면 `review.ending` 이 비어 있을 때만 종료 문장으로 채우고(form_revision+1)
   * wrap_up_status 를 SUCCEEDED 로 끝낸다. 채우는 동안은 제출을 받지 않으므로(409 REPORT_NOT_READY) 그 사이 보고서가 잠기지 않는다.
   */
  function syncEnding(work: MockWork) {
    const { report, actual_started_at: startedAt, actual_ended_at: endedAt } = work;
    if (report.wrap_up_status !== 'GENERATING' || endedAt === null) return;
    if (now() - endedAt < draftDelayMs) return;
    if (report.form.review.ending === '') {
      const total = endedAt - (startedAt ?? endedAt);
      report.form.review.ending = endingMeetingText(total, eventCountOf(work.event_counts));
      report.form_revision += 1;
    }
    report.wrap_up_status = 'SUCCEEDED';
  }

  const sync = (work: MockWork) => {
    syncSetup(work);
    syncDraft(work);
    syncEnding(work);
  };

  function progressOf(work: MockWork): DayProgress {
    if (work.report.submitted_at !== null) return 'SUBMITTED';
    if (work.status === 'DONE') return 'ENDED';
    if (work.status === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (work.setupDoneAt !== null) return 'SETUP_DONE';
    return sessionsOf(work).length > 0 ? 'SETUP' : 'REPORT';
  }

  /** 끝나지 않은 가장 최근 세팅 세션(없으면 null). 세팅이 끝났거나 작업을 시작했으면 없다. */
  function activeSessionId(work: MockWork): string | null {
    if (work.setupDoneAt !== null || work.status !== 'PLANNED') return null;
    const open = sessionsOf(work).filter((s) => !isSetupFinished(s));
    open.sort((a, b) => (a.started_at_ms ?? 0) - (b.started_at_ms ?? 0));
    return open.at(-1)?.setup_session_id ?? null;
  }

  // ── 응답 모양 ──────────────────────────────────────────────────────────────

  function viewWork(work: MockWork): WorkItemJson {
    sync(work);
    const { report } = work;
    return {
      work_id: work.work_id,
      date: work.date,
      name: work.name,
      daily: true,
      progress: progressOf(work),
      tbm_report: {
        report_id: report.report_id,
        draft_status: report.draft_status,
        submitted_at: report.submitted_at,
      },
      status: work.status,
      from_ms: work.from_ms,
      to_ms: work.to_ms,
      active_setup_session_id: activeSessionId(work),
      actual_started_at: work.actual_started_at,
      actual_ended_at: work.actual_ended_at,
      runs: work.runs.map((run) => ({ ...run })),
      event_counts: { ...work.event_counts },
      zone_id: null,
      place: report.form.info.place || null,
      lead: null,
      layout_id: null,
      work_type: null,
      planned_people: 0,
    };
  }

  function viewReport(work: MockWork, report: MockReport) {
    sync(work);
    return {
      ...report,
      header: { date: work.date, name: work.name, from_ms: work.from_ms, to_ms: work.to_ms },
      signature_count: signaturesOf(report.report_id).length,
    };
  }

  /** GET /api/reports/tbm 의 `versions` 한 줄. */
  const versionOf = (r: MockReport) => ({
    report_id: r.report_id,
    report_version: r.report_version,
    status: r.status,
    wrap_up_status: r.wrap_up_status,
    created_at_ms: r.created_at_ms,
  });

  // ── 합성 지난 이력(mocks/history 의 최근 작업들을 새 흐름 모양으로) ──────────

  let pastCache: { key: string; entries: PastEntry[] } | null = null;

  /**
   * 오늘 이전 날의 예전 방식 작업(daily: false). 가장 최근 날의 마지막 작업만 제출하지 않았고(ENDED) 나머지는 제출했다(SUBMITTED).
   * 보고서는 작업 이름을 작업내용으로 한 읽기 전용 양식이다(서명 2~4명, 이미지는 데이터 주소).
   */
  function pastEntries(): PastEntry[] {
    const today = todayKey();
    if (pastCache?.key === today) return pastCache.entries;
    const past = historyWorks(now())
      .filter((w) => w.date < today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.from_ms - b.from_ms);
    const yesterday = toDateKey(new Date(now() - DAY_MS));
    const lastOfDay = new Map(past.map((w) => [w.date, w.work_id] as const));
    const entries = past.map((w, index): PastEntry => {
      const progress: DayProgress =
        w.date === yesterday && lastOfDay.get(w.date) === w.work_id ? 'ENDED' : 'SUBMITTED';
      const submittedAt =
        progress === 'SUBMITTED' ? (w.actual_ended_at ?? w.to_ms) + 20 * 60_000 : null;
      const total = (w.actual_ended_at ?? w.to_ms) - (w.actual_started_at ?? w.from_ms);

      const blank = blankReportForm(w.from_ms);
      blank.info.tasks = [{ text: w.name }];
      const form = draftReportForm(blank, draftZones);
      form.review.ending = endingMeetingText(total, eventCountOf(w.event_counts));

      const reportId = FIRST_PAST_REPORT_ID + index;
      const names = ['박반장', '김안전', '이현장', '정작업'].slice(0, 2 + (hashOf(w.date) % 3));
      const signatures = names.map((name, i): MockSignature => ({
        signature_id: String(reportId * 10 + i),
        signer_name: name,
        signer_role: 'PARTICIPANT',
        signed_at: (w.actual_started_at ?? w.from_ms) - (names.length - i) * 60_000,
        report_version: 1,
        image_url: fakeSignatureImage(name),
      }));
      const report: MockReport = {
        report_id: reportId,
        work_id: w.work_id,
        report_version: 1,
        status: 'SUCCEEDED',
        draft_status: 'SUCCEEDED',
        failure_reason: null,
        form,
        form_revision: 1,
        leader: MOCK_LEADER,
        header: { date: w.date, name: w.name, from_ms: w.from_ms, to_ms: w.to_ms },
        locked_at: submittedAt,
        submitted_at: submittedAt,
        submitted_by_name: submittedAt === null ? null : MOCK_LEADER.name,
        signature_count: signatures.length,
        content_sha256: null,
        wrap_up_summary: null,
        wrap_up_status: 'SUCCEEDED',
        created_at_ms: w.from_ms,
        completed_at_ms: w.actual_ended_at ?? w.to_ms,
      };
      signaturesByReport.set(reportId, signatures);
      return {
        item: {
          work_id: w.work_id,
          date: w.date,
          name: w.name,
          daily: false,
          progress,
          tbm_report: { report_id: reportId, draft_status: 'SUCCEEDED', submitted_at: submittedAt },
          status: w.status,
          from_ms: w.from_ms,
          to_ms: w.to_ms,
          active_setup_session_id: null,
          actual_started_at: w.actual_started_at,
          actual_ended_at: w.actual_ended_at,
          event_counts: w.event_counts,
          zone_id: w.zone_id,
          place: w.place,
          lead: null,
          layout_id: null,
          work_type: null,
          planned_people: w.planned_people,
        },
        report,
      };
    });
    pastCache = { key: today, entries };
    return entries;
  }

  // ── 찾기 ───────────────────────────────────────────────────────────────────

  const dailyOf = (workId: string) => works.find((w) => w.work_id === workId);
  const pastOfWork = (workId: string) => pastEntries().find((e) => e.item.work_id === workId);

  type Found =
    { kind: 'daily'; work: MockWork; report: MockReport } | { kind: 'past'; report: MockReport };

  /** 보고서 id 로 이 mock 의 보고서를 찾는다(날짜 작업의 보고서 + 지난 이력). 모르면 undefined. */
  function findReport(reportId: number): Found | undefined {
    const work = works.find((w) => w.report.report_id === reportId);
    if (work) return { kind: 'daily', work, report: work.report };
    const entry = pastEntries().find((e) => e.report.report_id === reportId);
    return entry && { kind: 'past', report: entry.report };
  }

  const viewFound = (found: Found) =>
    found.kind === 'daily' ? viewReport(found.work, found.report) : found.report;

  // ── 요청 검사 ──────────────────────────────────────────────────────────────

  /** 로그인하지 않았으면 401, 쓰기인데 관리자가 아니면 403 응답. 통과하면 계정. */
  function guard(request: Request, write: boolean) {
    const user = readLiveUser(request, now());
    if (!user) return unauthorized();
    if (write && user.role !== 'ADMIN') return problem(403, 'FORBIDDEN', '권한이 없습니다');
    return user;
  }

  const bodyOf = (request: Request) => request.json().catch(() => null) as Promise<unknown>;

  /** 서명 이미지 주소(tbm mock 의 /mock-signature-image/:key 를 쓴다). */
  const imageUrlOf = (request: Request, imageKey: string) =>
    new URL(
      `/mock-signature-image/${imageKey
        .split('/')
        .at(-1)
        ?.replace(/\.png$/, '')}`,
      request.url,
    ).toString();

  // ── 핸들러 ─────────────────────────────────────────────────────────────────

  const handlers = [
    // 날짜 열기: 하루 작업과 빈 보고서를 만들거나 가져온다(멱등). 오늘 이전은 이미 있는 날만 돌려주고 새로 만들지 않는다.
    http.put('*/api/work-units/daily/:date', ({ request, params }) => {
      const user = guard(request, true);
      if (user instanceof Response) return user;
      const date = String(params.date ?? '');
      if (!validDateKey(date))
        return problem(400, 'INVALID_WORK_UNIT', '날짜는 YYYY-MM-DD 형식이어야 합니다');
      const existing = works.find((w) => w.date === date);
      if (existing) return HttpResponse.json(viewWork(existing));
      const kind = dayKind(date, todayKey());
      if (kind === 'past')
        return problem(
          409,
          WORK_ERROR.DATE_PAST,
          '오늘 이전 날짜에는 작업을 새로 만들 수 없습니다',
        );

      const t = now();
      const entryMs = kind === 'today' ? t : dateTimeMs(date, PLANNED_START);
      const workId = String(nextWorkId++);
      const work: MockWork = {
        work_id: workId,
        date,
        name: '',
        from_ms: dateTimeMs(date, PLANNED_START),
        to_ms: dateTimeMs(date, PLANNED_END),
        status: 'PLANNED',
        actual_started_at: null,
        actual_ended_at: null,
        runs: [],
        event_counts: { CRITICAL: 0, HIGH: 0 },
        setupDoneAt: null,
        draftFails: false,
        draftRequestedAt: null,
        report: {
          report_id: nextReportId++,
          work_id: workId,
          report_version: 1,
          status: 'PENDING',
          draft_status: null,
          failure_reason: null,
          form: blankReportForm(entryMs),
          form_revision: 0,
          leader: MOCK_LEADER,
          header: null,
          locked_at: null,
          submitted_at: null,
          submitted_by_name: null,
          signature_count: 0,
          content_sha256: null,
          wrap_up_summary: null,
          wrap_up_status: null,
          created_at_ms: t,
          completed_at_ms: null,
        },
      };
      works.push(work);
      return HttpResponse.json(viewWork(work), { status: 201 });
    }),

    // 달력 월 목록: 날짜 범위의 날짜 작업과 합성 지난 이력. from·to 가 없는 옛 요청(`?days=` 등)은 다음 핸들러로 넘긴다.
    // 옛 핸들러(mocks/tbm·history)를 고치지 않으려고 이 핸들러를 먼저 등록하고 여기서 넘기는 쪽을 골랐다.
    http.get('*/api/work-units', ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (from === null && to === null) return undefined;
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      if (!validDateKey(from) || !validDateKey(to) || from > to)
        return problem(
          400,
          'INVALID_WORK_UNIT_RANGE',
          'from·to 는 YYYY-MM-DD 형식이고 from ≤ to 여야 합니다',
        );
      const days = (parseDateKey(to)!.getTime() - parseDateKey(from)!.getTime()) / DAY_MS + 1;
      if (days > MAX_RANGE_DAYS)
        return problem(
          400,
          'INVALID_WORK_UNIT_RANGE',
          `한 번에 ${MAX_RANGE_DAYS}일까지만 받을 수 있습니다`,
        );
      const inRange = (date: string) => date >= from && date <= to;
      const daily = works.filter((w) => inRange(w.date)).map(viewWork);
      const past = pastEntries()
        .filter((e) => inRange(e.item.date))
        .map((e) => e.item);
      const list = [...daily, ...past].sort(
        (a, b) => a.date.localeCompare(b.date) || a.from_ms - b.from_ms,
      );
      return HttpResponse.json({ works: list });
    }),

    http.get('*/api/work-units/:id', ({ request, params }) => {
      const id = String(params.id ?? '');
      const work = dailyOf(id);
      const past = work ? undefined : pastOfWork(id);
      if (!work && !past) return undefined;
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      return HttpResponse.json(work ? viewWork(work) : past!.item);
    }),

    // 작업 시작(서버 startSession 의 검사 순서): 예정(PLANNED)·끝난(DONE, 한 번 더 실행 -696) 상태 → 끝났으면 보고서 미제출
    // → 오늘 날짜 → 이 작업의 세팅 완료(-642) → 참석자 서명 1명 이상 → 진행 중인 다른 작업 없음. 시작은 새 실행이다.
    http.post('*/api/work-units/:id/start', ({ request, params }) => {
      const work = dailyOf(String(params.id ?? ''));
      if (!work) return undefined;
      const user = guard(request, true);
      if (user instanceof Response) return user;
      if (work.status !== 'PLANNED' && work.status !== 'DONE')
        return problem(409, WORK_ERROR.INVALID_STATE, '이미 진행 중인 작업입니다');
      if (work.status === 'DONE' && work.report.submitted_at !== null)
        return problem(409, WORK_ERROR.REPORT_SUBMITTED, '보고서를 제출한 작업입니다');
      if (work.date !== todayKey())
        return problem(409, WORK_ERROR.NOT_TODAY, '작업 날짜에 시작할 수 있어요');
      syncSetup(work);
      if (work.setupDoneAt === null)
        return problem(
          409,
          WORK_ERROR.SETUP_NOT_COMPLETED,
          '현장 세팅을 완료해야 작업을 시작할 수 있습니다',
        );
      if (participantsOf(work.report.report_id).length < 1)
        return problem(409, WORK_ERROR.NO_SIGNATURE, '서명이 한 명 이상 필요합니다');
      const active = works.find((w) => w.status === 'IN_PROGRESS');
      if (active) return problem(409, WORK_ERROR.ALREADY_IN_PROGRESS, active.name);
      const at = now();
      work.status = 'IN_PROGRESS';
      work.actual_started_at ??= at;
      work.actual_ended_at = null;
      work.runs.push({ run_no: work.runs.length + 1, started_at: at, ended_at: null });
      return HttpResponse.json(viewWork(work));
    }),

    // 작업 종료: 새 보고서 판 없이 같은 보고서의 wrap_up_status 를 GENERATING 으로 바꾼다. draftDelayMs 뒤(syncEnding)에
    // review.ending 이 비어 있으면 종료 문장으로 채우고 SUCCEEDED 가 된다(서버 B10 의 날짜 작업 종료 미팅).
    http.post('*/api/work-units/:id/end', ({ request, params }) => {
      const work = dailyOf(String(params.id ?? ''));
      if (!work) return undefined;
      const user = guard(request, true);
      if (user instanceof Response) return user;
      if (work.status !== 'IN_PROGRESS')
        return problem(409, WORK_ERROR.INVALID_STATE, '진행 중인 작업만 끝낼 수 있습니다');
      sync(work);
      work.status = 'DONE';
      work.actual_ended_at = now();
      const open = work.runs.find((run) => run.ended_at === null);
      if (open) open.ended_at = work.actual_ended_at;
      work.report.wrap_up_status = 'GENERATING';
      return HttpResponse.json(
        {
          work_unit: viewWork(work),
          wrap_up: {
            status: 'GENERATING',
            report_id: work.report.report_id,
            reason: null,
            mode: 'FORM_ENDING',
          },
        },
        { status: 202 },
      );
    }),

    http.get('*/api/work-tasks', ({ request }) => {
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      return HttpResponse.json(WORK_TASKS);
    }),

    // 작업의 보고서 최신 판과 판 목록.
    http.get('*/api/reports/tbm', ({ request }) => {
      const workId = new URL(request.url).searchParams.get('work_id');
      const work = workId === null ? undefined : dailyOf(workId);
      const past = workId === null || work ? undefined : pastOfWork(workId);
      if (!work && !past) return undefined;
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      const report = work ? viewReport(work, work.report) : past!.report;
      return HttpResponse.json({ latest: report, versions: [versionOf(report)] });
    }),

    http.get('*/api/reports/tbm/:reportId', ({ request, params }) => {
      const found = findReport(Number(params.reportId));
      if (!found) return undefined;
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      return HttpResponse.json(viewFound(found));
    }),

    // 양식 통째 저장. 새 판은 만들지 않고 form_revision 만 올린다.
    http.put('*/api/reports/tbm/:reportId/form', async ({ request, params }) => {
      const user = guard(request, true);
      if (user instanceof Response) return user;
      const found = findReport(Number(params.reportId));
      if (!found) return problem(404, 'REPORT_NOT_FOUND', '보고서를 찾을 수 없습니다');
      const body = await bodyOf(request);
      const revision =
        typeof body === 'object' && body !== null ? Reflect.get(body, 'form_revision') : undefined;
      const form = normalizeReportForm(
        typeof body === 'object' && body !== null ? Reflect.get(body, 'form') : undefined,
      );
      if (!form || typeof revision !== 'number' || !Number.isInteger(revision))
        return problem(400, 'INVALID_REPORT_FORM', '보고서 양식 칸이 올바르지 않습니다');
      if (found.kind === 'past') return problem(409, WORK_ERROR.REPORT_LOCKED, '잠긴 보고서입니다');
      const { work, report } = found;
      if (report.locked_at !== null)
        return problem(409, WORK_ERROR.REPORT_LOCKED, '제출해 잠긴 보고서입니다');
      sync(work);
      if (revision !== report.form_revision)
        return problem(409, WORK_ERROR.REPORT_FORM_CONFLICT, '다른 곳에서 먼저 고친 보고서입니다');
      if (!sameTasks(report.form.info.tasks, form.info.tasks)) {
        form.info.task_name = taskNameOf(form.info.tasks, WORK_TASKS);
        work.name = form.info.task_name;
      }
      report.form = form;
      report.form_revision += 1;
      return HttpResponse.json(viewReport(work, report));
    }),

    // AI 양식 초안 요청(서버 TbmFormAiService.startDraft, -616·-624): 생성 중이면 409 REPORT_IN_PROGRESS,
    // 작업내용이 없으면 409 REPORT_FORM_NO_TASKS, 잠겼으면 409 REPORT_LOCKED. 받으면 GENERATING 이고 draftDelayMs 뒤 끝난다
    http.post('*/api/reports/tbm/:reportId/form-draft', ({ request, params }) => {
      const user = guard(request, true);
      if (user instanceof Response) return user;
      const found = findReport(Number(params.reportId));
      if (!found) return problem(404, 'REPORT_NOT_FOUND', '보고서를 찾을 수 없습니다');
      if (found.kind === 'past') return problem(409, WORK_ERROR.REPORT_LOCKED, '잠긴 보고서입니다');
      const { work, report } = found;
      sync(work);
      if (report.locked_at !== null)
        return problem(409, WORK_ERROR.REPORT_LOCKED, '제출해 잠긴 보고서입니다');
      if (report.status === 'GENERATING')
        return problem(409, WORK_ERROR.REPORT_IN_PROGRESS, '이 작업의 보고서를 이미 생성 중입니다');
      if (report.form.info.tasks.length === 0)
        return problem(
          409,
          WORK_ERROR.REPORT_FORM_NO_TASKS,
          '작업내용을 하나 이상 고른 뒤 AI 초안을 요청하세요',
        );
      work.draftRequestedAt = now();
      report.status = 'GENERATING';
      report.draft_status = 'GENERATING';
      return HttpResponse.json({
        report_id: report.report_id,
        work_id: work.work_id,
        report_version: report.report_version,
        draft_status: 'GENERATING',
        form_revision: report.form_revision,
      });
    }),

    // 제출·잠금(서버 TbmReportRepository.submit 의 검사 순서): 이미 제출 → 작업이 끝남(DONE) → 초안·종료 미팅을 쓰는 중이 아님.
    // 제출 뒤 양식 수정·서명은 409 REPORT_LOCKED. 응답은 보고서 전체다.
    http.post('*/api/reports/tbm/:reportId/submit', async ({ request, params }) => {
      const user = guard(request, true);
      if (user instanceof Response) return user;
      const found = findReport(Number(params.reportId));
      if (!found) return problem(404, 'REPORT_NOT_FOUND', '보고서를 찾을 수 없습니다');
      if (found.kind === 'past') return problem(409, WORK_ERROR.REPORT_LOCKED, '잠긴 보고서입니다');
      const { work, report } = found;
      if (report.locked_at !== null)
        return problem(409, WORK_ERROR.REPORT_LOCKED, '이미 제출한 보고서입니다');
      if (work.status !== 'DONE')
        return problem(409, WORK_ERROR.INVALID_STATE, '작업이 끝난 뒤에 제출할 수 있습니다');
      sync(work);
      if (isReportGenerating(report))
        return problem(409, WORK_ERROR.REPORT_NOT_READY, '초안이나 종료 미팅을 쓰는 중입니다');
      const t = now();
      report.submitted_at = t;
      report.locked_at = t;
      report.submitted_by_name = user.id;
      report.content_sha256 = await sha256Hex(
        JSON.stringify({
          form: report.form,
          signatures: signaturesOf(report.report_id).map((s) => [
            s.signer_name,
            s.signed_at,
            s.report_version,
          ]),
        }),
      );
      return HttpResponse.json(viewReport(work, report));
    }),

    // 서명: 보고서가 있고 제출 전이면 된다(PENDING 도 허용, 첫 서명이 잠그지 않는다). 올리기는 tbm mock 의 uploads/sign 을 쓴다.
    // 서버와 달리 올린 이미지 허가(upload_grant)는 보지 않고, 결재자(APPROVER) 서명이 보고서를 결재 잠금(REPORT_APPROVED)하는 것도 흉내 내지 않는다.
    http.get('*/api/reports/tbm/:reportId/signatures', ({ request, params }) => {
      const found = findReport(Number(params.reportId));
      if (!found) return undefined;
      const denied = guard(request, false);
      if (denied instanceof Response) return denied;
      // 서버처럼 version 을 주면 그 판의 서명만(보고서는 한 판뿐이라 다른 판 번호면 비어 있다).
      const version = new URL(request.url).searchParams.get('version');
      const sameVersion = version === null || Number(version) === found.report.report_version;
      return HttpResponse.json({ items: sameVersion ? signaturesOf(found.report.report_id) : [] });
    }),

    http.post('*/api/reports/tbm/:reportId/signatures', async ({ request, params }) => {
      const found = findReport(Number(params.reportId));
      if (!found) return undefined;
      const user = guard(request, true);
      if (user instanceof Response) return user;
      const body = await bodyOf(request);
      const field = (key: string): unknown =>
        typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
      const name = field('signer_name');
      const imageKey = field('image_key');
      const sha = field('image_sha256');
      const version = field('report_version');
      const role = field('signer_role') ?? 'PARTICIPANT';
      if (
        typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version < 1 ||
        typeof name !== 'string' ||
        name.trim() === '' ||
        [...name.trim()].length > SIGNER_NAME_MAX ||
        !isSignerRole(role) ||
        typeof imageKey !== 'string' ||
        typeof sha !== 'string' ||
        !/^(?:sha256:)?[0-9a-f]{64}$/.test(sha)
      )
        return problem(400, WORK_ERROR.INVALID_SIGNATURE, '서명 요청이 올바르지 않습니다');
      if (found.kind === 'past') return problem(409, WORK_ERROR.REPORT_LOCKED, '잠긴 보고서입니다');
      const { work, report } = found;
      if (report.locked_at !== null)
        return problem(409, WORK_ERROR.REPORT_LOCKED, '제출해 잠긴 보고서입니다');
      if (version !== report.report_version)
        return problem(409, WORK_ERROR.REPORT_VERSION_STALE, '새 보고서 버전이 있습니다');
      if (role === 'PARTICIPANT' && participantsOf(report.report_id).length >= SIGNATURE_MAX_COUNT)
        return problem(
          409,
          WORK_ERROR.SIGNATURE_LIMIT_REACHED,
          '서명 인원 상한(50명)에 도달했습니다',
        );
      sync(work);
      const entry: MockSignature = {
        signature_id: String(nextSignatureId++),
        signer_name: name.trim(),
        signer_role: role,
        signed_at: now(),
        report_version: report.report_version,
        image_url: imageUrlOf(request, imageKey),
      };
      signaturesOf(report.report_id).push(entry);
      return HttpResponse.json(
        {
          signature_id: entry.signature_id,
          report_id: report.report_id,
          report_version: report.report_version,
          signer_name: entry.signer_name,
          signer_role: entry.signer_role,
          signed_at: entry.signed_at,
          locked_at: null,
          content_sha256: await sha256Hex(JSON.stringify(report.form)),
        },
        { status: 201 },
      );
    }),

    // 서명 삭제(서버 검사 순서): 제출함 → 작업 시작 전(PLANNED)이어야 함 → 그 서명이 있어야 함(404 SIGNATURE_NOT_FOUND).
    http.delete('*/api/reports/tbm/:reportId/signatures/:signatureId', ({ request, params }) => {
      const found = findReport(Number(params.reportId));
      if (!found) return undefined;
      const user = guard(request, true);
      if (user instanceof Response) return user;
      if (found.kind === 'past') return problem(409, WORK_ERROR.REPORT_LOCKED, '잠긴 보고서입니다');
      const { work, report } = found;
      if (report.locked_at !== null)
        return problem(409, WORK_ERROR.REPORT_LOCKED, '제출해 잠긴 보고서입니다');
      if (work.status !== 'PLANNED')
        return problem(
          409,
          WORK_ERROR.INVALID_STATE,
          '작업을 시작한 뒤에는 서명을 지울 수 없습니다',
        );
      // 참석자 서명만 지운다(서버처럼 결재자 서명은 없는 것으로 본다).
      const signatures = signaturesOf(report.report_id);
      const index = signatures.findIndex(
        (s) => s.signature_id === String(params.signatureId) && s.signer_role === 'PARTICIPANT',
      );
      if (index < 0) return problem(404, WORK_ERROR.SIGNATURE_NOT_FOUND, '서명을 찾을 수 없습니다');
      signatures.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  // ── 시험·개발 도우미(서버 API 가 아니다) ───────────────────────────────────

  /** 그 작업(생략하면 오늘의 날짜 작업)의 세팅이 끝났다고 표시한다(진행이 SETUP_DONE 이 되고 초안 생성이 시작된다). */
  function markSetupDone(workId?: string): string | null {
    const work = workId === undefined ? works.find((w) => w.date === todayKey()) : dailyOf(workId);
    if (!work) return null;
    work.setupDoneAt ??= now();
    return work.work_id;
  }

  return {
    handlers,
    markSetupDone,
    /** 날짜 작업 전부를 서버 목록(GET /api/work-units)의 한 건 모양으로, 진행 값(progress)과 함께. */
    workItems: () => works.map(viewWork),
    /** 그 작업의 초안이 FAILED 로 끝나게 한다(초안 실패 화면 시험용). */
    failDraft(workId: string) {
      const work = dailyOf(workId);
      if (work) work.draftFails = true;
    },
    /** 그 작업 구간의 사건 수를 정한다(종료 문장의 '사건 N건'). */
    setEventCounts(workId: string, counts: { CRITICAL?: number; HIGH?: number }) {
      const work = dailyOf(workId);
      if (work) work.event_counts = { CRITICAL: counts.CRITICAL ?? 0, HIGH: counts.HIGH ?? 0 };
    },
  };
}

export type WorkMock = ReturnType<typeof createWorkMock>;

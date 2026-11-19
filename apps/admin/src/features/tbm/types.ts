import type { Severity } from '@/features/events/types';
import { fromMin } from '@/features/tbm/tbm';
import { TBM_ZONES, type LayoutItem, type TaskEval, type TbmTask } from '@/features/tbm/tbmDemo';
import { workPlaceLabel } from '@/features/tbm/workPlace';
import { dayProgressSchema } from '@/features/work/types';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { ruleName } from '@/lib/ruleNames';
import { workRunsField } from '@/lib/workRuns';
import { z } from 'zod';

// TBM 작업(work_unit)·공종(work_type)·가상 레이아웃(layout_plan)·TBM 보고서(report) 스키마와 변환.
// 인터페이스 정본: .agy/tbm-interface.md B·C절, 설계 .agy/ref/tbm-legal-graph.md 5.1·5.2·5.4·5.5.

const idString = z.union([z.string().min(1), z.number().int()]).transform(String);
const intOrNumber = z.number();

export const severitySchema = z.enum(['CRITICAL', 'HIGH', 'CAUTION', 'INFO']);

// ── C. 공종 (/api/work-types) ────────────────────────────────────────────────

export const workTypeOptionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  rule_tags: z.array(z.string()).default([]),
});
export type WorkTypeOption = z.infer<typeof workTypeOptionSchema>;

export const workTypesResponseSchema = z.union([
  z.array(workTypeOptionSchema),
  z.object({ work_types: z.array(workTypeOptionSchema) }).transform((v) => v.work_types),
]);

/** 설계 5.4 표의 7개 표준 공종 상수(서버 /api/work-types 응답의 기본값·폴백). */
export const WORK_TYPE_OPTIONS: readonly WorkTypeOption[] = [
  {
    code: 'SCAFFOLD_INSTALL',
    label: '비계 조립·해체 및 고소 작업발판',
    rule_tags: ['R2', 'R3'],
  },
  {
    code: 'OPENING_WORK',
    label: '개구부 주변·단부 작업',
    rule_tags: ['R1', 'R2'],
  },
  {
    code: 'HIGH_PLACE',
    label: '고소 작업(단상·사다리·작업면 상부)',
    rule_tags: ['R2', 'R3', 'R4'],
  },
  {
    code: 'MATERIAL_HANDLING',
    label: '자재 반입·운반·정리',
    rule_tags: ['R1', 'R5'],
  },
  {
    code: 'EQUIPMENT_OP',
    label: '중장비·지게차·양중기 운행',
    rule_tags: ['R1', 'R5'],
  },
  {
    code: 'FLOOR_FINISHING',
    label: '바닥·내장 마감 및 일반 통행',
    rule_tags: ['R1', 'R4'],
  },
  {
    code: 'GENERAL',
    label: '일반 작업(기타)',
    rule_tags: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
  },
];

export const workTypeLabelOf = (
  code: string | null | undefined,
  options: readonly WorkTypeOption[] = WORK_TYPE_OPTIONS,
): string | null => {
  if (!code) return null;
  return options.find((w) => w.code === code)?.label ?? code;
};

// ── C. 작업 (/api/work-units) ────────────────────────────────────────────────

const workTypeCodeField = z
  .union([
    z.string(),
    z.object({ code: z.string(), label: z.string().optional() }).transform((v) => v.code),
  ])
  .nullish()
  .transform((v) => (v && v.trim() !== '' ? v : null));

/** 안전모·조끼 요구 값(계약 data/ppe_policy). 모르는 값이면 모름(undefined)으로 읽는다. */
const ppeRequirementField = z.enum(['REQUIRED', 'NOT_REQUIRED']).optional().catch(undefined);

export const tbmWorkUnitSchema = z.object({
  work_id: idString,
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE']).optional(),
  // 서버가 하루 작업마다 싣는 진행 값(REPORT·SETUP·SETUP_DONE·…). 관제는 세팅이 끝났는지 이것으로 안다.
  // 모르는 값이 와도 작업이 목록에서 빠지지 않게 null(모름)로 읽는다.
  progress: dayProgressSchema.nullish().catch(null),
  actual_started_at: z.union([z.string(), z.number()]).nullish(),
  actual_ended_at: z.union([z.string(), z.number()]).nullish(),
  // 실행 목록(S15P31A101-696). 관제는 진행 중 실행의 시작을 관제 시작으로 본다
  runs: workRunsField,
  active_setup_session_id: z.string().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string(),
  from_ms: intOrNumber,
  to_ms: intOrNumber,
  zone_id: z.string().nullable().default(null),
  place: z.string().nullish().default(null),
  planned_people: z.number().int().nonnegative(),
  lead: z.string().nullish().default(null),
  layout_id: z.number().int().nullish().default(null),
  work_type: workTypeCodeField,
  event_counts: z
    .object({ CRITICAL: z.number().int(), HIGH: z.number().int() })
    .partial()
    .nullish(),
  // 작업 중 안전모·조끼 요구(S15P31A101-654, 기본 REQUIRED). 이전 서버는 칸을 주지 않는다(모름).
  helmet: ppeRequirementField,
  vest: ppeRequirementField,
});
export type TbmWorkUnit = z.infer<typeof tbmWorkUnitSchema>;

export const tbmWorkUnitsResponseSchema = z.object({
  works: z.array(z.unknown()),
});

export interface WorkUnitWriteBody {
  date: string;
  name: string;
  from_ms: number;
  to_ms: number;
  zone_id: string | null;
  place: string | null;
  planned_people: number;
  /** 담당 조 이름. 등록 폼에서 받지 않으면 null. */
  lead: string | null;
  layout_id: number | null;
  work_type: string | null;
}

// ── 가상 레이아웃 (/api/layouts) ─────────────────────────────────────────────

export const layoutObbItemSchema = z.object({
  item_id: z.string().min(1),
  // WORK_SURFACE(고소 작업면)가 새 종류다. SCAFFOLD 는 옛 데이터라 고소 작업면으로 읽고, EQUIPMENT 는 데이터만 두고 구역을 만들지 않는다.
  kind: z.enum(['OPENING', 'WORK_SURFACE', 'SCAFFOLD', 'EQUIPMENT']),
  center: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number(), z.number(), z.number()]),
  yaw_rad: z.number().default(0),
  label: z.string().nullable().default(null),
  // 기존 구역에서 가져온 개구부 표시. 이런 항목은 작업 시작 때 새 구역을 만들지 않는다.
  source_zone_id: z.string().nullish(),
  /** 기존 작업면을 참조하는 항목. 작업 시작 때 새 작업면을 만들지 않는다. */
  source_object_id: z.string().nullish(),
});
export type LayoutObbItem = z.infer<typeof layoutObbItemSchema>;

export const layoutSummarySchema = z.object({
  layout_id: z.number().int(),
  name: z.string(),
  revision: z.number().int(),
  layout_version: z.string().optional(),
  source: z.string().optional(),
  item_count: z.number().int().optional(),
  items: z.array(layoutObbItemSchema).optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
});
export type LayoutSummary = z.infer<typeof layoutSummarySchema>;

export const layoutDetailSchema = layoutSummarySchema.extend({
  items: z.array(layoutObbItemSchema).default([]),
});
export type LayoutDetail = z.infer<typeof layoutDetailSchema>;

export const layoutsListSchema = z.union([
  z.array(layoutSummarySchema),
  z.object({ layouts: z.array(layoutSummarySchema) }).transform((v) => v.layouts),
]);

// ── B. TBM 보고서 (/api/reports/tbm) ─────────────────────────────────────────

export const reportStatusSchema = z
  .enum(['GENERATING', 'SUCCEEDED', 'FAILED', 'REQUESTED', 'DONE'])
  .transform((s): 'GENERATING' | 'SUCCEEDED' | 'FAILED' => {
    if (s === 'REQUESTED') return 'GENERATING';
    if (s === 'DONE') return 'SUCCEEDED';
    return s;
  });
export type TbmReportStatus = z.infer<typeof reportStatusSchema>;

export const reportHeaderSchema = z.object({
  date: z.string(),
  name: z.string(),
  from_ms: z.number(),
  to_ms: z.number(),
  zone_id: z.string().nullable().default(null),
  place: z.string().nullish().default(null),
  planned_people: z.number().int().nonnegative(),
  lead: z.string().nullish().default(null),
});
export type TbmReportHeader = z.infer<typeof reportHeaderSchema>;

export const reportRiskItemSchema = z.object({
  rule_id: z.string().min(1),
  rule_version: z.number().int().optional(),
  severity: severitySchema,
  position_ids: z.array(z.string()).default([]),
  zone_id: z.string().nullable().default(null),
  metrics: z.record(z.string(), z.number()).default({}),
  reason_codes: z.array(z.string()).default([]),
  confidence_reasons: z.array(z.string()).default([]),
  item: z.string().optional(),
  why: z.string().optional(),
});
export type TbmReportRiskItem = z.infer<typeof reportRiskItemSchema>;

export const reportZoneHistorySchema = z.object({
  zone_id: z.string(),
  days: z.number().int().optional(),
  live_event_count: z.number().int().nonnegative(),
  rules: z.array(z.string()).default([]),
  max_severity: severitySchema.nullish().default(null),
  last_at_ms: z.number().nullish().default(null),
});
export type TbmReportZoneHistory = z.infer<typeof reportZoneHistorySchema>;

export const reportSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  body: z.string(),
  citations: z.array(z.string()).default([]),
});
export type TbmReportSection = z.infer<typeof reportSectionSchema>;

export const reportCitationSchema = z.object({
  node_id: z.string().min(1),
  source_name: z.string(),
  article_ref: z.string().nullish().default(null),
  title: z.string(),
  excerpt: z.string().default(''),
});
export type TbmReportCitation = z.infer<typeof reportCitationSchema>;

export const subgraphNodeSchema = z.object({
  node_id: z.string().min(1),
  node_kind: z.string().default('ARTICLE'),
  layer: z.string().default('OSH_STANDARD'),
  source_name: z.string(),
  article_ref: z.string().nullish().default(null),
  title: z.string(),
  rule_tags: z.array(z.string()).default([]),
  hop: z.number().int().default(0),
  cited: z.boolean().default(false),
});
export type SubgraphNode = z.infer<typeof subgraphNodeSchema>;

export const subgraphEdgeSchema = z.object({
  edge_id: z.string().min(1),
  src_node_id: z.string().min(1),
  dst_node_id: z.string().min(1),
  edge_kind: z.string(),
  relation_label: z.string().nullish().default(null),
});
export type SubgraphEdge = z.infer<typeof subgraphEdgeSchema>;

export const subgraphSchema = z.object({
  nodes: z.array(subgraphNodeSchema).default([]),
  edges: z.array(subgraphEdgeSchema).default([]),
});
export type TbmSubgraph = z.infer<typeof subgraphSchema>;

export const reportStepSchema = z.object({
  step: z.string().min(1),
  label: z.string(),
  status: z.string(),
  input_count: z.number().int().nonnegative().default(0),
  output_count: z.number().int().nonnegative().default(0),
  duration_ms: z.number().nonnegative().default(0),
  detail: z.string().nullish().default(null),
});
export type TbmReportStep = z.infer<typeof reportStepSchema>;

const reportWorkTypeField = z
  .union([
    z.object({ code: z.string(), label: z.string() }),
    z.string().transform((code) => ({
      code,
      label: workTypeLabelOf(code) ?? code,
    })),
  ])
  .nullish()
  .default(null);

/**
 * 작업 마무리 문단. 모델이 문단을 JSON 으로 감싸 보낸 값({"message": "…"})이 그대로 저장된 판이 있어, 글 하나만 든
 * JSON 객체면 그 글을 꺼낸다. 다른 모양은 받은 그대로 둔다.
 */
function wrapUpText(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('{')) return raw;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    const values = Object.values(parsed);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : raw;
  } catch {
    return raw;
  }
}

export const tbmReportSchema = z.object({
  report_id: z.number().int(),
  work_id: idString,
  report_version: z.number().int(),
  wrap_up_summary: z.string().transform(wrapUpText).nullish(),
  wrap_up_status: z.string().nullish(),
  locked_at: z.union([z.string(), z.number()]).nullish(),
  content_sha256: z.string().nullish(),
  approved_at: z.union([z.string(), z.number()]).nullish(),
  approved_by_name: z.string().nullish(),
  signature_count: z.number().int().optional(),
  status: reportStatusSchema,
  failure_reason: z.string().nullish().default(null),
  layout_id: z.number().int().nullish().default(null),
  layout_revision: z.number().int().nullish().default(null),
  work_type: reportWorkTypeField,
  header: reportHeaderSchema.nullish().default(null),
  rule_version: z.number().int().nullish().default(null),
  risk_items: z.array(reportRiskItemSchema).default([]),
  zone_history: z.array(reportZoneHistorySchema).default([]),
  sections: z.array(reportSectionSchema).default([]),
  citations: z.array(reportCitationSchema).default([]),
  subgraph: subgraphSchema.default({ nodes: [], edges: [] }),
  steps: z.array(reportStepSchema).default([]),
  llm_model: z.string().nullish().default(null),
  created_at_ms: z.number().default(0),
  completed_at_ms: z.number().nullish().default(null),
});
export type TbmReport = z.infer<typeof tbmReportSchema>;

export const signerRoleSchema = z.enum(['PARTICIPANT', 'APPROVER']);
export type SignerRole = z.infer<typeof signerRoleSchema>;
export const signatureSchema = z.object({
  signature_id: z.union([z.string(), z.number()]).transform(String),
  signer_name: z.string(),
  signer_role: signerRoleSchema,
  signed_at: z.union([z.number(), z.string()]),
  report_version: z.number(),
  image_url: z.string(),
});
export type Signature = z.infer<typeof signatureSchema>;
// 서버는 첫 서명이 아니라 제출 때 보고서를 잠가서(-611) `locked_at` 이 제출 전에는 null 이다.
// `content_sha256` 은 제출 전에도 그 서명 시점의 내용 해시로 온다.
export const signatureResultSchema = signatureSchema.omit({ image_url: true }).extend({
  report_id: z.number(),
  locked_at: z.union([z.number(), z.string()]).nullish(),
  content_sha256: z.string(),
});

export const tbmReportVersionSummarySchema = z.object({
  report_id: z.number().int(),
  report_version: z.number().int(),
  status: reportStatusSchema,
  created_at_ms: z.number().default(0),
});
export type TbmReportVersionSummary = z.infer<typeof tbmReportVersionSummarySchema>;

export const tbmReportByWorkResponseSchema = z.object({
  latest: tbmReportSchema.nullable().default(null),
  versions: z.array(tbmReportVersionSummarySchema).default([]),
});
export type TbmReportByWorkResponse = z.infer<typeof tbmReportByWorkResponseSchema>;

export const tbmReportGenerateResponseSchema = z.object({
  report_id: z.number().int(),
  work_id: idString,
  report_version: z.number().int(),
  status: reportStatusSchema,
});
export type TbmReportGenerateResponse = z.infer<typeof tbmReportGenerateResponseSchema>;

// ── 변환 및 오류 문구 ────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  zone_distance_m: '구역 거리',
  edge_distance_m: '수평',
  height_diff_m: '높이 차',
  surface_height_m: '작업면',
  work_height_m: '작업면',
  occupancy_z_min_m: '바닥 높이',
};

const REASON_LABELS: Record<string, string> = {
  edge_within_raise_distance: '단부 인접',
  standing_on_surface: '작업면 상부',
  standing_surface_elevated: '난간 없음',
  xy_inside_polygon: '위험 구역 진입',
  xy_uncertainty_overlap: '위험 구역 경계 인접',
};

/** 보고서의 risk_item 하나를 화면 평가 표 행(TaskEval)으로 바꾼다. */
export function riskItemToEval(item: TbmReportRiskItem): TaskEval {
  const zoneLabel = item.zone_id
    ? (TBM_ZONES.find((z) => z.id === item.zone_id)?.name ?? item.zone_id)
    : null;
  const posLabel = item.position_ids.length > 0 ? item.position_ids.join(', ') : null;
  const defaultItem =
    posLabel && item.zone_id
      ? `${posLabel} ↔ ${item.zone_id}`
      : item.zone_id
        ? `${zoneLabel} (${item.zone_id})`
        : posLabel
          ? `계획 위치 ${posLabel}`
          : `${ruleName(item.rule_id)} 위험 항목`;

  const metricParts = Object.entries(item.metrics).map(([k, v]) => {
    const label = METRIC_LABELS[k] ?? k;
    const unit = k.endsWith('_m') ? 'm' : '';
    return `${label} ${v}${unit}`;
  });
  const reasonParts = item.reason_codes
    .map((code) => REASON_LABELS[code])
    .filter((v): v is string => Boolean(v));
  const defaultWhy = [...metricParts, ...reasonParts].join(' · ') || '물리 수치 판정';

  return {
    item: item.item ?? defaultItem,
    rule: item.rule_id,
    sev: item.severity as Severity,
    why: item.why ?? defaultWhy,
  };
}

/** 레이아웃 항목 종류 → 2D 평면 도식 종류. 고소 작업면(옛 비계 포함)은 높이를 함께 보인다. */
const LAYOUT_ITEM_PLAN_KIND: Record<LayoutObbItem['kind'], 'scaffold' | 'parking' | 'area'> = {
  OPENING: 'area',
  WORK_SURFACE: 'scaffold',
  SCAFFOLD: 'scaffold',
  EQUIPMENT: 'parking',
};

/** 가상 레이아웃 OBB 항목을 2D 평면 도식(LayoutItem)으로 바꾼다. */
export function layoutObbToItem(obb: LayoutObbItem): LayoutItem {
  const [cx, cy] = obb.center;
  const [sx, sy, sz] = obb.size;
  const x = Number((cx - sx / 2).toFixed(3));
  const y = Number((cy - sy / 2).toFixed(3));
  const kind = LAYOUT_ITEM_PLAN_KIND[obb.kind];
  return {
    kind,
    label: obb.label ?? obb.item_id,
    x,
    y,
    w: sx,
    h: sy,
    ...(kind === 'scaffold' ? { hgt: sz } : {}),
  };
}

/** epoch ms → 'HH:MM' (현지 시각). */
export function msToHhmm(ms: number): string {
  const d = new Date(ms);
  return fromMin(d.getHours() * 60 + d.getMinutes());
}

/** 날짜('YYYY-MM-DD')와 시각('HH:MM') → epoch ms. */
export function dateHhmmToMs(date: string, hhmm: string): number {
  const [y = 2026, m = 10, d = 16] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** 작업 ID 표기: 숫자 ID('1', '12')는 화면에서 'T1', 'T12' 로 보이고, 서버 요청에는 workId('1', '12')를 쓴다. */
export const displayTaskId = (workId: string): string =>
  /^\d+$/.test(workId) ? `T${workId}` : workId;

/** 보고서 sections 에서 대책 문장 목록(최대 3줄)을 뽑는다. */
export function extractReportMeasures(report: TbmReport | null | undefined): string[] {
  if (!report || report.status !== 'SUCCEEDED') return [];
  const measuresSec = report.sections.find((s) => s.key === 'measures');
  const focusSec = report.sections.find((s) => s.key === 'focus');
  const lines: string[] = [];
  if (measuresSec?.body) {
    const parts = measuresSec.body
      .split(/\n|(?<=다\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    lines.push(...parts);
  }
  if (lines.length === 0 && focusSec?.body) {
    lines.push(focusSec.body.trim());
  }
  return lines;
}

/** 서버 WorkUnit + 연결된 레이아웃 + 최신 보고서를 화면 TbmTask 로 합친다. */
export function workUnitToTbmTask(
  work: TbmWorkUnit,
  layout?: LayoutDetail | null,
  report?: TbmReport | null,
): TbmTask {
  const items = layout ? layout.items.map(layoutObbToItem) : [];
  const evals =
    report && (report.status === 'SUCCEEDED' || report.risk_items.length > 0)
      ? report.risk_items.map(riskItemToEval)
      : [];
  const measures = extractReportMeasures(report);
  const gearItems = layout?.items.filter((i) => i.kind === 'EQUIPMENT') ?? [];
  const gear =
    gearItems.length > 0
      ? gearItems.map((i) => i.label ?? i.item_id).join(', ')
      : layout
        ? '장비 없음'
        : '장비 미입력';

  return {
    id: displayTaskId(work.work_id),
    workId: work.work_id,
    status: work.status,
    actualStartedAt: work.actual_started_at,
    actualEndedAt: work.actual_ended_at,
    activeSetupSessionId: work.active_setup_session_id ?? null,
    date: work.date,
    eventCounts: work.event_counts ?? null,
    name: work.name,
    from: msToHhmm(work.from_ms),
    to: msToHhmm(work.to_ms),
    zone: work.zone_id,
    area: workPlaceLabel(work),
    people: work.planned_people,
    lead: work.lead ?? '',
    gear,
    layoutId: work.layout_id ?? null,
    workType: work.work_type ?? null,
    items,
    evals,
    measures,
  };
}

const FAILURE_REASON_TEXT: Record<string, string> = {
  CITATION_VIOLATION: '법령 인용 검증 위반으로 초안이 거부되었습니다 (CITATION_VIOLATION)',
  REPORT_DRAFT_REJECTED:
    '법령 인용·규칙 검증 위반으로 초안이 거부되었습니다 (REPORT_DRAFT_REJECTED)',
  LLM_UNAVAILABLE: '외부 LLM 서비스에 연결할 수 없습니다 (LLM_UNAVAILABLE)',
  LLM_TIMEOUT: '외부 LLM 응답 시간이 초과되었습니다 (LLM_TIMEOUT)',
  NO_CANDIDATES: '조건에 맞는 법령 후보 조문을 찾지 못했습니다 (NO_CANDIDATES)',
  CORPUS_EMPTY: '법령 지식 그래프 코퍼스가 비어 있습니다 (CORPUS_EMPTY)',
};

/** FAILED 보고서의 failure_reason 을 화면 안내 문구로 바꾼다(지어낸 문장으로 채우지 않는다). */
export function tbmFailureReasonText(reason: string | null | undefined): string {
  if (!reason) return '보고서 생성에 실패했습니다.';
  return FAILURE_REASON_TEXT[reason] ?? `보고서 생성에 실패했습니다 (${reason})`;
}

/** WORK_HAS_NO_LAYOUT(409) 거절 시 안내 문구: 배치·저장 안내 + 구역 화면의 개구부(관제 구역)와 TBM 가상 레이아웃의 차이 한 줄. */
export const WORK_HAS_NO_LAYOUT_GUIDANCE =
  '가상 레이아웃에 위험 요소(개구부 등)를 먼저 배치·저장하세요. 구역 화면의 개구부(관제 구역)는 실시간 위험 감지용이고, TBM 가상 레이아웃은 작업 전 위험성 평가·보고서 생성을 위한 사전 계획 배치입니다.';

/** 보고서 생성 요청이 가상 레이아웃 미연결(409 WORK_HAS_NO_LAYOUT)로 거절됐는지 판정한다. */
export function isWorkHasNoLayoutError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'WORK_HAS_NO_LAYOUT';
}

/** POST /api/reports/tbm 실패(404/409 등)를 화면 안내 문구로 바꾼다. */
export function tbmReportRequestErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.status === 404 ||
      error.code === 'WORK_NOT_FOUND' ||
      error.code === 'WORK_UNIT_NOT_FOUND'
    ) {
      return '작업을 찾을 수 없습니다. 작업이 서버에 등록되어 있는지 확인해 주세요. (WORK_NOT_FOUND)';
    }
    if (isWorkHasNoLayoutError(error)) {
      return WORK_HAS_NO_LAYOUT_GUIDANCE;
    }
    if (error.status === 409 && error.code === 'REPORT_IN_PROGRESS') {
      return '이미 생성 중인 보고서가 있습니다. 생성이 끝날 때까지 기다려 주세요. (REPORT_IN_PROGRESS)';
    }
    if (error.status === NETWORK_ERROR) {
      return '서버에 연결하지 못했습니다.';
    }
    if (error.status >= 400 && error.status < 500 && error.serverMessage) {
      return error.serverMessage;
    }
  }
  return '보고서 생성을 요청하지 못했습니다.';
}

/** 작업 등록·수정·삭제 API 실패를 화면 안내 문구로 바꾼다. */
export function tbmWorkMutationErrorText(
  error: unknown,
  action: 'create' | 'update' | 'delete',
): string {
  const actionLabel = action === 'create' ? '등록' : action === 'update' ? '수정' : '삭제';
  if (error instanceof ApiError) {
    if (error.status === NETWORK_ERROR) {
      return `서버에 연결하지 못해 작업을 ${actionLabel}하지 못했습니다.`;
    }
    if (error.serverMessage) {
      return `작업 ${actionLabel}에 실패했습니다: ${error.serverMessage}`;
    }
  }
  return `작업 ${actionLabel}에 실패했습니다. 잠시 후 다시 시도해 주세요.`;
}

/** 가상 레이아웃 저장(POST/PUT /api/layouts) 실패를 화면 안내 문구로 바꾼다. */
export function tbmLayoutSaveErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code === 'LAYOUT_REVISION_CONFLICT') {
      return '다른 사람이 먼저 고침 — 다시 불러오기';
    }
    if (error.status === NETWORK_ERROR) {
      return '서버에 연결하지 못해 레이아웃을 저장하지 못했습니다.';
    }
    if (error.serverMessage) {
      return `레이아웃 저장 실패: ${error.serverMessage}`;
    }
  }
  return '레이아웃을 저장하지 못했습니다.';
}

/** API 실패가 데모 폴백 대상(네트워크 끊김·시간 초과·5xx)인지 판정한다. */
export function isFallbackApiError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return (
    error.status === NETWORK_ERROR ||
    error.kind === 'NETWORK' ||
    error.kind === 'TIMEOUT' ||
    error.status >= 500
  );
}

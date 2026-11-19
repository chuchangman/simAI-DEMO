import type { RiskEventPayload } from '@simai/contracts';
import { z } from 'zod';

// 이벤트 REST 응답(명세 12.6 GET /api/events, POST /api/events/{id}/ack). 항목은 risk_event payload 와 같다.
// 계약 검증기는 봉투(envelope) 단위라 여기서는 화면이 쓰는 필드만 검사한다. 아래 타입 검사가 계약과 어긋나면 알려 준다.
// zod 객체는 모르는 칸을 버린다. REST 항목이 캐시에 들어가 STOMP 항목과 같이 쓰이므로, 서버가 보내는 칸은 다 적어 둔다.

const severity = z.enum(['CRITICAL', 'HIGH', 'CAUTION', 'INFO']);

const operatorAck = z.object({
  ack_id: z.string(),
  channel: z.string(),
  actor_role: z.string(),
  actor_id: z.string(),
  acked_at: z.number(),
});

// 운영자 종료(event_close)의 기록. 서버는 전부 보내지만, 칸 하나가 없다고 목록 전체를 버리지 않게 화면이 안 쓰는 칸은 선택으로 둔다.
const operatorResolution = z.object({
  kind: z.literal('OPERATOR_CLOSED'),
  close_id: z.string().optional(),
  channel: z.string().optional(),
  actor_role: z.string().optional(),
  actor_id: z.string().optional(),
  requested_at: z.number(),
  reason: z.string(),
});

// 병합 흡수 마감(risk_event 2.4.0, S15P31A101-657). World ID 병합으로 같은 사람의 같은 위험이 남는 이벤트에 이어져 흡수된 쪽을 닫은 기록이다.
// 운영자 종료가 아니고 관측 해소도 아니다. 화면이 쓰지 않는 칸은 선택으로 둬 칸 하나 탓에 목록 전체를 버리지 않는다.
const identityMergeResolution = z.object({
  kind: z.literal('IDENTITY_MERGED'),
  survivor_event_id: z.string().optional(),
  survivor_world_id: z.string().optional(),
  merged_world_id: z.string().optional(),
});

// EC2 마감(risk_event 2.5.0, S15P31A101-722). 이벤트를 들고 있던 Tier 0 가 사라졌거나(작업 종료·GPU 세션 종료) 살아 있는 Tier 0 의
// 스냅샷에 없어 해소 전이가 다시 오지 않을 이벤트를 EC2 가 닫은 기록이다. 관측 해소도 운영자 종료도 아니라 「최근 해소」에 넣지 않는다.
export const SERVER_CLOSE_KINDS = ['WORK_ENDED', 'SESSION_ENDED', 'NOT_IN_SNAPSHOT'] as const;
export type ServerCloseKind = (typeof SERVER_CLOSE_KINDS)[number];

const serverCloseResolution = z.object({
  kind: z.enum(SERVER_CLOSE_KINDS),
  close_id: z.string().optional(),
  closed_at: z.number().optional(),
  reason: z.string().optional(),
  trigger_ref: z.string().nullable().optional(),
  last_event_sequence: z.number().int().nullable().optional(),
});

const eventResolution = z.union([
  operatorResolution,
  identityMergeResolution,
  serverCloseResolution,
]);

const operatorEscalation = z.object({
  escalation_id: z.string().optional(),
  basis: z.string().optional(),
  assessment_job_id: z.string().optional(),
  assessment_id: z.union([z.string(), z.number()]).optional(),
  assessmentId: z.union([z.string(), z.number()]).optional(),
  target_severity: severity,
  channel: z.string().optional(),
  actor_role: z.string().optional(),
  actor_id: z.string().optional(),
  requested_at: z.number(),
  decided_at: z.number().nullable().optional(),
  event_sequence: z.number().int().optional(),
  note: z.string().optional(),
  decision: z.string().optional(),
  result: z.string().nullable().optional(),
  reject_reason: z.string().nullable().optional(),
  status: z.string().optional(),
});

/** 서버 이벤트 상세의 VLM 평가 기록(vlm_assessment) 한 건, 최신순(S15P31A101-276). 승인·거절 대상 ID 는 여기서 읽는다. */
const vlmAssessment = z.object({
  assessment_id: z.union([z.string(), z.number()]),
  job_id: z.string().nullable().optional(),
  proposed_severity: severity.nullable().optional(),
  decision: z.string().nullable().optional(),
});

export const summaryStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
]);

export type EventSummaryStatus = z.infer<typeof summaryStatusSchema>;

/** 서버 이벤트 상세·STOMP(/topic/events)의 사고 구간 요약(incident_summary) 한 건, 최신순(S15P31A101-368, -369). */
export const eventSummarySchema = z.object({
  summary_id: z.number(),
  job_id: z.string(),
  status: summaryStatusSchema,
  requested_at: z.number(),
  finished_at: z.number().nullable().default(null),
  summary: z.string().nullable().default(null),
  evidence_timestamps_ms: z.array(z.number()).default([]),
  window_start_ms: z.number().nullable().default(null),
  window_end_ms: z.number().nullable().default(null),
  error_code: z.string().nullable().default(null),
});

export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventItemSchema = z.object({
  event_id: z.string(),
  event_sequence: z.number().int().optional(),
  rule_id: z.string(),
  rule_version: z.number().int().optional(),
  source: z.enum(['LIVE', 'PLANNED', 'REPLAY', 'WHAT_IF']),
  lifecycle: z.enum(['RAISED', 'UPDATED', 'RESOLVED']),
  verification: z.enum(['VERIFIED', 'UNVERIFIABLE']),
  severity,
  confidence: z.enum(['HIGH', 'LOW']),
  needs_check: z.boolean(),
  confidence_reasons: z.array(z.string()).optional(),
  resume_count: z.number().int().optional(),
  world_ids: z.array(z.string()),
  zone_id: z.string().nullable(),
  metrics: z.record(z.string(), z.number()),
  rationale: z.string().nullable(),
  proposed_severity: severity.nullable(),
  assessment_id: z.union([z.string(), z.number()]).nullable().optional(),
  assessmentId: z.union([z.string(), z.number()]).nullable().optional(),
  assessment_job_id: z.string().nullable().optional(),
  gateway_id: z.string().optional(),
  config_version: z.string().optional(),
  calibration_version: z.string().optional(),
  scene_version: z.string().optional(),
  related_event_id: z.string().optional(),
  raised_at: z.number().optional(),
  updated_at: z.number().optional(),
  resolved_at: z.number().nullable().optional(),
  acks: z.array(operatorAck).optional(),
  delivery: z.enum(['REALTIME', 'DELAYED_ACTIVE', 'AUDIT_ONLY']).optional(),
  held_by_tier0: z.boolean().optional(),
  resolution: eventResolution.optional(),
  escalations: z.array(operatorEscalation).optional(),
  assessments: z.array(vlmAssessment).optional(),
  summaries: z.array(eventSummarySchema).optional(),
});

/** 화면이 쓰는 이벤트 값. STOMP 의 risk_event payload 도 그대로 넣을 수 있다. */
export type EventItem = z.infer<typeof eventItemSchema>;
export type Severity = EventItem['severity'];

// 계약(risk_event payload)이 바뀌어 EventItem 에 넣을 수 없게 되면 타입 검사가 여기서 실패한다.
export const contractFitsEventItem = (event: RiskEventPayload): EventItem => event;

/**
 * GET /api/events 응답(Spring Page). 다음 쪽이 있는지 보는 칸(totalElements·number·size)은 서버가 안 보내도 목록은 받는다.
 * 그러면 한 쪽이 꽉 찼는지로 다음 쪽을 판단한다(api.ts).
 */
export const eventsPageSchema = z.object({
  content: z.array(eventItemSchema),
  totalElements: z.number().int().optional(),
  number: z.number().int().optional(),
  size: z.number().int().optional(),
});

export type EventsPage = z.infer<typeof eventsPageSchema>;

/** 운영자 확인(ACK) 한 건. */
export type EventAck = NonNullable<EventItem['acks']>[number];

/** 운영자 상향(escalation) 한 건. */
export type EventEscalation = NonNullable<EventItem['escalations']>[number];

/** 관리자가 VLM 상향 의견에 내리는 결정(명세 5.4, 12.6). */
export type EscalationDecision = 'APPROVED' | 'REJECTED';

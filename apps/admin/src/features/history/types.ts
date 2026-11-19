import { workRunsField } from '@/lib/workRuns';
import { z } from 'zod';

// 히스토리(작업 다시 보기) 응답. 시각은 모두 epoch ms 다.
// 작업 목록(GET /api/work-units)은 서버 응답 그대로다(docs/design/server-work-units.md). 서버는 lead(조 이름) 도 주지만 화면은 쓰지 않는다.
// 구간 기록은 서버가 있는 GET /api/replay(명세 12.6, docs/design/server-replay.md)의 실제 응답 모양이다.

/** 작업 하나(TBM 작업). 작업자 이름은 없다(NFR-14). */
export const workUnitSchema = z.object({
  work_id: z.string().min(1),
  /** 작업 날짜(현장 시각, YYYY-MM-DD). 목록을 날짜로 묶는다. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string(),
  /** 계획 시각. 다시 보는 구간은 실제 시작·종료(actual_*)를 쓴다. */
  from_ms: z.number(),
  to_ms: z.number(),
  /** 실제 작업 시작·종료 시각(EC2 시계). 시작 전이면 둘 다 null, 진행 중이면 종료만 null 이다. */
  actual_started_at: z.number().nullish(),
  actual_ended_at: z.number().nullish(),
  /** 실행 목록(S15P31A101-696). 다시 보기는 실행 하나의 구간을 본다. 옛 서버는 칸이 없다. */
  runs: workRunsField,
  zone_id: z.string().nullable(),
  /** 구역 이름 또는 구역 밖 작업 장소. */
  place: z.string().nullish(),
  planned_people: z.number().int().nonnegative(),
  /** 구간에 발생한 이벤트 수(등급별). 모르면 없다. */
  event_counts: z
    .object({ CRITICAL: z.number().int(), HIGH: z.number().int() })
    .partial()
    .nullish(),
});
export type WorkUnit = z.infer<typeof workUnitSchema>;

/** GET /api/work-units. 작업은 하나씩 검사해 틀린 것만 뺀다. */
export const workUnitsResponseSchema = z.object({
  works: z.array(z.unknown()),
});
export type WorkUnitsResponse = z.infer<typeof workUnitsResponseSchema>;

// 메시지는 STOMP 로 받는 것과 같은 봉투다(명세 12.1). 칸마다의 계약 검사는 재생 엔진(parseReplayLog)이 줄마다 하므로
// 여기서는 봉투 모양과 우리가 읽는 칸(msg_id·t_latest_global·event_id)만 본다. 나머지 칸은 그대로 둔다.
const envelope = <Type extends string, Payload extends z.ZodRawShape>(
  msgType: Type,
  payload: Payload,
) =>
  z.looseObject({
    msg_type: z.literal(msgType),
    msg_id: z.string().min(1),
    payload: z.looseObject(payload),
  });

/** 기록의 world_state 봉투. t_latest_global 이 시각축 위치다. */
export const worldEnvelopeSchema = envelope('world_state', { t_latest_global: z.number() });
/** 기록의 risk_event 봉투. 출처(source)는 저장된 그대로 LIVE 로 온다. */
export const eventEnvelopeSchema = envelope('risk_event', { event_id: z.string().min(1) });
export type WorldEnvelope = z.infer<typeof worldEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** 기록이 없던 구간(Tier 0 health 가 3초 넘게 끊김). 이 안에서 world 가 없으면 "데이터 없음"이다. */
export const gapSchema = z.object({ from: z.number(), to: z.number() });
export type ReplayGap = z.infer<typeof gapSchema>;
/** 시각 구간 [from, to](ms). 작업 구간과 기록 없는 구간이 같이 쓴다. */
export type Span = ReplayGap;

/**
 * GET /api/replay?from&to&step_ms.
 * - world_states: [from, to] 의 tick(시간순). 기록 없는 시각은 빠진다(보간하지 않는다).
 * - initial_events: from 시각에 활성인 이벤트의 그 시각 상태.
 * - events: (from, to] 의 생명주기 전이(관측 시각순). ACKNOWLEDGED 는 오지 않는다.
 */
export const replayResponseSchema = z.object({
  from: z.number(),
  to: z.number(),
  step_ms: z.number().positive(),
  world_states: z.array(worldEnvelopeSchema),
  initial_events: z.array(eventEnvelopeSchema),
  events: z.array(eventEnvelopeSchema),
  gaps: z.array(gapSchema),
});
/** 요청 하나의 응답이거나, 나눠 받은 응답을 하나로 합친 것(같은 모양이다). */
export type ReplayResponse = z.infer<typeof replayResponseSchema>;

/**
 * 상시 영상 조각(GET /api/videos, 관리자, docs/design/server-video-segments.md). 카메라 하나의 촬영 구간 하나이고
 * 주소는 싣지 않는다. 화면이 쓰는 칸만 검사하고 형식이 틀린 조각 하나는 빼고 나머지를 보인다.
 */
const videoSegmentSchema = z.object({
  segment_id: z.string().min(1),
  camera_id: z.string().min(1),
  segment_start_capture_ms: z.number(),
  segment_end_capture_ms: z.number(),
  /** 보관 기간이 끝나 EC2 가 객체를 지운 시각. 지운 조각은 목록에 남지만 재생할 수 없다. */
  deleted_at_ms: z.number().nullish(),
  /** TIER0(상시 조각) · GATEWAY_RECORDING(관제가 끝난 뒤 게이트웨이가 올린 작업 구간 mp4, S15P31A101-668). 화면은 구분 없이 튼다. */
  origin: z.string().nullish(),
});
export type VideoSegment = z.infer<typeof videoSegmentSchema>;

export const recordingUploadSchema = z.object({
  schema_version: z.literal('1.0.0'),
  work_id: z.number().int().positive(),
  status: z.enum(['WAITING', 'UPLOADING', 'COMPLETED', 'FAILED', 'NO_RECORDING', 'EXPIRED']),
  expected_segments: z.number().int().nonnegative().nullable(),
  uploaded_segments: z.number().int().nonnegative(),
  failed_segments: z.number().int().nonnegative(),
});

export const videoSegmentsSchema = z.object({
  recording_uploads: z.array(recordingUploadSchema).optional(),
  segments: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const segment = videoSegmentSchema.safeParse(item);
      return segment.success ? [segment.data] : [];
    }),
  ),
});

/** GET /api/videos/{segmentId}: 조각을 잠깐(5분) 받을 수 있는 서명 GET 주소. 받는 순간 서버가 조회 기록을 남긴다. */
export const videoUrlSchema = z.object({
  segment_id: z.string(),
  url: z.string().min(1),
  expires_at_ms: z.number(),
  content_type: z.string().min(1),
  container: z.string().min(1),
});
export type VideoUrl = z.infer<typeof videoUrlSchema>;

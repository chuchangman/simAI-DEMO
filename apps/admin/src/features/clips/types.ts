import { z } from 'zod';

// 이벤트 클립 REST(명세 12.6 GET /api/clips/{id}·PUT /api/clips/{id}/retention, FR-59·FR-99, BE 곽나혁).
// 형식은 서버 구현(docs/design/server-event-clips.md, ClipService)의 실제 응답이다. 클립 칸 이름은 계약 media_clip 과 같고
// EC2 가 auto_retained·deleted_at_ms·uploaded_at_ms·received_at_ms 를 더한다. 서명 주소·객체 키는 목록에 싣지 않는다.

/** 클립 한 개(카메라 하나 × 위험 구간 하나). 화면이 쓰는 칸만 검사한다. */
const clipSchema = z.object({
  clip_id: z.string().min(1),
  camera_id: z.string().min(1),
  /** 이벤트 재개 횟수. 0 은 처음 발생이고 재개마다 새 클립이 생긴다. */
  resume_count: z.number().int().min(0),
  clip_start_capture_ms: z.number(),
  clip_end_capture_ms: z.number(),
  /** 클립에 든 프레임 수. */
  frame_count: z.number().int().min(0),
  truncated_start: z.boolean(),
  truncated_end: z.boolean(),
  has_gaps: z.boolean(),
  /** 원본 형식. Tier 0 원본은 `video/h264`(`h264-annexb`)다. */
  content_type: z.string().min(1),
  container: z.string().min(1),
  size_bytes: z.number().min(0).nullish(),
  /** 관리자가 붙인 보존 표시이거나 자동 보존. */
  retention_hold: z.boolean(),
  /** CRITICAL 이벤트 연결분이라 관리자가 뗄 수 없는 보존(보존 표시가 켜져 있을 때만 참). */
  auto_retained: z.boolean().default(false),
  /** 보관 기간(14일)이 끝나 지우는 시각. */
  delete_after_ms: z.number().nullish(),
  /** EC2 가 보관 기간이 지나 객체를 지운 시각. 지운 클립은 목록에 남지만 재생할 수 없다. */
  deleted_at_ms: z.number().nullish(),
});

export type Clip = z.infer<typeof clipSchema>;

/** GET /api/events/{id}/clips(관리자). 형식이 틀린 클립 하나는 빼고 나머지를 보인다. */
export const eventClipsSchema = z.object({
  event_id: z.string(),
  clips: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const clip = clipSchema.safeParse(item);
      return clip.success ? [clip.data] : [];
    }),
  ),
});

/**
 * GET /api/clips/{id}(관리자): 클립을 잠깐(5분) 받을 수 있는 서명 GET 주소. 받는 순간 서버가 조회 기록을 남긴다.
 * 서버는 영상을 변환하지 않는다. `h264-annexb` 는 브라우저가 MP4 로 감싸 재생하고 `mp4` 는 그대로 재생한다.
 */
export const clipUrlSchema = z.object({
  clip_id: z.string(),
  url: z.string().min(1),
  expires_at_ms: z.number(),
  content_type: z.string().min(1),
  container: z.string().min(1),
});

export type ClipUrl = z.infer<typeof clipUrlSchema>;

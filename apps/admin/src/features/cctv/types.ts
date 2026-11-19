import { z } from 'zod';

// 현장 노트북 CCTV 미리보기(simai-cctv-preview/1) 메시지. 로컬(127.0.0.1)과 원격 시청(EC2 /ws/cctv/view)이 같은 형식이다.
// 정본은 저장소 루트 contracts/messages/cctv_preview.schema.json(텍스트, 1.1.0 status 는 원격만)과
// frame_header.schema.json(이진 메시지 헤더)이다.
// STOMP I2 메시지가 아니라 packages/contracts 생성 대상(msg_type 봉투)에 들지 않아 여기 zod 로 같은 규칙을 둔다.
// 계약 예시·반례를 그대로 넣어 보는 시험이 둘이 어긋나지 않게 한다(__tests__/features/cctv/protocol.test.ts).

export const PREVIEW_PROTOCOL = 'simai-cctv-preview/1';

const cameraId = z.string().regex(/^[A-Za-z0-9_-]+$/);
const base64 = z
  .string()
  .min(4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const nonNegativeInt = z.number().int().min(0);

/** I0 codec_info (contracts/messages/codec_info.schema.json, 닫힌 객체). */
export const codecInfoSchema = z.strictObject({
  camera_id: cameraId,
  stream_epoch: nonNegativeInt,
  codec: z.literal('H264'),
  profile: z.string().optional(),
  sps: base64,
  pps: base64,
  pts_timebase: z.string().regex(/^1\/[1-9][0-9]*$/),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  nominal_fps: z.number().positive().optional(),
});

const helloSchema = z.strictObject({
  kind: z.literal('hello'),
  protocol: z.literal(PREVIEW_PROTOCOL),
  cameras: z.array(cameraId).min(1).max(16),
});

const codecSchema = z.strictObject({
  kind: z.literal('codec'),
  protocol: z.literal(PREVIEW_PROTOCOL),
  codec_info: codecInfoSchema,
  codec_string: z.string().regex(/^avc1\.[0-9A-F]{6}$/),
});

/** 원격 시청 상태(EC2 → 시청자). viewer_limit·monthly_quota 는 보낸 뒤 서버가 닫는다. */
export const REMOTE_STATES = ['live', 'waiting_source', 'viewer_limit', 'monthly_quota'] as const;
export type RemoteState = (typeof REMOTE_STATES)[number];

const statusSchema = z.strictObject({
  kind: z.literal('status'),
  protocol: z.literal(PREVIEW_PROTOCOL),
  state: z.enum(REMOTE_STATES),
  monthly_sent_bytes: nonNegativeInt.optional(),
  monthly_quota_bytes: z.number().int().min(1).optional(),
});

/** 텍스트 메시지: 접속 직후 hello, 카메라별 codec(새 stream_epoch 마다 다시), 원격 시청 상태 status. */
export const previewTextSchema = z
  .discriminatedUnion('kind', [helloSchema, codecSchema, statusSchema])
  .refine((m) => m.kind !== 'hello' || new Set(m.cameras).size === m.cameras.length, {
    error: '카메라가 겹친다',
  });

/** 이진 메시지 헤더 = I0 frame_header. 화면이 쓰는 칸만 본다. */
export const frameHeaderSchema = z.object({
  camera_id: cameraId,
  stream_epoch: nonNegativeInt,
  frame_sequence: nonNegativeInt,
  estimated_capture_time_ms: z.number().int(),
  timestamp_source: z.string(),
  timestamp_uncertainty_ms: z.number().min(0),
  keyframe: z.boolean(),
});

export type CodecInfo = z.infer<typeof codecInfoSchema>;
export type PreviewText = z.infer<typeof previewTextSchema>;
export type CodecMessage = Extract<PreviewText, { kind: 'codec' }>;
export type StatusMessage = Extract<PreviewText, { kind: 'status' }>;
export type FrameHeader = z.infer<typeof frameHeaderSchema>;

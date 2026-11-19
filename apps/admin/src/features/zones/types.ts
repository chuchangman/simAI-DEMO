import { staticObjectItemSchema, type StaticObjectBody } from '@/features/surfaces/types';
import { z } from 'zod';

// 구역 REST(GET·POST·PUT /api/zones)와 구성 묶음(POST·GET /api/config-bundles). 서버(BE -120, docs/design/server-config-bundle.md)
// 형식 그대로다. 칸 이름은 DB zone 열을 따른다(eval_type·zone_kind·z_min_m·z_max_m). 구역 목록은 구역마다 지금 유효한 버전 하나다.

/** 구역 목록. 구역 하나가 틀려도 나머지는 그린다. 항목은 zones.ts 에서 하나씩 검사한다. */
export const zonesResponseSchema = z.array(z.unknown());
export type ZonesResponse = z.infer<typeof zonesResponseSchema>;

const JUDGE_TYPES = ['GROUND_FOOTPRINT', 'VOLUME_3D'] as const;
export type JudgeType = (typeof JUDGE_TYPES)[number];

/** 서버가 받는 구역 심각도. 이미 저장된 주의·안내 구역도 읽어야 해서 응답 검사는 네 값 모두 받는다. */
const SEVERITIES = ['CRITICAL', 'HIGH', 'CAUTION', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** 화면에서 구역에 고르는 심각도: 위험·경고. 주의·안내는 이벤트 등급이다. */
export const SEVERITY_CHOICES = ['CRITICAL', 'HIGH'] as const satisfies readonly Severity[];

const vec2 = z.tuple([z.number(), z.number()]);
// 작업 ID 는 숫자나 글자로 오고 글자로 맞춘다(작업 API 와 같다).
const workId = z.union([z.string().min(1), z.number().int()]).transform(String);
const requirements = z.record(z.string(), z.unknown());

/** 세팅 구역 상면 높이 차이 판정(S15P31A101-630). 이전 관제 맵과 이번 세팅 맵의 구역 바닥 상면 높이를 비교한 결과다. */
export const zoneHeightChangeStatusSchema = z.enum(['UNCHANGED', 'CHANGE_SUSPECTED', 'UNKNOWN']);
export type ZoneHeightChangeStatus = z.infer<typeof zoneHeightChangeStatusSchema>;

export const zoneHeightChangeSchema = z
  .object({
    zone_id: z.string(),
    status: zoneHeightChangeStatusSchema,
    reason: z.string().nullish().default(null),
    changed_area_ratio: z.number().nullish().default(null),
    max_height_diff_m: z.number().nullish().default(null),
    max_diff_xy: vec2.nullish().default(null),
    total_cells: z.number().int().nonnegative().optional().default(0),
    compared_cells: z.number().int().nonnegative().optional().default(0),
    changed_cells: z.number().int().nonnegative().nullish().default(null),
  })
  .loose();
export type ZoneHeightChange = z.infer<typeof zoneHeightChangeSchema>;

/**
 * 변경 의심 구역 VLM 의견(S15P31A101-631). 이전·이번 세팅의 같은 카메라 사진 크롭을 AI 가 비교한 유지·수정·삭제 권고 한 줄이다.
 * 표시용 제안이라 구역 목록·확인 필요를 바꾸지 않는다. PENDING 은 초안 작업이 아직 끝나지 않았다는 뜻(서버가 붙인다).
 */
export const zoneAiOpinionStatusSchema = z.enum(['OPINION', 'NO_OPINION', 'PENDING']);
export type ZoneAiOpinionStatus = z.infer<typeof zoneAiOpinionStatusSchema>;
export const zoneAiActionSchema = z.enum(['KEEP', 'MODIFY', 'REMOVE']);
export type ZoneAiAction = z.infer<typeof zoneAiActionSchema>;

const cropBoxNorm = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** 전·후 사진 한 장: 세팅 대표 프레임(CAMERA_FRAME) 서명 주소와 그 안의 구역 크롭 [u1, v1, u2, v2](0~1). */
export const zoneOpinionPhotoSchema = z
  .object({
    image_url: z.string().nullish().default(null),
    crop_box_norm: cropBoxNorm.nullish().default(null).catch(null),
  })
  .loose();
export type ZoneOpinionPhoto = z.infer<typeof zoneOpinionPhotoSchema>;

export const zoneAiOpinionSchema = z
  .object({
    status: zoneAiOpinionStatusSchema,
    reason: z.string().nullish().default(null),
    recommended_action: zoneAiActionSchema.nullish().default(null).catch(null),
    rationale: z.string().nullish().default(null),
    confidence: z.number().nullish().default(null),
    camera_id: z.string().nullish().default(null),
    before: zoneOpinionPhotoSchema.nullish().default(null).catch(null),
    after: zoneOpinionPhotoSchema.nullish().default(null).catch(null),
    image_expires_at_ms: z.number().nullish().default(null),
  })
  .loose();
export type ZoneAiOpinion = z.infer<typeof zoneAiOpinionSchema>;

export const zoneItemSchema = z.object({
  // 공백만 있는 ID 는 받지 않는다. 값은 자르지 않는다(이벤트의 zone_id 와 그대로 맞춘다).
  zone_id: z.string().refine((id) => id.trim() !== ''),
  zone_version: z.number().int().positive(),
  name: z.string(),
  zone_kind: z.string().min(1),
  eval_type: z.enum(JUDGE_TYPES),
  // 바닥 다각형(World x·y, m, 닫는 점 없음). 지금은 상자 편집기가 만든 직사각형만 고칠 수 있다.
  polygon_xy: z.array(vec2).min(3),
  // 최저·최고 높이(m). VOLUME_3D 는 둘 다 있다.
  z_min_m: z.number().nullable(),
  z_max_m: z.number().nullable(),
  severity: z.enum(SEVERITIES),
  // 화면에서 고치지 않는다. 새 버전을 저장할 때 받은 값을 그대로 다시 보낸다.
  requirements: requirements.nullish(),
  has_guardrail: z.boolean().nullish(),
  // 작업 시작 때 서버가 작업 레이아웃 항목으로 만든 구역이면 그 출처(작업·레이아웃·레이아웃 항목). 상시 구역은 모두 비어 있다.
  work_id: workId.nullish(),
  layout_id: z.number().int().nullish(),
  layout_item_id: z.string().nullish(),
  // 이 버전이 유효해진 시각(epoch ms, 서버가 저장할 때 정한다). 지금 버전은 valid_to 가 없다.
  valid_from: z.number(),
  valid_to: z.number().nullable(),
  // 세팅 구역 목록에서 사람이 아직 확인하지 않은 이어 쓴 구역(S15P31A101-629). 관제 구역 응답에는 없다. 3D 가 구별해 그린다.
  needs_review: z.boolean().nullish(),
  // 세팅 구역 목록에서 이어 쓴 구역의 상면 높이 차이 판정(S15P31A101-630). 관제 구역·새 구역에는 없다.
  height_change: zoneHeightChangeSchema.nullish().catch(null),
  // 세팅 구역 목록에서 변경 의심 구역의 AI 의견과 전후 사진(S15P31A101-631). 관제 구역·새 구역에는 없다.
  ai_opinion: zoneAiOpinionSchema.nullish().catch(null),
});

export type ZoneItem = z.infer<typeof zoneItemSchema>;

/** 만들기(POST)·새 버전(PUT) 본문. 서버가 ID·버전·유효 시각을 정한다. 응답은 새로 생긴 버전 하나다(zoneItemSchema). */
export const zoneBodySchema = z.object({
  name: z.string(),
  zone_kind: z.string(),
  eval_type: z.enum(JUDGE_TYPES),
  polygon_xy: z.array(vec2).min(3),
  z_min_m: z.number().nullable(),
  z_max_m: z.number().nullable(),
  severity: z.enum(SEVERITIES),
  has_guardrail: z.boolean().nullable(),
  requirements: requirements.nullable(),
});
export type ZoneBody = z.infer<typeof zoneBodySchema>;

/**
 * 구성 묶음(명세 3.2, FR-17). 발행하면 서버가 그때 유효한 구역·규칙·보정·작업면으로 묶는다. status 는 Tier 0 가 마지막으로
 * 보낸 config_ack 로 정한다: 없으면 PENDING(적용 대기), APPLIED(현장 적용됨), REJECTED(거부), 해시가 다르면 MISMATCH.
 */
const BUNDLE_STATUSES = ['PENDING', 'APPLIED', 'REJECTED', 'MISMATCH'] as const;
export type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/** 묶음에 실린 항목 하나(서버 config_bundle_item). 정적 객체만 kind(WORK_SURFACE·OBSTACLE)가 있다. */
const BUNDLE_ITEM_TYPES = ['ZONE', 'RULE', 'STATIC_OBJECT'] as const;
const bundleItemSchema = z.object({
  item_type: z.enum(BUNDLE_ITEM_TYPES),
  item_id: z.string(),
  item_version: z.number().int(),
  kind: z.string().nullish(),
});
export type BundleItem = z.infer<typeof bundleItemSchema>;

/**
 * 묶음에 실은 안전모·조끼 요구 요약(서버 -518·-549). 진행 중 작업이 있으면 REQUIRED 와
 * 그 작업 ID, 없으면 NOT_REQUIRED 와 null 이다(계약 contracts/data/ppe_policy). effective_from_ms 는 표시·기록용이다.
 */
const ppePolicySummarySchema = z.object({
  helmet: z.enum(['REQUIRED', 'NOT_REQUIRED']),
  // -549: 이전 문서에 vest 가 없으면 서버 요약은 null. 이전 서버는 칸을 생략할 수 있다.
  vest: z.enum(['REQUIRED', 'NOT_REQUIRED']).nullish(),
  work_id: z.number().int().nullable(),
  effective_from_ms: z.number(),
});
export type PpePolicySummary = z.infer<typeof ppePolicySummarySchema>;

export const configBundleSchema = z.object({
  config_version: z.string().min(1),
  issued_at: z.number(),
  status: z.enum(BUNDLE_STATUSES),
  applied_at: z.number().nullable(),
  // 마지막으로 받은 ACK(서버 칸 이름 last_ack). 거부면 Tier 0 가 계속 쓰는 묶음(active_config_version)이 있다.
  last_ack: z
    .object({
      active_config_version: z.string().nullable(),
      reject_reason: z.string().nullable(),
    })
    .nullish(),
  // 발행 때 실린 구역·규칙·작업면의 ID 와 버전. 화면이 시각을 비교하지 않고 이 목록으로 발행 전을 가린다. 없으면 빈 목록이다.
  items: z.array(bundleItemSchema).default([]),
  // 안전모 요구 요약. null 이면 이 묶음에 ppe_policy 가 없다(Tier 0 는 요구 없음으로 본다, 명세 7.2 R9). 칸이 없으면(-518 이전
  // 서버) 실렸는지 모른다(undefined). 요약 모양이 틀려도 묶음은 버리지 않고 모름으로 둔다(구역 발행 상태는 계속 보인다).
  ppe_policy: ppePolicySummarySchema.nullish().catch(undefined),
  // 묶음에 넣은 규칙 기준(OPERATION·CLASSROOM_TEST, 명세 7.4). 관제 머리줄의 현재 기준 표시(S15P31A101-654). 모르면 null·undefined.
  rule_profile: z.string().nullish().catch(undefined),
});
export type ConfigBundle = z.infer<typeof configBundleSchema>;

/** 최근 묶음(새것부터). 항목은 하나씩 검사한다. */
export const bundlesResponseSchema = z.array(z.unknown());

/** 한 번 저장(POST /api/zones/commit)의 구역 부분. KEEP 은 구역을 그대로 두고 작업면만 바꾼다. */
type ZoneCommitZone =
  | { op: 'CREATE'; body: ZoneBody }
  | { op: 'UPDATE'; zone_id: string; body: ZoneBody }
  | { op: 'ARCHIVE'; zone_id: string }
  | { op: 'KEEP'; zone_id: string };

/** 한 번 저장의 작업면 부분. REPLACE 는 옛 작업면을 보관한 뒤 새 작업면을 잇는다. */
export type ZoneCommitSurface =
  | { op: 'CREATE'; body: StaticObjectBody }
  | { op: 'UPDATE' | 'REPLACE'; object_id: string; body: StaticObjectBody }
  | { op: 'ARCHIVE'; object_id: string };

/** 한 번 저장 본문. ARCHIVE 는 작업면을 붙이지 않는다(서버가 이은 작업면도 보관한다). publish 를 빼면 서버는 true 다. */
export interface ZoneCommitRequest {
  zone: ZoneCommitZone;
  surface?: ZoneCommitSurface;
  publish?: boolean;
  setup_session_id?: string;
}

/** 한 번 저장 응답. 저장하지 않은 부분은 null 이고, bundle 은 publish 가 true 일 때만 있다. */
export const zoneCommitResultSchema = z.object({
  zone_id: z.string(),
  zone: zoneItemSchema.nullable(),
  surface: staticObjectItemSchema.nullable(),
  archived_surface_id: z.string().nullable(),
  bundle: configBundleSchema.nullable(),
  layout_sync_failed: z.boolean().optional(),
});
export type ZoneCommitResult = z.infer<typeof zoneCommitResultSchema>;

type Point = readonly [number, number, number];

/** 구역 하나. 축에 맞춘 상자이고 좌표는 World(m, +Z 위)다. 2D 평면은 바닥 직사각형(x·y)만 쓴다. */
export interface ZoneBox {
  zoneId: string;
  name: string;
  min: Point;
  max: Point;
}

/** 서버 구역의 지금 버전. 상자(min·max)는 다각형을 감싸는 상자다. */
export interface Zone extends ZoneBox {
  version: number;
  judgeType: JudgeType;
  zoneType: string;
  severity: Severity;
  /** 받은 바닥 다각형과 최저·최고 높이 그대로(높이는 한쪽만 있을 수 있다). 형상을 고치지 않고 속성만 저장할 때 다시 보낸다. */
  polygon: readonly (readonly [number, number])[];
  zBounds: readonly [number | null, number | null];
  /** 최저·최고 높이가 둘 다 있을 때만 그 범위다. */
  zRange: readonly [number, number] | null;
  hasGuardrail: boolean | null;
  requirements: Readonly<Record<string, unknown>> | null;
  /** 이 버전이 유효해진 시각(ms). 마지막 묶음보다 늦으면 아직 발행하지 않은 것이다. */
  validFrom: number;
  /** 작업 시작 때 작업 레이아웃 항목으로 만든 구역의 출처. 상시 구역은 null 이다. */
  workId: string | null;
  layoutId: number | null;
  layoutItemId: string | null;
  /** 입체 판정이고 바닥이 축에 맞춘 직사각형이며 높이가 있어야 상자 편집기로 형상을 고칠 수 있다. */
  shapeEditable: boolean;
  /** 세팅 구역 목록에서 확인이 필요한 이어 쓴 구역(S15P31A101-629). 관제 구역은 없다(false). */
  needsReview?: boolean;
  /** 세팅 구역 목록에서 이어 쓴 구역의 상면 높이 차이 판정(S15P31A101-630). */
  heightChange?: ZoneHeightChange | null;
  /** 세팅 구역 목록에서 변경 의심 구역의 AI 의견과 전후 사진(S15P31A101-631). */
  aiOpinion?: ZoneAiOpinion | null;
}

/** 3D 뷰어 Source 가 받는 구역 형식: 정식 구역 응답(zoneItemSchema) 배열. 뷰어(contractAdapter)가 다시 검사한다. */
export type ViewerZones = ZoneItem[];

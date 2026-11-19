import { zoneHeightChangeSchema } from '@/features/zones/types';
import { z } from 'zod';

// 세팅 1단계 카메라 각도 헬퍼(GET /api/cameras/coverage-guides, S15P31A101-447, contracts/messages/coverage_guide.schema.json 1.0.0),
// 현장 세팅 세션·카메라 높이 기본값·재시도(GET /api/setup-sessions/camera-height-defaults, POST /api/setup-sessions,
// GET /api/setup-sessions/{id}, POST /api/setup-sessions/{id}/retry, S15P31A101-452),
// 및 VLM 구역 초안(GET /api/setup-sessions/{id}/zone-drafts, S15P31A101-455, contracts/messages/vlm_zone_draft.schema.json 1.0.0) 스키마.

export const cameraReceptionStatusSchema = z.enum(['OK', 'NO_VIDEO', 'STALE']);
export type CameraReceptionStatus = z.infer<typeof cameraReceptionStatusSchema>;

export const pairGradeSchema = z.enum(['ENOUGH', 'WEAK', 'LACK', 'UNKNOWN']);
export type PairGrade = z.infer<typeof pairGradeSchema>;

export const connectivitySchema = z.enum(['CONNECTED', 'DISCONNECTED', 'UNKNOWN']);
export type Connectivity = z.infer<typeof connectivitySchema>;

export const guideDirectionSchema = z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN', 'NONE']);
export type GuideDirection = z.infer<typeof guideDirectionSchema>;

export const guideMagnitudeSchema = z.enum(['SMALL', 'MORE', 'NONE']);
export type GuideMagnitude = z.infer<typeof guideMagnitudeSchema>;

export const guideReasonCodeSchema = z.enum([
  'WEAK_PAIR_EDGE_CLUSTER',
  'NO_OVERLAP_VISIBLE',
  'OPTIONAL_IMPROVE',
]);
export type GuideReasonCode = z.infer<typeof guideReasonCodeSchema>;

const normalizedPointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const coverageCameraItemSchema = z.object({
  camera_id: z.string().min(1),
  status: cameraReceptionStatusSchema,
  frame_ts_ms: z.number().nullable(),
});
export type CoverageCameraItem = z.infer<typeof coverageCameraItemSchema>;

export const coveragePairItemSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  raw_matches: z.number().int().nonnegative().nullable(),
  inliers: z.number().int().nonnegative().nullable(),
  inlier_ratio: z.number().min(0).max(1).nullable(),
  grade: pairGradeSchema,
  centroid_a: normalizedPointSchema.nullable().optional().default(null),
  centroid_b: normalizedPointSchema.nullable().optional().default(null),
});
export type CoveragePairItem = z.infer<typeof coveragePairItemSchema>;

const pairTupleSchema = z.tuple([z.string().min(1), z.string().min(1)]);

export const coverageGuideItemSchema = z
  .object({
    camera_id: z.string().min(1),
    pair: pairTupleSchema.optional(),
    target_pair: pairTupleSchema.optional(),
    direction: guideDirectionSchema,
    magnitude: guideMagnitudeSchema,
    reason_code: guideReasonCodeSchema.optional(),
    reason: guideReasonCodeSchema.optional(),
  })
  .transform((item) => ({
    camera_id: item.camera_id,
    pair: item.pair ?? item.target_pair ?? ([item.camera_id, item.camera_id] as [string, string]),
    direction: item.direction,
    magnitude: item.magnitude,
    reason_code: item.reason_code ?? item.reason ?? 'WEAK_PAIR_EDGE_CLUSTER',
  }));
export type CoverageGuideItem = z.infer<typeof coverageGuideItemSchema>;

export const coverageParamsSchema = z.object({
  image_width_px: z.number().int(),
  max_keypoints: z.number().int(),
  ransac_threshold_px: z.number(),
  enough_min_inliers: z.number().int(),
  weak_min_inliers: z.number().int(),
  min_inlier_ratio: z.number(),
  intrinsics_source: z.enum(['STORED', 'DEFAULT']),
});

// 옆 4쌍 세팅 Stage A 충분 여부(coverage_guide 1.3.0 stage_a_readiness, S15P31A101-761). 대각 쌍은 오지 않는다.
export const stageAStatusSchema = z.enum(['READY', 'CONFIRMING', 'UNSTABLE', 'SHORT', 'UNKNOWN']);
export type StageAStatus = z.infer<typeof stageAStatusSchema>;

export const stageAShortfallSchema = z.enum(['FEW_INLIERS', 'LOW_RATIO', 'CLUSTERED']);
export type StageAShortfall = z.infer<typeof stageAShortfallSchema>;

export const stageAPairSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  status: stageAStatusSchema,
  inliers: z.number().int().nonnegative().nullable(),
  cells_a: z.number().int().nonnegative().nullable(),
  cells_b: z.number().int().nonnegative().nullable(),
  shortfall: z.array(stageAShortfallSchema),
  sufficient_rounds: z.number().int().nonnegative(),
  observed_rounds: z.number().int().nonnegative(),
});
export type StageAPair = z.infer<typeof stageAPairSchema>;

export const stageAReadinessSchema = z.object({
  min_inliers: z.number().int().positive(),
  min_inlier_ratio: z.number(),
  grid: z.tuple([z.number().int(), z.number().int()]),
  min_cell_inliers: z.number().int(),
  min_cells: z.number().int(),
  window_rounds: z.number().int(),
  pairs: z.array(stageAPairSchema),
});
export type StageAReadiness = z.infer<typeof stageAReadinessSchema>;

// 카메라마다 자기 기준 시점에 맞추는 안내(coverage_guide 1.4.0 aim_check, S15P31A101-765). 기준 = 그 현장의 가장 최근 CALIBRATED 세팅의
// 사람 지운 배경 사진. 각도는 「기준에 맞추려면 돌릴 양」(라디안, pan + 오른쪽·tilt + 위·roll + 카메라 뒤에서 볼 때 시계 방향).
// 단계(헬퍼가 2라운드 히스테리시스를 적용해 보낸다): ALIGNED 재사용 가능 > NEAR 새 맵 세팅엔 충분 > MISALIGNED.
export const aimStatusSchema = z.enum(['ALIGNED', 'NEAR', 'MISALIGNED', 'UNKNOWN']);
export type AimStatus = z.infer<typeof aimStatusSchema>;

export const aimCheckItemSchema = z.object({
  camera_id: z.string().min(1),
  status: aimStatusSchema,
  reason: z.string().nullable(),
  matches: z.number().int().nonnegative().nullable(),
  inlier_ratio: z.number().min(0).max(1).nullable(),
  pan_rad: z.number().nullable(),
  tilt_rad: z.number().nullable(),
  roll_rad: z.number().nullable(),
  target_point: normalizedPointSchema.nullable(),
  target_px: z.tuple([z.number(), z.number()]).nullable(),
  arrow_rad: z.number().nullable(),
});
export type AimCheckItem = z.infer<typeof aimCheckItemSchema>;

export const aimCheckSchema = z.object({
  scene_version: z.string().min(1),
  calibration_version: z.string().min(1),
  max_aim_rad: z.number().positive(),
  max_roll_rad: z.number().positive(),
  max_setup_aim_rad: z.number().positive(),
  max_setup_roll_rad: z.number().positive(),
  hysteresis_rounds: z.number().int().positive(),
  cameras: z.array(aimCheckItemSchema),
});
export type AimCheck = z.infer<typeof aimCheckSchema>;

export const coverageGuidePayloadSchema = z.object({
  schema_version: z.string(),
  source_id: z.string().min(1),
  computed_at_ms: z.number(),
  valid_until_ms: z.number(),
  capture_skew_ms: z.number().nullable(),
  params: coverageParamsSchema.optional(),
  cameras: z.array(coverageCameraItemSchema).min(1),
  pairs: z.array(coveragePairItemSchema),
  connectivity: connectivitySchema,
  components: z.array(z.array(z.string().min(1))),
  guides: z.array(coverageGuideItemSchema),
  /** 1.3.0 부터. 옛 헬퍼(1.0.0~1.2.0)는 싣지 않는다(그때는 경고하지 않는다). */
  stage_a_readiness: stageAReadinessSchema.nullable().optional(),
  /** 1.4.0 부터. 기준(가장 최근 CALIBRATED 세팅)이 없거나 옛 헬퍼면 없다(그때는 지금 화면 그대로). */
  aim_check: aimCheckSchema.nullable().optional(),
});
export type CoverageGuidePayload = z.infer<typeof coverageGuidePayloadSchema>;

export const coverageRelayStatusSchema = z.enum(['EMPTY', 'OK', 'STALE']);
export type CoverageRelayStatus = z.infer<typeof coverageRelayStatusSchema>;

export const coverageGuidesResponseSchema = z.object({
  calibration_version: z.string().nullable().optional().default(null),
  guides: z.array(z.unknown()).optional().default([]),
  site_id: z.string().optional(),
  status: coverageRelayStatusSchema.optional().default('EMPTY'),
  stale: z.boolean().optional().default(false),
  active_demand: z.boolean().optional(),
  demand_ttl_ms: z.number().optional(),
  last_admin_query_at_ms: z.number().nullable().optional(),
  demand_until_ms: z.number().nullable().optional(),
  stale_after_ms: z.number().optional(),
  received_at_ms: z.number().nullable().optional().default(null),
  age_ms: z.number().nullable().optional().default(null),
  latest: coverageGuidePayloadSchema.nullable().optional().default(null),
});
export type CoverageGuidesResponse = z.infer<typeof coverageGuidesResponseSchema>;

export const cameraHeightDefaultsResponseSchema = z.object({
  site_id: z.string().min(1),
  height_tolerance_cm: z.number().positive(),
  camera_heights_m: z.record(z.string(), z.number().positive().nullable()),
  all_present: z.boolean(),
});
export type CameraHeightDefaultsResponse = z.infer<typeof cameraHeightDefaultsResponseSchema>;

export const setupSessionStageSchema = z.enum([
  'COLLECTING_BACKGROUND',
  'INITIAL_POSE_AND_WORLD',
  'JOINT_BA_AND_VERIFY',
  'PREVIEW_AND_VLM_DRAFT',
  'READY_FOR_ZONES',
  'BAKING_TEXTURE',
  'COMPLETED',
  'FAILED',
]);
export type SetupSessionStage = z.infer<typeof setupSessionStageSchema>;

export const heightCheckItemSchema = z.object({
  input_height_m: z.number(),
  restored_height_m: z.number().nullable().optional().default(null),
  difference_cm: z.number().nullable().optional().default(null),
  within_tolerance: z.boolean(),
  guidance: z.string().nullable().optional().default(null),
});
export type HeightCheckItem = z.infer<typeof heightCheckItemSchema>;

export const heightChecksSchema = z.record(z.string(), heightCheckItemSchema);
export type HeightChecksMap = z.infer<typeof heightChecksSchema>;

/**
 * 세팅이 왜 기다리는지(GET /api/setup-sessions/{id} 의 wait_reason, S15P31A101-583, docs/design/setup-wait-reason.md).
 * 서버가 이미 가진 상태(작업·대여·워커 대여 요청 시각·워커 반납 사유·Tier 0 health 지연·배경 수집률)로 고른다. 정상 진행이면 null.
 * 코드: NO_WORKER·WORKER_BUSY_OTHER_JOB·WAITING_FOR_WORKER·WORKER_PAUSED_TIER0·WORKER_NOT_POLLING·WORKER_STARTING·
 * BACKGROUND_INCOMPLETE. 서버가 뒤에 새 코드를 더해도 화면이 깨지지 않게 code 는 문자열로 받는다.
 */
export const setupWaitReasonSchema = z.object({
  code: z.string().min(1),
  since_ms: z.number(),
  waited_s: z.number().optional(),
  /** WORKER_PAUSED_TIER0 근거: 워커가 직접 반납(WORKER_RELEASE) 또는 Tier 0 health 지연 모름으로 추정(TIER0_HEALTH). */
  basis: z.string().nullable().optional().default(null),
  detail: z.string().nullable().optional().default(null),
  /** 최근 Tier 0 health 의 지연 최댓값(관측값, 참고). site_setup 은 지연이 높다는 것만으로는 막히지 않는다(S15P31A101-566). */
  tier0_lag_ms: z.number().nullable().optional().default(null),
  worker_last_seen_ms: z.number().nullable().optional().default(null),
  other_job_type: z.string().nullable().optional().default(null),
  previous_error_code: z.string().nullable().optional().default(null),
  cameras: z
    .array(z.object({ camera_id: z.string().min(1), collection_pct: z.number() }))
    .optional()
    .default([]),
});
export type SetupWaitReason = z.infer<typeof setupWaitReasonSchema>;

// ---- 맵 보강 촬영(S15P31A101-607, docs/design/S15P31A101-607-supplement-capture-flow.md) ----
// 세팅 세션 조회의 supplement 와 보강 촬영 업로드·다시 굽기 REST. 찍은 기기(휴대폰·액션캠·DSLR)는 등록 카메라가 아니다.

export const supplementMediaKindSchema = z.enum(['VIDEO', 'IMAGE']);
export type SupplementMediaKind = z.infer<typeof supplementMediaKindSchema>;

export const supplementSourceSchema = z.enum(['PHONE_UPLOAD', 'FILE_UPLOAD']);
export type SupplementSource = z.infer<typeof supplementSourceSchema>;

export const supplementMediaSchema = z.object({
  media_id: z.string().min(1),
  kind: supplementMediaKindSchema,
  source: supplementSourceSchema.nullable().optional().default(null),
  content_type: z.string().min(1),
  file_name: z.string().nullable().optional().default(null),
  size_bytes: z.number().int().positive(),
  sha256: z.string().nullable().optional().default(null),
  captured_at_ms: z.number().nullable().optional().default(null),
  device: z
    .object({ make: z.string().optional(), model: z.string().optional() })
    .nullable()
    .optional()
    .default(null),
  /** 서버가 올라온 것을 확인했으면 UPLOADED. 모르는 값이 와도 화면이 깨지지 않게 문자열로 받는다. */
  status: z.string().min(1),
  created_at_ms: z.number(),
  uploaded_at_ms: z.number().nullable().optional().default(null),
});
export type SupplementMedia = z.infer<typeof supplementMediaSchema>;

export const supplementUploadSchema = z.object({
  method: z.literal('PUT'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()),
  expires_at_ms: z.number(),
});
export type SupplementUpload = z.infer<typeof supplementUploadSchema>;

export const issuedSupplementMediaSchema = supplementMediaSchema.extend({
  upload: supplementUploadSchema,
});
export type IssuedSupplementMedia = z.infer<typeof issuedSupplementMediaSchema>;

export interface IssueSupplementMediaBody {
  content_type: string;
  size_bytes: number;
  sha256?: string;
  source?: SupplementSource;
  file_name?: string;
  captured_at_ms?: number;
  device?: { make?: string; model?: string };
}

export const supplementLimitsSchema = z.object({
  max_items: z.number().int().positive(),
  max_video_bytes: z.number().positive(),
  max_image_bytes: z.number().positive(),
  max_total_bytes: z.number().positive(),
  content_types: z.array(z.string()),
});
export type SupplementLimits = z.infer<typeof supplementLimitsSchema>;

export const supplementMediaResultSchema = z.object({
  media_id: z.string().min(1),
  status: z.string().min(1),
  frames_selected: z.number().int().nonnegative(),
  frames_registered: z.number().int().nonnegative(),
});
export type SupplementMediaResult = z.infer<typeof supplementMediaResultSchema>;

/** 워커가 알린 보조 촬영 결과 요약(계약 site_setup supplement_summary). 서버가 받은 그대로 준다. */
export const supplementSummarySchema = z.object({
  status: z.string().min(1),
  reason: z.string().nullable().optional().default(null),
  input_role: z.string().optional(),
  media_count: z.number().int().nonnegative(),
  frames_selected: z.number().int().nonnegative(),
  frames_registered: z.number().int().nonnegative(),
  captured_from_ms: z.number().nullable().optional(),
  captured_to_ms: z.number().nullable().optional(),
  alignment: z.record(z.string(), z.number().nullable()).nullable().optional(),
  media: z.array(supplementMediaResultSchema).optional().default([]),
});
export type SupplementSummary = z.infer<typeof supplementSummarySchema>;

export const supplementRebakeStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type SupplementRebakeStatus = z.infer<typeof supplementRebakeStatusSchema>;

export const supplementRebakeSchema = z.object({
  rebake_id: z.string().min(1),
  job_id: z.string().nullable().optional().default(null),
  status: supplementRebakeStatusSchema,
  stage: z.string().nullable().optional().default(null),
  progress_pct: z.number().min(0).max(100),
  media_ids: z.array(z.string()).optional().default([]),
  base_scene_version: z.string().nullable().optional().default(null),
  scene_version: z.string().nullable().optional().default(null),
  outcome: z.string().nullable().optional().default(null),
  reason: z.string().nullable().optional().default(null),
  result: supplementSummarySchema.nullable().optional().default(null),
  scene_activated: z.boolean().nullable().optional().default(null),
  failure_code: z.string().nullable().optional().default(null),
  failure_message: z.string().nullable().optional().default(null),
  requested_at_ms: z.number(),
  completed_at_ms: z.number().nullable().optional().default(null),
});
export type SupplementRebake = z.infer<typeof supplementRebakeSchema>;

export const supplementStateSchema = z.object({
  media: z.array(supplementMediaSchema).optional().default([]),
  limits: supplementLimitsSchema,
  can_upload: z.boolean(),
  can_rebake: z.boolean(),
  rebake_blocked_reason: z.string().nullable().optional().default(null),
  rebake: supplementRebakeSchema.nullable().optional().default(null),
});
export type SupplementState = z.infer<typeof supplementStateSchema>;
export type SupplementStateInput = z.input<typeof supplementStateSchema>;

/** 세팅 모드(-614): NEW 새 모델 · REUSE 이전 모델 재사용. */
export const setupModeSchema = z.enum(['NEW', 'REUSE']);
export type SetupMode = z.infer<typeof setupModeSchema>;

// ---- 보정 품질 게이트·카메라 확인(S15P31A101-646, docs/design/S15P31A101-646-setup-camera-check.md) ----
// 세션 조회의 quality_gate·camera_check 는 site_setup 1.14.0 원문이다. 화면은 판정·수치·문구만 느슨하게 읽고, 어긋난 값은 null 로 본다.

const checkProblemSchema = z
  .object({
    kind: z.string(),
    id: z.string(),
    camera_ids: z.array(z.string()).optional().default([]),
    reason: z.string(),
    message: z.string(),
  })
  .loose();
export type SetupCheckProblem = z.infer<typeof checkProblemSchema>;

export const qualityGateSchema = z
  .object({
    verdict: z.enum(['PASSED', 'NEEDS_CHECK', 'FAILED']),
    pairs: z.record(
      z.string(),
      z
        .object({
          camera_ids: z.array(z.string()),
          holdout_tracks: z.number(),
          median_px: z.number().nullable(),
          p90_px: z.number().nullable(),
          verdict: z.enum(['PASS', 'NEEDS_CHECK', 'FAIL']),
          reason: z.string().nullable(),
        })
        .loose(),
    ),
    problems: z.array(checkProblemSchema).optional().default([]),
  })
  .loose();
export type QualityGate = z.infer<typeof qualityGateSchema>;

export const cameraCheckSchema = z
  .object({
    /**
     * AWAITING_START(site_setup 1.19.0, -687): 보정이 끝나 「걷기 시작」을 기다린다(시도 없음). SKIPPED_REPLAY(1.20.0, -736): 녹화 재생
     * 시험이라 걷기 확인을 건너뛰었다(EC2 재생 시험 스위치 + 노트북 입력이 모두 녹화 파일일 때만).
     */
    status: z.enum([
      'AWAITING_START',
      'WAITING',
      'MEASURING',
      'PASSED',
      'FAILED',
      'INCOMPLETE',
      'SKIPPED_REPLAY',
    ]),
    calibration_version: z.string(),
    /** 지금(마지막) 확인 시도(-687). 「확인만 다시」마다 번호가 오른다. 1.18.0 이전 워커는 싣지 않는다. */
    attempt: z
      .object({
        no: z.number(),
        id: z.string(),
        started_at_ms: z.number(),
        expires_at_ms: z.number(),
      })
      .loose()
      .nullish()
      .catch(null),
    /** 워커가 관리자의 「걷기 시작」·「확인만 다시」를 기다리는 마감(-687, 워커 시계). 기다리지 않으면 없음. */
    user_wait: z.object({ until_ms: z.number(), wait_s: z.number() }).loose().nullish().catch(null),
    progress_pct: z.number(),
    elapsed_s: z.number(),
    pairs: z.record(
      z.string(),
      z
        .object({
          camera_ids: z.array(z.string()),
          required: z.boolean(),
          samples: z.number(),
          pass_rate: z.number().nullable(),
          residual_median_px: z.number().nullable(),
          verdict: z.enum(['PASS', 'FAIL', 'INSUFFICIENT', 'NOT_OVERLAPPING']),
        })
        .loose(),
    ),
    cameras: z.record(
      z.string(),
      z
        .object({
          observed_views: z.number(),
          loo_samples: z.number(),
          loo_median_px: z.number().nullable(),
          verdict: z.enum(['PASS', 'FAIL', 'INSUFFICIENT', 'NOT_OBSERVED']),
          /** 최근 1.5초 안에 이 카메라에 사람이 보였다(-687, 걷기 창 표시용). */
          person_visible: z.boolean().optional(),
        })
        .loose(),
    ),
    problems: z.array(checkProblemSchema).optional().default([]),
  })
  .loose();
export type CameraCheck = z.infer<typeof cameraCheckSchema>;

/**
 * 걷기 창이 쓰는 카메라 확인 단계(서버 camera_check_phase, -687). AWAITING_START 걷기 시작 대기 · STARTING 요청을 보냈고 워커가 아직
 * 시도를 열지 않음 · WALKING 시도 중 · RETRY_WAIT 실패해 확인만 다시 대기 · PASSED · SKIPPED_REPLAY 녹화 재생 시험이라 걷기 확인
 * 생략(-736) · FAILED(더는 다시 확인을 받지 않음).
 */
export const cameraCheckPhaseSchema = z.enum([
  'AWAITING_START',
  'STARTING',
  'WALKING',
  'RETRY_WAIT',
  'PASSED',
  'SKIPPED_REPLAY',
  'FAILED',
]);
export type CameraCheckPhase = z.infer<typeof cameraCheckPhaseSchema>;

/** 세팅 구역 상면 높이 차이 판정 요약(site_setup 1.15.0 zone_height_changes, S15P31A101-630). */
export const zoneHeightChangesSummarySchema = z
  .object({
    previous_scene_version: z.string().nullish().default(null),
    compared_scene_version: z.string().nullish().default(null),
    cell_m: z.number(),
    height_diff_threshold_m: z.number(),
    changed_area_ratio_threshold: z.number(),
    zones: z.array(zoneHeightChangeSchema).default([]),
  })
  .loose();
export type ZoneHeightChangesSummary = z.infer<typeof zoneHeightChangesSummarySchema>;

/**
 * 카메라 높이 빠른 확인(site_setup 1.17.0 height_review, S15P31A101-690). 초기 복원 뒤 카메라별 입력 높이 대비 상대 불일치.
 * 축척이 입력 높이의 중앙값이라 복원 높이는 독립 측정이 아니다(4대를 같은 배수로 틀리면 못 잡는다). LOW = 다른 카메라보다 낮게 보인다.
 */
export const heightReviewSchema = z.object({
  status: z.enum(['PASSED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CORRECTED', 'TIMED_OUT']),
  max_relative_diff: z.number().positive(),
  wait_s: z.number().nonnegative().optional(),
  camera_heights_m: z.record(z.string(), z.number().positive()),
  cameras: z.record(
    z.string(),
    z.object({
      restored_height_m: z.number().positive(),
      difference_cm: z.number(),
      relative_diff: z.number(),
      verdict: z.enum(['OK', 'LOW', 'HIGH']),
    }),
  ),
});
export type HeightReview = z.infer<typeof heightReviewSchema>;

/** 관리자의 카메라 높이 확인 결정(POST /api/setup-sessions/{id}/resume, -690). CONFIRMED = 실측이 맞음, CORRECTED = 고친 높이. */
export const heightDecisionSchema = z
  .object({
    decision: z.enum(['CONFIRMED', 'CORRECTED']),
    camera_heights_m: z.record(z.string(), z.number().positive()),
    decided_at_ms: z.number().optional(),
  })
  .loose();
export type HeightDecision = z.infer<typeof heightDecisionSchema>;

/** 세팅 배경 촬영 진행(site_setup 1.16.0 background_capture, S15P31A101-686). 세팅 시작 뒤 새로 찍은 표본 수와 카메라별 상태. */
export const backgroundCaptureSchema = z
  .object({
    since_ms: z.number(),
    required_samples: z.number().int().positive(),
    sample_interval_ms: z.number().optional(),
    cameras: z.record(
      z.string(),
      z
        .object({
          state: z.enum(['READY', 'INSUFFICIENT_SAMPLES', 'PERSON_OCCLUDED', 'NO_VIDEO']),
          sample_count: z.number().int().min(0),
          person_visible: z.boolean().nullish(),
        })
        .loose(),
    ),
  })
  .loose();
export type BackgroundCapture = z.infer<typeof backgroundCaptureSchema>;

export const setupSessionResponseSchema = z.object({
  setup_session_id: z.string().min(1),
  site_id: z.string().min(1),
  work_unit_id: z.number().int().positive(),
  retry_of: z.string().nullable().optional().default(null),
  job_id: z.string().nullable().optional().default(null),
  status: setupSessionStageSchema,
  stage: setupSessionStageSchema.optional(),
  progress_pct: z.number().min(0).max(100),
  camera_heights_m: z.record(z.string(), z.number().positive()),
  height_tolerance_cm: z.number().positive().optional(),
  background_collection_pct: z.record(z.string(), z.number()).optional(),
  /** 세팅 배경 촬영 진행(-686). 그 전 서버·워커는 싣지 않는다. 모양이 어긋나면 null */
  background_capture: backgroundCaptureSchema.nullish().catch(null),
  /** 카메라 높이 빠른 확인(-690). 그 전 서버·워커는 싣지 않는다. 모양이 어긋나면 null */
  height_review: heightReviewSchema.nullish().catch(null),
  /** 관리자의 높이 확인 결정(-690). 없으면 null */
  height_decision: heightDecisionSchema.nullish().catch(null),
  height_checks: heightChecksSchema.nullable().optional().default(null),
  height_warnings: z.array(z.string()).optional().default([]),
  object_cross_checks: z.unknown().nullable().optional(),
  calibration_version: z.string().nullable().optional().default(null),
  preview_scene_version: z.string().nullable().optional().default(null),
  scene_version: z.string().nullable().optional().default(null),
  config_version: z.string().nullable().optional().default(null),
  /** 그 세션 시작 뒤 그 현장의 첫 구역 발행(POST /api/zones/commit) 시각(ms). 없으면 null. */
  zones_committed_at: z.number().nullable().optional().default(null),
  zone_drafts_ref: z.string().nullable().optional().default(null),
  failure_code: z.string().nullable().optional().default(null),
  failure_message: z.string().nullable().optional().default(null),
  /** 작업 시작(LIVE)으로 정밀 굽기를 회수한 COMPLETED(site_setup 1.7.0, S15P31A101-597). 그 밖에는 null. 모르는 값은 null 로 본다 */
  bake_skipped: z.enum(['LIVE_WORK_STARTED']).nullish().catch(null),
  requested_by: z.number().nullable().optional(),
  started_at_ms: z.number().optional(),
  ready_at_ms: z.number().nullable().optional(),
  completed_at_ms: z.number().nullable().optional(),
  updated_at_ms: z.number().optional(),
  wait_reason: setupWaitReasonSchema.nullable().optional(),
  /** 맵 보강 촬영 상태(S15P31A101-607). 그 전 서버는 싣지 않는다. */
  supplement: supplementStateSchema.nullable().optional(),
  /** 실제로 따른 세팅 모드(-614): NEW 새 모델 · REUSE 이전 모델 재사용. 그 전 서버는 싣지 않는다(새 모델로 본다). */
  mode: setupModeSchema.nullish().catch(null),
  /** 처음 요청한 세팅 모드(-614). REUSE 를 요청했다가 새 모델로 이어 가면 mode 는 NEW 이고 이 값은 REUSE 로 남는다. 다시 시작할 때 이어 쓴다. */
  requested_mode: setupModeSchema.nullish().catch(null),
  /** 이 세션으로 세팅을 완료한 시각(C17, -615). 완료 전이면 null. 그 전 서버는 싣지 않는다. */
  setup_completed_at_ms: z.number().nullish(),
  /** World 다시 맞추기 판정 요약(-614). accepted 면 지금 관제 구역과 같은 World 라 기존 구역을 이어 쓸 수 있다. */
  world_anchor: z
    .object({
      accepted: z.boolean(),
      reason: z.string().nullish().catch(null),
      /** 거부일 때 직전 보정과 달라진 카메라(site_setup 1.18.0, S15P31A101-689). 모르면 없음 */
      changed_cameras: z.array(z.string()).nullish().catch(null),
    })
    .loose()
    .nullish()
    .catch(null),
  /** 보정 절대 품질 게이트(-646). 그 전 서버·워커는 싣지 않는다. 모양이 어긋나면 null */
  quality_gate: qualityGateSchema.nullish().catch(null),
  /** 세팅 카메라 확인(-646). 그 전 서버·워커는 싣지 않는다. 모양이 어긋나면 null */
  camera_check: cameraCheckSchema.nullish().catch(null),
  /** 서버 관문 판정(-646): PASSED 이고 그 확인의 보정이 세션 보정과 같다. 그 전 서버는 싣지 않는다(null) */
  camera_check_passed: z.boolean().nullish().catch(null),
  /**
   * 고른 맵의 묶음을 그대로 쓰는 재사용(S15P31A101-714): 그 맵을 만든 세팅·그 맵·시작 때 통과한 시점 확인. 그 밖(새 맵·옛 재사용)은 null.
   * 있으면 워커 작업이 없고(배경·보정·카메라 확인 걷기 없음) 바로 구역 단계로 간다.
   */
  reuse_source: z
    .object({
      setup_session_id: z.string(),
      scene_version: z.string().nullish().catch(null),
    })
    .loose()
    .nullish()
    .catch(null),
  /**
   * 세팅 완료를 막는 세션 쪽 이유(S15P31A101-688, 서버 SetupCompletionGate 와 같은 판정). 완료할 수 있으면 null.
   * SETUP_NOT_READY_TO_COMPLETE · SETUP_CAMERA_CHECK_NOT_PASSED · SETUP_FINAL_MAP_NOT_READY · SETUP_FINAL_MAP_SKIPPED.
   * 그 전 서버는 싣지 않는다(undefined, 화면이 같은 규칙으로 계산한다)
   */
  complete_blocked_reason: z.string().nullish().catch(null),
  /** 걷기 창 단계(-687). 그 전 서버는 싣지 않는다(null, 걷기 창 없이 시도 중으로만 본다) */
  camera_check_phase: cameraCheckPhaseSchema.nullish().catch(null),
  /** 관리자의 마지막 「걷기 시작」·「확인만 다시」 요청(-687). 없으면 null */
  camera_check_request: z.object({ attempt: z.number() }).loose().nullish().catch(null),
  /** 구역별 상면 높이 차이 판정 요약(-630). 그 전 서버·워커는 싣지 않는다(null) */
  zone_height_changes: zoneHeightChangesSummarySchema.nullish().catch(null),
  /**
   * 모델 생성을 멈추고 사람을 기다리는 까닭 코드. 멈추지 않았으면 null. 서버는 HEIGHT_CHECK(-690: 워커가 카메라 높이 확인을
   * 기다린다)와 CAMERA_CHECK(-687: 워커가 카메라 확인 걷기 시작·확인만 다시를 기다린다, 걷기 창이 받는다)를 낸다. 멈춘 세션은 단계(status)를 그대로 두고, 높이를 실어 POST /api/setup-sessions/{id}/resume 으로 멈춘 곳부터 이어 간다.
   */
  paused_reason: z.string().nullish().catch(null),
});
export type SetupSessionResponse = z.infer<typeof setupSessionResponseSchema>;

/** 세팅 완료가 관제 구역에 적용한 결과(zone_id 목록, POST /api/setup-sessions/{id}/complete). */
export const appliedZonesSchema = z.object({
  created: z.array(z.string()).default([]),
  updated: z.array(z.string()).default([]),
  kept: z.array(z.string()).default([]),
  archived: z.array(z.string()).default([]),
});
export type AppliedZones = z.infer<typeof appliedZonesSchema>;

/** 세팅 완료 응답: 세션 조회와 같은 모양 + applied_zones. */
export const completeSetupResponseSchema = setupSessionResponseSchema.extend({
  applied_zones: appliedZonesSchema,
});
export type CompleteSetupResponse = z.infer<typeof completeSetupResponseSchema>;

export interface CreateSetupSessionBody {
  work_unit_id: number;
  /** 새 맵에서만 쓴다. 이전 맵 재사용은 그 맵을 만들 때의 높이를 쓴다(S15P31A101-714). */
  camera_heights_m?: Record<string, number>;
  /** 생략하면 새 모델(NEW). */
  mode?: SetupMode;
  /** 이전 맵 재사용에서 고른 맵(그 맵을 만든 세팅 세션, S15P31A101-714). 생략하면 서버 추천 맵. */
  reuse_setup_session_id?: string;
}

export interface RetrySetupSessionBody {
  camera_heights_m?: Record<string, number>;
  /** 다시 시도할 방식(S15P31A101-689). 생략하면 처음 요청한 방식 그대로다. */
  mode?: SetupMode;
  /** 재사용으로 다시 시도할 때 고른 맵(S15P31A101-714). */
  reuse_setup_session_id?: string;
}

/**
 * 「이전 맵 재사용」을 지금 고를 수 있는지(GET /api/setup-sessions/reuse-check, S15P31A101-689).
 * blocked_reason: NO_SCENE(이전 맵 없음)·SCENE_MISMATCH(맵이 지금 보정과 다른 World)·CAMERA_CHANGED(직전 보정과 달라진 카메라).
 * camera_status: CHANGED·NOT_DETECTED(관제 감시가 달라진 카메라를 보지 못함, 또는 시점 확인이 4대 모두 같음)·UNKNOWN(근거 없음, 막지 않는다).
 * camera_source: TIER0_DRIFT(관제 회전 감시)·VIEW_MATCH(1단계 헬퍼가 이전 맵 사진과 지금 화면을 비교, S15P31A101-712)·LAST_SETUP_REJECTED.
 */
/**
 * 재사용 후보 맵 하나(S15P31A101-714). status: MATCH(4대 그때와 같은 자리, 고를 수 있음)·UNCONFIRMED(아직 모름: reason NO_RESULT·NO_PHOTOS·
 * CHECKING)·SHIFTED(조금 돌아간 카메라 shifted_cameras)·CHANGED(달라진 카메라 changed_cameras, camera_source VIEW_MATCH·TIER0_DRIFT)·
 * EXCLUDED(DB 사실로 가린 맵: reason CAMERA_CHECK_NOT_PASSED·NOT_COMPLETED·MAP_RETIRED·NO_CALIBRATION·CAMERAS_CHANGED).
 */
export const reuseCandidateSchema = z
  .object({
    setup_session_id: z.string(),
    scene_version: z.string().nullish().catch(null),
    completed_at_ms: z.number(),
    camera_heights_m: z.record(z.string(), z.number()).catch({}),
    status: z.enum(['MATCH', 'UNCONFIRMED', 'SHIFTED', 'CHANGED', 'EXCLUDED']).catch('UNCONFIRMED'),
    reason: z.string().nullish().catch(null),
    selectable: z.boolean().catch(false),
    recommended: z.boolean().catch(false),
    changed_cameras: z.array(z.string()).catch([]),
    shifted_cameras: z.array(z.string()).catch([]),
    unconfirmed_cameras: z.array(z.string()).catch([]),
    camera_source: z.string().nullish().catch(null),
  })
  .loose();
export type ReuseCandidate = z.infer<typeof reuseCandidateSchema>;

export const reuseCheckSchema = z.object({
  available: z.boolean(),
  /** NO_SCENE·CAMERA_CHANGED·VIEW_UNCONFIRMED(-714, 맞는지 아직 모름)·(옛 서버) SCENE_MISMATCH */
  blocked_reason: z.string().nullish().catch(null),
  scene_version: z.string().nullish().catch(null),
  camera_status: z.enum(['CHANGED', 'NOT_DETECTED', 'UNKNOWN']).catch('UNKNOWN'),
  changed_cameras: z.array(z.string()).catch([]),
  camera_source: z.string().nullish().catch(null),
  /** 지금 카메라와 가장 잘 맞는 맵(기본 선택, -714). 맞는 맵이 없거나 옛 서버면 null */
  recommended_setup_session_id: z.string().nullish().catch(null),
  /** 최근 완료 맵(순위 순, -714). 옛 서버는 싣지 않는다(빈 목록) */
  candidates: z.array(reuseCandidateSchema).optional().catch(undefined),
});
export type ReuseCheck = z.infer<typeof reuseCheckSchema>;

/** 멈춘 세팅을 이어 가기(POST /api/setup-sessions/{id}/resume): 높이 확인 창에서 확인하거나 고친 높이(-690). */
export interface ResumeSetupSessionBody {
  camera_heights_m: Record<string, number>;
}

// ---- VLM 구역 초안(GET /api/setup-sessions/{id}/zone-drafts, S15P31A101-455) ----

export const zoneDraftCandidateKindSchema = z.enum([
  'ELEVATED_WORK_SURFACE',
  'OPENING',
  'FLOOR_EDGE',
]);
export type ZoneDraftCandidateKind = z.infer<typeof zoneDraftCandidateKindSchema>;

export const zoneDraftEvalTypeSchema = z.enum(['GROUND_FOOTPRINT', 'VOLUME_3D']);
export type ZoneDraftEvalType = z.infer<typeof zoneDraftEvalTypeSchema>;

export const zoneDraftSeveritySchema = z.enum(['CRITICAL', 'HIGH']);
export type ZoneDraftSeverity = z.infer<typeof zoneDraftSeveritySchema>;

export const vlmOpinionStatusSchema = z.enum(['VLM', 'NO_OPINION']);
export type VlmOpinionStatus = z.infer<typeof vlmOpinionStatusSchema>;

export const zoneDraftObbSchema = z.object({
  center: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number(), z.number(), z.number()]),
  yaw_rad: z.number(),
});
export type ZoneDraftObb = z.infer<typeof zoneDraftObbSchema>;

export const zoneDraftPolygonPointSchema = z.tuple([z.number(), z.number()]);

export const zoneDraftItemSchema = z
  .object({
    draft_id: z.string().optional(),
    draft_index: z.number().int().nonnegative().optional(),
    candidate_id: z.string().min(1),
    candidate_kind: zoneDraftCandidateKindSchema,
    zone_kind: z.string().min(1).optional().default('HAZARD_AREA'),
    eval_type: zoneDraftEvalTypeSchema.optional().default('GROUND_FOOTPRINT'),
    polygon_xy: z.array(zoneDraftPolygonPointSchema).min(3),
    z_min_m: z.number(),
    z_max_m: z.number(),
    top_height_m: z.number().nullable().optional().default(null),
    obb: zoneDraftObbSchema.nullable().optional().default(null),
    recommended_name: z.string().min(1),
    recommended_severity: zoneDraftSeveritySchema,
    rationale: z.string(),
    vlm_status: vlmOpinionStatusSchema.optional().default('VLM'),
    evidence_cameras: z.array(z.string()).optional().default([]),
    confidence: z.number().min(0).max(1).nullable().optional().default(null),
  })
  .transform((item) => ({
    ...item,
    no_opinion: item.vlm_status === 'NO_OPINION',
  }));
export type ZoneDraftItem = z.infer<typeof zoneDraftItemSchema>;
export type ZoneDraftItemInput = z.input<typeof zoneDraftItemSchema>;

export const zoneDraftRunStatusSchema = z.enum([
  'NOT_REQUESTED',
  'QUEUED',
  'SUCCEEDED',
  'NO_OPINION',
  'FAILED',
]);
export type ZoneDraftRunStatus = z.infer<typeof zoneDraftRunStatusSchema>;

export const setupZoneDraftsResponseSchema = z.object({
  draft_run_id: z.string().nullable().optional().default(null),
  setup_session_id: z.string().min(1),
  site_id: z.string().min(1),
  calibration_version: z.string().nullable().optional().default(null),
  preview_scene_version: z.string().nullable().optional().default(null),
  safety_use: z.literal(false).optional().default(false),
  job_id: z.string().nullable().optional().default(null),
  status: zoneDraftRunStatusSchema,
  model_version: z.string().nullable().optional().default(null),
  prompt_version: z.string().nullable().optional().default(null),
  latency_ms: z.number().nullable().optional().default(null),
  error_code: z.string().nullable().optional().default(null),
  error_message: z.string().nullable().optional().default(null),
  created_at_ms: z.number().nullable().optional().default(null),
  completed_at_ms: z.number().nullable().optional().default(null),
  drafts: z.array(zoneDraftItemSchema).optional().default([]),
});
export type SetupZoneDraftsResponse = z.infer<typeof setupZoneDraftsResponseSchema>;
export type SetupZoneDraftsResponseInput = z.input<typeof setupZoneDraftsResponseSchema>;

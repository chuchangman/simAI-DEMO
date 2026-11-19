import { isDemoUser } from '@/features/demo/demoAccount';
import { completeMapBlockedReason } from '@/features/setup/setup';
import { SETUP_COMPLETE_ERROR_TEXT } from '@/features/setup/setupErrorMessage';
import {
  setupModeSchema,
  setupZoneDraftsResponseSchema,
  type CameraReceptionStatus,
  type Connectivity,
  type CoverageGuideItem,
  type CoverageGuidePayload,
  type CoveragePairItem,
  type CoverageRelayStatus,
  type CreateSetupSessionBody,
  type RetrySetupSessionBody,
  type ReuseCheck,
  type SetupMode,
  type SetupSessionResponse,
  type SetupZoneDraftsResponse,
  type SetupZoneDraftsResponseInput,
  type ZoneDraftItemInput,
} from '@/features/setup/types';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { createSupplementMock } from '@/mocks/setupSupplement';
import { http, HttpResponse } from 'msw/http';

// 현장 세팅 1단계 및 2단계 이후(GET /api/cameras/coverage-guides, GET /api/setup-sessions/camera-height-defaults,
// POST /api/setup-sessions, GET /api/setup-sessions/:id, POST /api/setup-sessions/:id/retry,
// GET /api/setup-sessions/:id/zone-drafts) MSW 핸들러(S15P31A101-447·-452·-448·-455·-453).

const DEFAULT_SITE_ID = 'classroom-1';
/** previewReadyAfterMs 가 지난 세션이 되는 모양(미리보기 맵·보정 버전이 생겨 구역 단계로 갈 수 있다). */
const PREVIEW_READY_PATCH = {
  status: 'PREVIEW_AND_VLM_DRAFT',
  stage: 'PREVIEW_AND_VLM_DRAFT',
  progress_pct: 92,
  preview_scene_version: 'scene-preview-1',
  calibration_version: 'cal-8',
} as const satisfies Partial<SetupSessionResponse>;
const DEFAULT_TOLERANCE_CM = 5.0;
const STALE_AFTER_MS = 10_000;
const DEMAND_TTL_MS = 15_000;

export interface BuildCoverageGuideOptions {
  cameraIds?: readonly string[];
  connectivity?: Connectivity;
  cameraStatuses?: Readonly<Record<string, CameraReceptionStatus>>;
  pairs?: readonly CoveragePairItem[];
  guides?: readonly CoverageGuideItem[];
  computedAtMs?: number;
}

export function buildCoverageGuidePayload(
  options: BuildCoverageGuideOptions = {},
): CoverageGuidePayload {
  const cameraIds = options.cameraIds ?? ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
  const computedAtMs = options.computedAtMs ?? 1_793_690_000_000;
  const connectivity = options.connectivity ?? 'CONNECTED';
  const cameraStatuses = options.cameraStatuses ?? {};

  const cameras = cameraIds.map((id, i) => {
    const status: CameraReceptionStatus = cameraStatuses[id] ?? 'OK';
    return {
      camera_id: id,
      status,
      frame_ts_ms: status === 'NO_VIDEO' ? null : computedAtMs - (i + 1) * 10,
    };
  });

  const [c0 = 'cam_A', c1 = 'cam_B', c2 = 'cam_C', c3 = 'cam_D'] = cameraIds;

  const defaultPairs: CoveragePairItem[] = [
    {
      a: c0,
      b: c1,
      raw_matches: 148,
      inliers: 64,
      inlier_ratio: 0.4324,
      grade: 'ENOUGH',
      centroid_a: [0.71, 0.52],
      centroid_b: [0.28, 0.5],
    },
    {
      a: c0,
      b: c2,
      raw_matches: 22,
      inliers: 4,
      inlier_ratio: 0.1818,
      grade: 'LACK',
      centroid_a: null,
      centroid_b: null,
    },
    {
      a: c0,
      b: c3,
      raw_matches: 120,
      inliers: 42,
      inlier_ratio: 0.35,
      grade: 'ENOUGH',
      centroid_a: [0.28, 0.51],
      centroid_b: [0.69, 0.49],
    },
    {
      a: c1,
      b: c2,
      raw_matches: 132,
      inliers: 51,
      inlier_ratio: 0.3864,
      grade: 'ENOUGH',
      centroid_a: [0.66, 0.55],
      centroid_b: [0.33, 0.54],
    },
    {
      a: c1,
      b: c3,
      raw_matches: 18,
      inliers: 2,
      inlier_ratio: 0.1111,
      grade: 'LACK',
      centroid_a: null,
      centroid_b: null,
    },
    {
      a: c2,
      b: c3,
      raw_matches: 80,
      inliers: 21,
      inlier_ratio: 0.2625,
      grade: 'WEAK',
      centroid_a: [0.79, 0.62],
      centroid_b: [0.16, 0.64],
    },
  ];

  const defaultGuides: CoverageGuideItem[] = [
    {
      camera_id: c2,
      pair: [c2, c3],
      direction: 'RIGHT',
      magnitude: 'SMALL',
      reason_code: 'WEAK_PAIR_EDGE_CLUSTER',
    },
  ];

  return {
    schema_version: '1.0.0',
    source_id: 'gw-lobby',
    computed_at_ms: computedAtMs,
    valid_until_ms: computedAtMs + STALE_AFTER_MS,
    capture_skew_ms: 18,
    params: {
      image_width_px: 1024,
      max_keypoints: 1024,
      ransac_threshold_px: 2.0,
      enough_min_inliers: 30,
      weak_min_inliers: 15,
      min_inlier_ratio: 0.1,
      intrinsics_source: 'STORED',
    },
    cameras,
    pairs: options.pairs ? [...options.pairs] : defaultPairs,
    connectivity,
    components: connectivity === 'CONNECTED' ? [[c0, c1, c2, c3]] : [[c0, c1, c2], [c3]],
    guides: options.guides ? [...options.guides] : defaultGuides,
  };
}

export function buildDefaultZoneDraftItems(): ZoneDraftItemInput[] {
  return [
    {
      draft_id: '019a0000-0000-7000-9000-000000000001',
      draft_index: 0,
      candidate_id: 'cand-opening-1',
      candidate_kind: 'OPENING',
      zone_kind: 'OPENING',
      eval_type: 'GROUND_FOOTPRINT',
      polygon_xy: [
        [7.0, 8.0],
        [8.6, 8.0],
        [8.6, 8.8],
        [7.0, 8.8],
      ],
      z_min_m: 0,
      z_max_m: 2.0,
      top_height_m: null,
      obb: null,
      recommended_name: '창가 개구부 추락 주의',
      recommended_severity: 'CRITICAL',
      rationale: '바닥 개구부 경계가 검출되어 추락 위험 구역으로 제안합니다.',
      vlm_status: 'VLM',
      evidence_cameras: ['cam_A', 'cam_B'],
      confidence: 0.86,
    },
    {
      draft_id: '019a0000-0000-7000-9000-000000000002',
      draft_index: 1,
      candidate_id: 'cand-surface-2',
      candidate_kind: 'ELEVATED_WORK_SURFACE',
      zone_kind: 'ELEVATED_WORK_SURFACE',
      eval_type: 'VOLUME_3D',
      polygon_xy: [
        [3.2, 0.3],
        [6.8, 0.3],
        [6.8, 1.3],
        [3.2, 1.3],
      ],
      z_min_m: 0,
      z_max_m: 2.2,
      top_height_m: 0.9,
      obb: {
        center: [5.0, 0.8, 0.45],
        size: [3.0, 0.6, 0.9],
        yaw_rad: 0,
      },
      recommended_name: '전면 단상 작업면 후보',
      recommended_severity: 'HIGH',
      rationale: '기하 단차 후보만 검출되었으며 AI 의견 없음(기본값)으로 표시합니다.',
      vlm_status: 'NO_OPINION',
      evidence_cameras: ['cam_C', 'cam_D'],
      confidence: null,
    },
  ];
}

export function buildSetupZoneDraftsResponse(
  setupSessionId: string,
  overrides: Partial<SetupZoneDraftsResponseInput> = {},
): SetupZoneDraftsResponse {
  return setupZoneDraftsResponseSchema.parse({
    draft_run_id: `draft-run-${setupSessionId}`,
    setup_session_id: setupSessionId,
    site_id: DEFAULT_SITE_ID,
    calibration_version: 'cal-8',
    preview_scene_version: 'scene-preview-1',
    safety_use: false,
    job_id: `job-vlm-${setupSessionId}`,
    status: 'SUCCEEDED',
    model_version: 'qwen2.5-vl-7b',
    prompt_version: 'zone-draft-v1',
    latency_ms: 1_840,
    error_code: null,
    error_message: null,
    created_at_ms: 1_793_690_010_000,
    completed_at_ms: 1_793_690_011_840,
    drafts: buildDefaultZoneDraftItems(),
    ...overrides,
  });
}

/**
 * 서버가 세팅을 실패로 끝내는 경우: 실패 코드마다 멈춘 시점의 진행률(서버는 stage 를 FAILED 로 덮어써서 마지막 진행률만 남는다)과
 * 서버 형식의 메시지(카메라 쌍은 DB 카메라 id). failSession 이 세션에 적용한다.
 */
export const SETUP_FAILURE_SCENARIOS = {
  INSUFFICIENT_FEATURES: {
    progress_pct: 40,
    failure_message: 'Insufficient raw feature matches on pair cam_B-cam_C: 7',
  },
  VALIDATION_REJECTED: {
    progress_pct: 40,
    failure_message:
      "Calibration validation rejected: worsened_pairs=['cam_A-cam_B', 'cam_C-cam_D']",
  },
  TIMEOUT: {
    progress_pct: 40,
    failure_message: 'Setup session timed out after 900 s',
  },
} as const;
export type SetupFailureScenario = keyof typeof SETUP_FAILURE_SCENARIOS;

export interface SetupMockState {
  siteId: string;
  heightToleranceCm: number;
  cameraHeightsM: Record<string, number | null>;
  guideStatus: CoverageRelayStatus;
  guideStale: boolean;
  guideError: boolean;
  latestGuide: CoverageGuidePayload | null;
}

export interface SetupMockOptions {
  now?: () => number;
  cameraHeightsM?: Record<string, number | null>;
  guideStatus?: CoverageRelayStatus;
  guideStale?: boolean;
  guideError?: boolean;
  latestGuide?: CoverageGuidePayload | null;
  /** GET /api/work-units/{id} 가 돌려줄 진행 중 세팅 세션 ID(새로고침 뒤 이어받기 시험). */
  workUnitSessionId?: string | null;
  /**
   * 개발 서버용: 세션을 시작한 지 이만큼(ms) 지나 처음 조회하면 미리보기 맵이 준비된 모양(PREVIEW_AND_VLM_DRAFT 92%)으로 바꿔 답한다.
   * 없으면 이 mock 은 세션을 저절로 진행시키지 않고 updateSession 으로만 바뀐다(시험).
   */
  previewReadyAfterMs?: number;
  /**
   * 조회할 때 시작 뒤 지난 시간으로 세션 단계를 넘긴다(개발 서버용, 시험은 끈다). 약 35초 뒤 COMPLETED 가 되어
   * 맵 보강 촬영 다시 굽기(S15P31A101-607)까지 mock 으로 해 볼 수 있다.
   */
  autoProgress?: boolean;
  /**
   * 새로 만든 세션을 새 모델 + World 이어짐(world_anchor.accepted)으로 둔다(S15P31A101-629). 구역 단계에 들어가면 지금 관제 구역
   * (bindLiveZones)을 확인 필요로 채운다. 없으면 World 끊김처럼 빈 목록에서 시작한다.
   */
  worldAnchorAccepted?: boolean;
  /**
   * GET /api/setup-sessions/reuse-check 응답(S15P31A101-689). 없으면 이전 맵이 없는 현장(NO_SCENE)이다. 서버처럼 세션 시작(mode REUSE)도
   * 이 값으로 막는다.
   */
  reuseCheck?: ReuseCheck;
  /**
   * autoProgress 의 맵 앞 카메라 확인 걷기(S15P31A101-687, 개발 서버용). 켜면 보정 뒤(9초) 단계를 멈추고 걷기 시작을 기다린다
   * (camera_check_phase AWAITING_START, paused_reason CAMERA_CHECK). POST .../camera-check/start 뒤 12초 걸으면 통과하고 멈췄던
   * 시간만큼 미뤄 미리보기·굽기로 이어 간다. 끄면 카메라 확인 값을 싣지 않는다(기존 시험).
   */
  cameraCheckWalk?: boolean;
  /** 걷기 시도 중 처음 이만큼은 표본 부족(INCOMPLETE)으로 끝나 「확인만 다시」를 기다린다(기본 0). */
  cameraCheckIncompleteAttempts?: number;
}

/** 목록 채우기(seed)가 읽는 지금 관제 구역(zone_id, 레이아웃 항목이면 layout_item_id). */
export interface SetupMockLiveZone {
  zone_id: string;
  layout_item_id?: string | null;
}

/**
 * autoProgress 카메라 확인 걷기(S15P31A101-687, cameraCheckWalk): 보정 등록 뒤(시작 9초) 맵 단계 전에 걷기 시작을 기다리고, 시작하면
 * 1초 뒤 걷는 중, 12초 뒤 결과다. 워커 대기 상한(600 s)을 user_wait 로 싣는다.
 */
const CAMERA_WALK = { awaitAt: 9_000, startingMs: 1_000, resultMs: 12_000, waitS: 600 } as const;

/** 서버(site_setup 1.13.0)와 같은 모양의 카메라 확인 값. 쌍은 세션 카메라 순서의 모든 쌍, 마주 보는 쌍은 시야가 겹치지 않는다. */
export function buildCameraCheck(
  cameraIds: readonly string[],
  calibrationVersion: string,
  status: NonNullable<SetupSessionResponse['camera_check']>['status'],
  progressPct = status === 'PASSED' ? 100 : 0,
): NonNullable<SetupSessionResponse['camera_check']> {
  const done = status === 'PASSED' || status === 'FAILED';
  const pairs: NonNullable<SetupSessionResponse['camera_check']>['pairs'] = {};
  cameraIds.forEach((a, i) => {
    cameraIds.slice(i + 1).forEach((b, k) => {
      const j = i + 1 + k;
      const neighbor = j - i === 1 || j - i === cameraIds.length - 1;
      const samples = Math.round((neighbor ? 60 : 0) * (progressPct / 100));
      const failedPair = status === 'FAILED' && i === 1 && j === 2;
      pairs[`${a}-${b}`] = {
        camera_ids: [a, b],
        required: neighbor,
        samples,
        pass_rate: samples > 0 ? (failedPair ? 0.58 : 0.93) : null,
        residual_median_px: samples > 0 ? (failedPair ? 9.4 : 3.1) : null,
        verdict: !neighbor
          ? 'NOT_OVERLAPPING'
          : failedPair && done
            ? 'FAIL'
            : done
              ? 'PASS'
              : 'INSUFFICIENT',
      };
    });
  });
  const cameras = Object.fromEntries(
    cameraIds.map((c) => [
      c,
      {
        observed_views: Math.round(150 * (progressPct / 100)),
        loo_samples: Math.round(90 * (progressPct / 100)),
        loo_median_px: progressPct > 0 ? 2.4 : null,
        verdict: (done ? 'PASS' : progressPct > 20 ? 'INSUFFICIENT' : 'NOT_OBSERVED') as
          'PASS' | 'INSUFFICIENT' | 'NOT_OBSERVED',
      },
    ]),
  );
  const [first, second, third] = cameraIds;
  return {
    status,
    calibration_version: calibrationVersion,
    progress_pct: progressPct,
    elapsed_s: Math.round((progressPct / 100) * 40),
    pairs,
    cameras,
    problems:
      status === 'FAILED' && second && third
        ? [
            {
              kind: 'PAIR',
              id: `${second}-${third}`,
              camera_ids: [second, third],
              reason: 'PASS_RATE_LOW',
              message: `${second}–${third}: 두 카메라가 같은 사람을 같은 위치로 보지 못했습니다(통과율 58% < 75%)`,
            },
          ]
        : status === 'INCOMPLETE' && first
          ? [
              {
                kind: 'CHECK',
                id: 'camera_check',
                camera_ids: [],
                reason: 'NOT_FINISHED',
                message:
                  '카메라 확인을 마치지 못했습니다. 한 사람이 모든 카메라에 보이도록 걸어야 합니다',
              },
            ]
          : [],
  };
}

/** 서버와 같은 모양의 보정 품질 게이트(옆 4쌍 홀드아웃 통과, 높이 차 1 cm). */
export function buildQualityGate(
  cameraIds: readonly string[],
): NonNullable<SetupSessionResponse['quality_gate']> {
  const pairs: NonNullable<SetupSessionResponse['quality_gate']>['pairs'] = {};
  cameraIds.forEach((a, i) => {
    const b = cameraIds[(i + 1) % cameraIds.length];
    if (!b || b === a) return;
    pairs[`${a}-${b}`] = {
      camera_ids: [a, b],
      holdout_tracks: 40,
      median_px: 0.45 + i * 0.1,
      p90_px: 0.9 + i * 0.2,
      verdict: 'PASS',
      reason: null,
    };
  });
  return { verdict: 'PASSED', pairs, problems: [] };
}

/** autoProgress 단계표: 시작 뒤 이 시각(ms)부터 그 단계. */
const AUTO_STAGES: readonly { at: number; stage: SetupSessionResponse['status']; pct: number }[] = [
  { at: 0, stage: 'COLLECTING_BACKGROUND', pct: 0 },
  { at: 4_000, stage: 'INITIAL_POSE_AND_WORLD', pct: 15 },
  { at: 7_000, stage: 'JOINT_BA_AND_VERIFY', pct: 40 },
  { at: 10_000, stage: 'PREVIEW_AND_VLM_DRAFT', pct: 65 },
  { at: 13_000, stage: 'READY_FOR_ZONES', pct: 85 },
  { at: 25_000, stage: 'BAKING_TEXTURE', pct: 85 },
  { at: 35_000, stage: 'COMPLETED', pct: 100 },
];

/**
 * autoProgress 멈춤(카메라 높이 빠른 확인, site_setup 1.17.0 height_review, -690): 처음 높이 기본값을 현장의 실제 높이로 보고,
 * 입력이 실제와 이 비율 넘게 다르면 3D 공간을 만든 직후(39%) 높이 확인을 기다린다(paused_reason HEIGHT_CHECK, 워커 기준 3% 와 같다).
 */
const MOCK_HEIGHT_REVIEW_MAX_RELATIVE = 0.03;
/** 높이 확인을 기다리는 진행률(3D 공간·좌표계 단계 끝 직전). */
const MOCK_PAUSE_PCT = 39;
/** 워커가 기다리는 상한(초). */
const MOCK_HEIGHT_REVIEW_WAIT_S = 180;

export interface RetrySetupRecord {
  sessionId: string;
  retriedSessionId: string;
  body: RetrySetupSessionBody;
  /** 다시 시도에 실어 보낸 방식(S15P31A101-689). 보내지 않았으면 없음. */
  mode?: SetupMode;
}

/** 이전 맵이 없는 현장의 재사용 판정(목업 기본값). */
export const NO_SCENE_REUSE_CHECK: ReuseCheck = {
  available: false,
  blocked_reason: 'NO_SCENE',
  scene_version: null,
  camera_status: 'UNKNOWN',
  changed_cameras: [],
  camera_source: null,
};

/** 세팅 대표 프레임처럼 보이는 가짜 사진(SVG 데이터 주소). after 면 단상 위 상자가 치워진 모습이다. */
function mockSetupFrame(after: boolean): string {
  const box = after
    ? ''
    : '<rect x="300" y="250" width="120" height="90" fill="#b07a3c" stroke="#5a3a17" stroke-width="3"/>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">` +
    `<rect width="640" height="480" fill="#d9dde3"/>` +
    `<polygon points="0,300 640,300 640,480 0,480" fill="#a9b0ba"/>` +
    `<rect x="240" y="330" width="240" height="60" fill="#7c8592"/>` +
    box +
    `<text x="16" y="32" font-size="22" fill="#334">${after ? '이번 세팅' : '이전 세팅'} · cam_A</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 변경 의심 구역 AI 의견 예시(S15P31A101-631). 첫 변경 의심 구역은 의견(삭제 권고), 나머지는 의견 없음. */
function mockZoneOpinion(zoneId: string, zones: readonly { zone_id: string; status: string }[]) {
  const first = zones.find((z) => z.status === 'CHANGE_SUSPECTED')?.zone_id === zoneId;
  const photos = {
    camera_id: 'cam_A',
    before: { image_url: mockSetupFrame(false), crop_box_norm: [0.3, 0.4, 0.8, 0.9] },
    after: { image_url: mockSetupFrame(true), crop_box_norm: [0.3, 0.4, 0.8, 0.9] },
    image_expires_at_ms: Date.now() + 5 * 60_000,
  };
  return first
    ? {
        status: 'OPINION',
        reason: null,
        recommended_action: 'REMOVE',
        rationale: '단상 위 상자가 치워져 바닥만 남았습니다. 구역 삭제를 검토하세요.',
        confidence: 0.7,
        model_version: 'nvidia/Cosmos-Reason2-2B',
        ...photos,
      }
    : {
        status: 'NO_OPINION',
        reason: 'VLM_FAILED',
        recommended_action: null,
        rationale: null,
        confidence: null,
        model_version: null,
        ...photos,
      };
}

export function createSetupMock(options: SetupMockOptions = {}) {
  const { now = Date.now } = options;
  const state: SetupMockState = {
    siteId: DEFAULT_SITE_ID,
    heightToleranceCm: DEFAULT_TOLERANCE_CM,
    cameraHeightsM: options.cameraHeightsM
      ? { ...options.cameraHeightsM }
      : { cam_A: 2.7, cam_B: 2.7, cam_C: 2.7, cam_D: 2.7 },
    guideStatus: options.guideStatus ?? 'OK',
    guideStale: options.guideStale ?? options.guideStatus === 'STALE',
    guideError: options.guideError ?? false,
    latestGuide:
      options.latestGuide !== undefined ? options.latestGuide : buildCoverageGuidePayload(),
  };

  // 멈춤 판정의 기준인 현장 실제 높이(처음 기본값)와, 멈춘 세션의 멈춘 시각(이어 가면 그만큼 시작 시각을 미룬다).
  const actualHeightsM = { ...state.cameraHeightsM };
  const pausedAt = new Map<string, number>();
  // 카메라 확인 걷기(-687): 단계를 멈춘 시각(통과하면 그만큼 시작 시각을 미룬다)과 지금 시도의 시작 시각·번호
  const walkPausedAt = new Map<string, number>();
  const walkAttempts = new Map<string, { at: number; attempt: number }>();

  const submittedBodies: CreateSetupSessionBody[] = [];
  // 서버처럼 작업의 지금 세팅 세션(work_unit.active_setup_session_id)은 세션을 만들거나 다시 시도하면 그 세션이 된다(작업마다).
  // 한 번도 만들지 않은 작업은 workUnitSessionId(이어받기 시험)를 돌려준다
  const workUnitSessions = new Map<number, string>();
  const reuseCheck = (): ReuseCheck => options.reuseCheck ?? NO_SCENE_REUSE_CHECK;
  /**
   * 서버처럼(SetupReuseCheck open·SetupDemoAccounts) 시연 계정은 제외(EXCLUDED)가 아닌 맵을 모두 고르고 추천이 없다.
   * 후보 목록이 없는 옛 응답 모양은 그대로 둔다.
   */
  const reuseCheckFor = (userId: string): ReuseCheck => {
    const check = reuseCheck();
    if (!isDemoUser(userId) || !check.candidates) return check;
    const candidates = check.candidates.map((c) => ({
      ...c,
      selectable: c.status !== 'EXCLUDED',
      recommended: false,
    }));
    const usable = candidates.some((c) => c.selectable);
    return {
      ...check,
      available: usable,
      blocked_reason: usable ? null : 'NO_SCENE',
      recommended_setup_session_id: null,
      candidates,
    };
  };
  /** 고른 맵이 없을 때 시작할 맵: 추천, 시연 계정이면(추천 없음) 가장 최근에 완료된 맵 */
  const defaultReuseMapId = (check: ReuseCheck): string | null | undefined =>
    check.recommended_setup_session_id ??
    [...(check.candidates ?? [])]
      .filter((c) => c.selectable)
      .sort((a, b) => b.completed_at_ms - a.completed_at_ms)[0]?.setup_session_id;
  const reuseBlockedProblem = (check: ReuseCheck = reuseCheck()) => {
    const blocked = check.blocked_reason;
    if (check.available) return null;
    if (blocked === 'CAMERA_CHANGED')
      return problem(
        409,
        'SETUP_REUSE_CAMERA_CHANGED',
        '카메라가 직전 세팅과 달라져 이전 맵을 재사용할 수 없습니다',
      );
    if (blocked === 'SCENE_MISMATCH')
      return problem(
        409,
        'SETUP_REUSE_SCENE_MISMATCH',
        '현재 관제 맵이 지금 보정과 다른 World 입니다',
      );
    return problem(
      409,
      'SETUP_REUSE_SCENE_MISSING',
      '현재 관제 맵(Scene)과 그 보정이 있어야 이전 모델을 재사용할 수 있습니다',
    );
  };
  const retryRequests: RetrySetupRecord[] = [];
  const sessions = new Map<string, SetupSessionResponse>();
  const zoneDraftsBySession = new Map<string, SetupZoneDraftsResponse>();
  let seq = 0;

  function updateSession(
    sessionId: string,
    patch: Partial<SetupSessionResponse>,
  ): SetupSessionResponse {
    const current = sessions.get(sessionId);
    if (!current) {
      throw new Error(`Setup session not found in mock: ${sessionId}`);
    }
    const updated: SetupSessionResponse = {
      ...current,
      ...patch,
      updated_at_ms: now(),
    };
    sessions.set(sessionId, updated);
    return updated;
  }

  /** 세션을 서버가 실패시킨 것처럼 FAILED 로 바꾼다(실패 코드·메시지·멈춘 진행률은 SETUP_FAILURE_SCENARIOS). */
  function failSession(sessionId: string, scenario: SetupFailureScenario): SetupSessionResponse {
    const { progress_pct, failure_message } = SETUP_FAILURE_SCENARIOS[scenario];
    return updateSession(sessionId, {
      status: 'FAILED',
      stage: 'FAILED',
      progress_pct,
      failure_code: scenario,
      failure_message,
    });
  }

  /** previewReadyAfterMs 옵션이 있고 수집 중인 세션이 그 시간이 지났으면 미리보기 맵이 준비된 모양으로 바꾼다. */
  function advanceIfDue(session: SetupSessionResponse, t: number): SetupSessionResponse {
    const { previewReadyAfterMs } = options;
    if (previewReadyAfterMs === undefined || session.status !== 'COLLECTING_BACKGROUND') {
      return session;
    }
    if (t - (session.started_at_ms ?? t) < previewReadyAfterMs) return session;
    return updateSession(
      session.setup_session_id,
      session.mode === 'REUSE'
        ? { ...PREVIEW_READY_PATCH, preview_scene_version: null }
        : PREVIEW_READY_PATCH,
    );
  }

  /**
   * 세팅 세션의 구역을 발행했을 때(POST /api/zones/commit 의 setup_session_id) 세팅에 보이는 일: 아직 안 끝난 세션을 COMPLETED 로
   * 보내고 구역을 처음 발행한 시각(zones_committed_at)을 남긴다(개발 서버에서 굽기 끝을 기다리지 않게). 새 모델이면 정밀 맵도 끝난
   * 것으로 둔다(세팅 완료는 정밀 맵 뒤에만 된다, -688). 작업 관리의 '세팅 끝'(SETUP_DONE)은 이것이 아니라 세팅 완료
   * (POST .../complete, -615)의 setup_completed_at_ms 로 정한다(서버와 같음). 없는 세션·실패한 세션은 그대로 둔다.
   */
  function completeAfterZonesCommit(sessionId: string, at: number = now()): void {
    const session = sessions.get(sessionId);
    if (!session || session.status === 'FAILED') return;
    updateSession(sessionId, {
      status: 'COMPLETED',
      stage: 'COMPLETED',
      progress_pct: 100,
      scene_version:
        session.mode === 'REUSE'
          ? null
          : (session.scene_version ?? `scene-setup-${session.setup_session_id.slice(-4)}`),
      zones_committed_at: session.zones_committed_at ?? at,
      completed_at_ms: session.completed_at_ms ?? at,
    });
  }

  const supplement = createSupplementMock({ now, sessions, updateSession });

  /** 새 세션의 모드 칸. mode 는 실제로 따른 모드, requested_mode 는 요청한 모드다(새 모델로 바뀌는 경우는 흉내 내지 않는다). */
  const modePatch = (mode: SetupMode): Partial<SetupSessionResponse> => ({
    mode,
    requested_mode: mode,
  });

  /**
   * 카메라 확인 관문(-646, 서버 SetupCameraCheck.passed). 서버는 확인 결과가 없어도 막지만, 이 mock 은 카메라 확인 값을 실은
   * 세션만 막는다(그 값을 싣지 않는 기존 화면 시험이 그대로 돌게). 개발 서버(autoProgress)는 보정 뒤 값을 싣는다.
   */
  const cameraCheckBlocks = (session: SetupSessionResponse) =>
    session.camera_check != null && session.camera_check_passed !== true;
  const cameraCheckProblem = () =>
    problem(
      409,
      'SETUP_CAMERA_CHECK_NOT_PASSED',
      '카메라 확인을 통과하지 않았습니다. 한 사람이 30~60초 걸어 카메라 확인을 마치거나, 실패했으면 다시 보정하세요',
    );

  /** 새 세션의 World 다시 맞추기 판정(옵션이 있을 때만 싣는다). */
  const anchorPatch = (): Partial<SetupSessionResponse> =>
    options.worldAnchorAccepted ? { world_anchor: { accepted: true } } : {};
  /** 목록 채우기가 읽는 지금 관제 구역. 개발 서버는 구역 mock 을 잇는다(bindLiveZones), 시험은 기본 빈 목록. */
  let liveZones: () => readonly SetupMockLiveZone[] = () => [];
  // simAI-DEMO: 세팅 완료가 새 구역을 관제 구역 mock 에 더한다
  let applyZones: (fields: readonly unknown[]) => void = () => {};
  /** 확인 필요(needs_review)를 서버처럼 정리한다: 이어 쓰는 구역을 고치지 않은 항목만 true 를 남긴다. */
  const normalizeReview = (item: unknown): unknown => {
    const record = item as Record<string, unknown>;
    const review =
      record.needs_review === true &&
      record.zone_id != null &&
      record.zone == null &&
      record.surface == null;
    return { ...record, needs_review: review };
  };
  const pendingOf = (id: string) =>
    (zonePlans.get(id)?.items ?? []).filter(
      (item) => (item as Record<string, unknown>).needs_review === true,
    ).length;

  /** 세션별 구역 목록(-612). 저장한 적이 없으면 없다(빈 목록·revision 0). */
  const zonePlans = new Map<string, { items: unknown[]; revision: number; updatedAt: number }>();
  const planView = (id: string) => {
    const stored = zonePlans.get(id);
    const session = sessions.get(id);
    const zh = session?.zone_height_changes ?? null;
    const byZoneId = new Map((zh?.zones ?? []).map((z) => [z.zone_id, z]));
    const items = (stored?.items ?? []).map((raw) => {
      const item = raw as Record<string, unknown>;
      const zoneId = typeof item.zone_id === 'string' ? item.zone_id : null;
      if (!zh || !zoneId) return item;
      const found = byZoneId.get(zoneId) ?? {
        zone_id: zoneId,
        status: 'UNKNOWN' as const,
        reason: 'INSUFFICIENT_COVERAGE',
        changed_area_ratio: null,
        max_height_diff_m: null,
        max_diff_xy: null,
        total_cells: 0,
        compared_cells: 0,
        changed_cells: null,
      };
      // 변경 의심 구역은 AI 의견과 전후 사진 예시를 붙인다(S15P31A101-631). 첫 구역은 의견, 그 밖은 의견 없음(사유)
      const ai_opinion =
        found.status === 'CHANGE_SUSPECTED' ? mockZoneOpinion(zoneId, zh.zones) : undefined;
      return { ...item, height_change: found, ...(ai_opinion ? { ai_opinion } : {}) };
    });
    return {
      setup_session_id: id,
      items,
      revision: stored?.revision ?? 0,
      updated_at: stored?.updatedAt ?? null,
      zone_height_changes: zh,
    };
  };
  /** 완료가 적용한 것처럼 목록을 나눈다(개발 서버는 관제 구역 mock 을 바꾸지 않는다). 새 구역은 임시 zone_id 를 준다. */
  const appliedOf = (id: string) => {
    const items = zonePlans.get(id)?.items ?? [];
    const created: string[] = [];
    const updated: string[] = [];
    const kept: string[] = [];
    items.forEach((item, index) => {
      const zoneId = Reflect.get(item as object, 'zone_id');
      if (typeof zoneId !== 'string') created.push(`z-setup-${id.slice(-4)}-${index}`);
      else if (Reflect.get(item as object, 'zone') != null) updated.push(zoneId);
      else kept.push(zoneId);
    });
    return { created, updated, kept, archived: [] as string[] };
  };

  /** 걷기 대기 마감(user_wait). 목업은 대기 상한을 그대로 싣는다. */
  const walkWait = () => ({
    until_ms: now() + CAMERA_WALK.waitS * 1000,
    wait_s: CAMERA_WALK.waitS,
  });

  /** 보정 뒤 맵 단계 전에 걷기 시작을 기다린다(-687). 이미 확인했거나 기다리는 중이면 null. */
  function awaitWalkStart(session: SetupSessionResponse, elapsed: number) {
    if (!options.cameraCheckWalk || elapsed < CAMERA_WALK.awaitAt || session.camera_check_phase)
      return null;
    const advanced = progressStage(session, CAMERA_WALK.awaitAt - 1);
    const calibration = advanced.calibration_version;
    if (!calibration) return null;
    const cams = Object.keys(session.camera_heights_m);
    // 조회가 늦어도 단계는 보정 직후(awaitAt)에 멈춘 것으로 본다(통과하면 그 뒤부터 이어 간다)
    walkPausedAt.set(
      session.setup_session_id,
      (session.started_at_ms ?? now()) + CAMERA_WALK.awaitAt,
    );
    return updateSession(session.setup_session_id, {
      status: 'JOINT_BA_AND_VERIFY',
      stage: 'JOINT_BA_AND_VERIFY',
      progress_pct: 65,
      quality_gate: advanced.quality_gate ?? buildQualityGate(cams),
      camera_check: {
        ...buildCameraCheck(cams, calibration, 'AWAITING_START'),
        user_wait: walkWait(),
      },
      camera_check_passed: false,
      camera_check_phase: 'AWAITING_START',
      paused_reason: 'CAMERA_CHECK',
    });
  }

  /** 걷기 시도 진행(-687): 시작하는 중 → 걷는 중(카메라별 사람 보임이 번갈아 바뀜) → 통과 또는 표본 부족. */
  function progressWalk(session: SetupSessionResponse): SetupSessionResponse {
    const id = session.setup_session_id;
    const walk = walkAttempts.get(id);
    const calibration = session.calibration_version;
    if (!walk || !calibration) return session;
    const cams = Object.keys(session.camera_heights_m);
    const t = now() - walk.at;
    const attempt = {
      no: walk.attempt,
      id: `mock-${walk.attempt}`,
      started_at_ms: walk.at,
      expires_at_ms: walk.at + 150_000,
    };
    if (t < CAMERA_WALK.startingMs) return session;
    if (t < CAMERA_WALK.resultMs) {
      const pct = Math.min(99, Math.round((t / CAMERA_WALK.resultMs) * 100));
      const check = buildCameraCheck(cams, calibration, 'MEASURING', pct);
      const tick = Math.floor(t / 1000);
      cams.forEach((c, i) => {
        const cam = check.cameras[c];
        if (cam) cam.person_visible = (tick + i) % 3 !== 0;
      });
      return updateSession(id, {
        camera_check: { ...check, attempt },
        camera_check_phase: 'WALKING',
        paused_reason: null,
      });
    }
    walkAttempts.delete(id);
    if (walk.attempt <= (options.cameraCheckIncompleteAttempts ?? 0)) {
      const last = cams[cams.length - 1] ?? 'cam_D';
      const check = buildCameraCheck(cams, calibration, 'INCOMPLETE', 70);
      const lastCam = check.cameras[last];
      if (lastCam) lastCam.observed_views = 14;
      return updateSession(id, {
        camera_check: {
          ...check,
          attempt,
          user_wait: walkWait(),
          problems: [
            {
              kind: 'CAMERA',
              id: last,
              camera_ids: [last],
              reason: 'FEW_SAMPLES',
              message: `${last} 에서 사람이 충분히 보이지 않았습니다(14/30). 표시된 구간을 지나며 30초만 다시 걸어 주세요`,
            },
          ],
        },
        camera_check_phase: 'RETRY_WAIT',
        paused_reason: 'CAMERA_CHECK',
      });
    }
    const pausedSince = walkPausedAt.get(id) ?? now();
    walkPausedAt.delete(id);
    return updateSession(id, {
      camera_check: { ...buildCameraCheck(cams, calibration, 'PASSED'), attempt },
      camera_check_passed: true,
      camera_check_phase: 'PASSED',
      paused_reason: null,
      started_at_ms: (session.started_at_ms ?? now()) + (now() - pausedSince),
    });
  }

  /**
   * 카메라별 높이 확인(height_review.cameras). 복원 높이는 실제 높이(목업이 아는 값)이고, 축척이 입력의 중앙값이라 실제로는
   * 상대 불일치만 잡는다(목업은 실제 높이를 그대로 쓴다).
   */
  function heightReviewCameras(heights: Readonly<Record<string, number>>) {
    return Object.fromEntries(
      Object.entries(heights).map(([cameraId, input]) => {
        const restored = actualHeightsM[cameraId] ?? input;
        const rel = (restored - input) / input;
        const verdict =
          Math.abs(rel) <= MOCK_HEIGHT_REVIEW_MAX_RELATIVE ? 'OK' : rel < 0 ? 'LOW' : 'HIGH';
        return [
          cameraId,
          {
            restored_height_m: restored,
            difference_cm: Math.round((restored - input) * 1000) / 10,
            relative_diff: Math.round(rel * 100000) / 100000,
            verdict,
          } as const,
        ];
      }),
    );
  }

  /** 3D 공간을 만든 직후 높이가 서로 맞지 않으면 높이 확인을 기다린다(한 세션에 한 번, 확인 뒤에는 다시 묻지 않는다). */
  function pauseIfHeightsOff(session: SetupSessionResponse, elapsed: number) {
    const verifyAt = AUTO_STAGES.find((s) => s.stage === 'JOINT_BA_AND_VERIFY')!.at;
    if (elapsed < verifyAt || session.calibration_version || session.height_review) return null;
    const cameras = heightReviewCameras(session.camera_heights_m);
    const off = Object.values(cameras).some((c) => c.verdict !== 'OK');
    if (!off) return null;
    pausedAt.set(session.setup_session_id, now());
    return updateSession(session.setup_session_id, {
      status: 'INITIAL_POSE_AND_WORLD',
      stage: 'INITIAL_POSE_AND_WORLD',
      progress_pct: MOCK_PAUSE_PCT,
      paused_reason: 'HEIGHT_CHECK',
      height_review: {
        status: 'AWAITING_CONFIRMATION',
        max_relative_diff: MOCK_HEIGHT_REVIEW_MAX_RELATIVE,
        wait_s: MOCK_HEIGHT_REVIEW_WAIT_S,
        camera_heights_m: { ...session.camera_heights_m },
        cameras,
      },
    });
  }

  /** autoProgress: 시작 뒤 지난 시간만큼 단계를 앞으로만 넘긴다. 실패·취소한 세션과 멈춘 세션은 두지 않는다. */
  function progressSession(session: SetupSessionResponse): SetupSessionResponse {
    if (
      !options.autoProgress ||
      session.status === 'FAILED' ||
      session.paused_reason ||
      session.started_at_ms === undefined
    ) {
      return session;
    }
    // 걷기 시도 중(-687)에는 맵 단계가 흐르지 않는다
    if (session.camera_check_phase === 'STARTING' || session.camera_check_phase === 'WALKING')
      return progressWalk(session);
    const elapsed = now() - session.started_at_ms;
    const paused = pauseIfHeightsOff(session, elapsed);
    if (paused) return paused;
    const walkPause = awaitWalkStart(session, elapsed);
    if (walkPause) return walkPause;
    return progressStage(session, elapsed);
  }

  function progressStage(session: SetupSessionResponse, elapsed: number): SetupSessionResponse {
    const target = [...AUTO_STAGES].reverse().find((s) => elapsed >= s.at);
    const order = AUTO_STAGES.map((s) => s.stage);
    if (!target || order.indexOf(target.stage) < order.indexOf(session.status)) return session;
    const idx = order.indexOf(target.stage);
    const next = AUTO_STAGES[idx + 1];
    // 목업의 완료한 하위 작업 수를 1초 칸으로 센다(실제 화면은 서버 값을 보간하지 않는다).
    const steps = next ? Math.max(1, Math.ceil((next.at - target.at) / 1000)) : 1;
    const completed = next ? Math.min(steps - 1, Math.floor((elapsed - target.at) / 1000)) : 0;
    const endPct = target.stage === 'BAKING_TEXTURE' ? 95 : (next?.pct ?? target.pct);
    const pct = target.pct + (endPct - target.pct) * (completed / steps);
    if (target.stage === session.status && pct <= session.progress_pct) return session;
    // 이전 모델 재사용은 새 맵을 만들지 않아 미리보기·정식 맵 버전이 없다(서버와 같다).
    const bakes = session.mode !== 'REUSE';
    const n = session.setup_session_id.slice(-4);
    const cams = Object.keys(session.camera_heights_m);
    return updateSession(session.setup_session_id, {
      status: target.stage,
      stage: target.stage,
      progress_pct: Math.round(pct * 10) / 10,
      background_collection_pct: Object.fromEntries(
        cams.map((c) => [c, idx > 0 ? 100 : Math.round((pct / 15) * 100)]),
      ),
      calibration_version: idx >= 2 ? `cal-setup-${n}` : null,
      preview_scene_version: bakes && idx >= 4 ? `scene-preview-setup-${n}` : null,
      scene_version: bakes && idx >= 6 ? (session.scene_version ?? `scene-setup-${n}`) : null,
      height_checks:
        idx >= 4
          ? Object.fromEntries(
              Object.entries(session.camera_heights_m).map(([c, h]) => [
                c,
                {
                  input_height_m: h,
                  restored_height_m: h + 0.01,
                  difference_cm: 1,
                  within_tolerance: true,
                  guidance: null,
                },
              ]),
            )
          : null,
      ready_at_ms: idx >= 4 ? (session.ready_at_ms ?? now()) : null,
      completed_at_ms: idx >= 6 ? now() : null,
    });
  }

  function setZoneDrafts(
    sessionId: string,
    overrides: Partial<SetupZoneDraftsResponseInput>,
  ): SetupZoneDraftsResponse {
    const built = buildSetupZoneDraftsResponse(sessionId, overrides);
    zoneDraftsBySession.set(sessionId, built);
    return built;
  }

  const handlers = [
    http.get('*/api/cameras/coverage-guides', ({ request }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      if (state.guideError) {
        return problem(503, 'COVERAGE_GUIDE_UNAVAILABLE', '카메라 각도 안내를 계산하지 못했습니다');
      }
      const isEmpty = state.guideStatus === 'EMPTY' || state.latestGuide === null;
      const isStale = !isEmpty && (state.guideStale || state.guideStatus === 'STALE');
      const status: CoverageRelayStatus = isEmpty ? 'EMPTY' : isStale ? 'STALE' : 'OK';
      const ageMs = isEmpty ? null : isStale ? 12_500 : 1_200;
      const receivedAtMs = ageMs === null ? null : t - ageMs;

      return HttpResponse.json({
        calibration_version: 'cal-8',
        guides: [],
        site_id: state.siteId,
        status,
        stale: isStale,
        active_demand: true,
        demand_ttl_ms: DEMAND_TTL_MS,
        last_admin_query_at_ms: t,
        demand_until_ms: t + DEMAND_TTL_MS,
        stale_after_ms: STALE_AFTER_MS,
        received_at_ms: receivedAtMs,
        age_ms: ageMs,
        latest: isEmpty ? null : state.latestGuide,
      });
    }),

    http.get('*/api/setup-sessions/camera-height-defaults', ({ request }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const entries = Object.entries(state.cameraHeightsM);
      const allPresent =
        entries.length > 0 &&
        entries.every(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0);
      return HttpResponse.json({
        site_id: state.siteId,
        height_tolerance_cm: state.heightToleranceCm,
        camera_heights_m: { ...state.cameraHeightsM },
        all_present: allPresent,
      });
    }),

    http.post('*/api/setup-sessions', async ({ request }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();

      const raw: unknown = await request.json().catch(() => null);
      if (typeof raw !== 'object' || raw === null) {
        return problem(400, 'INVALID_SETUP_REQUEST', '세팅 시작 요청 본문이 올바르지 않습니다');
      }

      const workUnitId = Reflect.get(raw, 'work_unit_id');
      const rawHeights = Reflect.get(raw, 'camera_heights_m');
      if (typeof workUnitId !== 'number' || !Number.isInteger(workUnitId) || workUnitId < 1) {
        return problem(400, 'INVALID_SETUP_REQUEST', '유효한 작업 단위 ID가 필요합니다');
      }
      // 서버처럼(SetupReuseMode.parseRequested) 모드를 생략하면 새 모델이고 NEW·REUSE 밖의 값은 400 이다.
      const sentMode = Reflect.get(raw, 'mode');
      const parsedMode = setupModeSchema.safeParse(sentMode ?? 'NEW');
      if (!parsedMode.success) {
        return problem(400, 'INVALID_SETUP_REQUEST', '세팅 모드가 올바르지 않습니다');
      }
      const requestedMode = parsedMode.data;
      const userReuseCheck = reuseCheckFor(user.id);
      if (requestedMode === 'REUSE') {
        const blocked = reuseBlockedProblem(userReuseCheck);
        if (blocked) return blocked;
      }
      // 서버처럼(SetupService.createReuse, S15P31A101-714) 후보 맵 목록이 있으면 고른 맵(없으면 추천)의 묶음을 그대로 쓰는 끝난 세션을 만든다
      const candidates = userReuseCheck.candidates ?? [];
      if (requestedMode === 'REUSE' && candidates.length > 0) {
        const sentMap = Reflect.get(raw, 'reuse_setup_session_id');
        const wanted = typeof sentMap === 'string' ? sentMap : defaultReuseMapId(userReuseCheck);
        const picked = candidates.find((c) => c.setup_session_id === wanted);
        if (!picked || !picked.selectable) {
          return problem(409, 'SETUP_REUSE_MAP_UNAVAILABLE', '고른 이전 맵을 재사용할 수 없습니다');
        }
        submittedBodies.push({
          work_unit_id: workUnitId,
          mode: 'REUSE',
          ...(typeof sentMap === 'string' ? { reuse_setup_session_id: sentMap } : {}),
        });
        const reuseId = `019a0000-0000-7000-8000-${String(++seq).padStart(12, '0')}`;
        const reused: SetupSessionResponse = {
          setup_session_id: reuseId,
          site_id: state.siteId,
          work_unit_id: workUnitId,
          retry_of: null,
          job_id: null,
          status: 'COMPLETED',
          stage: 'COMPLETED',
          progress_pct: 100,
          camera_heights_m: { ...picked.camera_heights_m },
          height_tolerance_cm: state.heightToleranceCm,
          background_collection_pct: {},
          height_checks: null,
          height_warnings: [],
          object_cross_checks: null,
          calibration_version: `cal-of-${picked.setup_session_id}`,
          preview_scene_version: null,
          scene_version: null,
          config_version: null,
          zones_committed_at: null,
          zone_drafts_ref: null,
          failure_code: null,
          failure_message: null,
          requested_by: 1,
          started_at_ms: t,
          ready_at_ms: t,
          completed_at_ms: t,
          updated_at_ms: t,
          ...modePatch('REUSE'),
          complete_blocked_reason: null,
          reuse_source: {
            setup_session_id: picked.setup_session_id,
            scene_version: picked.scene_version ?? null,
          },
        };
        sessions.set(reuseId, reused);
        workUnitSessions.set(workUnitId, reuseId);
        return HttpResponse.json(reused, { status: 202 });
      }
      // 서버처럼(SetupService.create) 끝나지 않은 세션이 있으면 새로 시작할 수 없다.
      const running = [...sessions.values()].some(
        (session) => session.status !== 'COMPLETED' && session.status !== 'FAILED',
      );
      if (running) {
        return problem(409, 'SETUP_ALREADY_IN_PROGRESS', '이미 진행 중인 세팅 세션이 있습니다');
      }

      const submittedHeights: Record<string, number> = {};
      if (typeof rawHeights === 'object' && rawHeights !== null) {
        for (const [camId, val] of Object.entries(rawHeights)) {
          if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 20) {
            return problem(
              400,
              'INVALID_SETUP_REQUEST',
              `카메라 ${camId} 높이 값이 유효하지 않습니다`,
            );
          }
          submittedHeights[camId] = val;
        }
      }

      // 제출한 유효 높이는 다음 기본값으로 즉시 저장된다(SetupService.java 와 동일).
      for (const [camId, val] of Object.entries(submittedHeights)) {
        state.cameraHeightsM[camId] = val;
      }

      const effectiveHeights: Record<string, number> = {};
      for (const [camId, storedVal] of Object.entries(state.cameraHeightsM)) {
        const val = submittedHeights[camId] ?? storedVal;
        if (val === null || val === undefined || val <= 0 || val > 20) {
          return problem(400, 'CAMERA_HEIGHT_REQUIRED', `카메라 ${camId} 높이를 입력해야 합니다`);
        }
        effectiveHeights[camId] = val;
      }

      submittedBodies.push({
        work_unit_id: workUnitId,
        camera_heights_m: { ...submittedHeights },
        ...(sentMode === undefined ? {} : { mode: requestedMode }),
      });

      const sessionId = `019a0000-0000-7000-8000-${String(++seq).padStart(12, '0')}`;
      const collectionPct = Object.fromEntries(
        Object.keys(effectiveHeights).map((camId) => [camId, 0]),
      );
      const session: SetupSessionResponse = {
        setup_session_id: sessionId,
        site_id: state.siteId,
        work_unit_id: workUnitId,
        retry_of: null,
        job_id: `job-setup-${seq}`,
        status: 'COLLECTING_BACKGROUND',
        stage: 'COLLECTING_BACKGROUND',
        progress_pct: 0,
        camera_heights_m: effectiveHeights,
        height_tolerance_cm: state.heightToleranceCm,
        background_collection_pct: collectionPct,
        height_checks: null,
        height_warnings: [],
        object_cross_checks: null,
        calibration_version: null,
        preview_scene_version: null,
        scene_version: null,
        config_version: null,
        zones_committed_at: null,
        zone_drafts_ref: null,
        failure_code: null,
        failure_message: null,
        requested_by: 1,
        started_at_ms: t,
        ready_at_ms: null,
        completed_at_ms: null,
        updated_at_ms: t,
        ...modePatch(requestedMode),
        ...anchorPatch(),
      };
      sessions.set(sessionId, session);
      workUnitSessions.set(workUnitId, sessionId);
      return HttpResponse.json(session, { status: 202 });
    }),

    http.get('*/api/work-units/:id', ({ request, params }) => {
      if (!readLiveUser(request, now())) return unauthorized();
      return HttpResponse.json({
        work_id: String(params.id ?? ''),
        active_setup_session_id:
          workUnitSessions.get(Number(params.id)) ?? options.workUnitSessionId ?? null,
      });
    }),

    // 「이전 맵 재사용」을 지금 고를 수 있는지(S15P31A101-689). :id 경로보다 먼저 둔다
    http.get('*/api/setup-sessions/reuse-check', ({ request }) => {
      const user = readLiveUser(request, now());
      if (!user) return unauthorized();
      return HttpResponse.json(reuseCheckFor(user.id));
    }),

    http.get('*/api/setup-sessions/:id', ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const found = sessions.get(id);
      if (!found) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      return HttpResponse.json(supplement.withView(progressSession(advanceIfDue(found, t))));
    }),

    http.post('*/api/setup-sessions/:id/cancel', ({ request, params }) => {
      if (!readLiveUser(request, now())) return unauthorized();
      const id = String(params.id ?? '');
      const found = sessions.get(id);
      if (!found) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      if (found.status === 'COMPLETED' || found.status === 'FAILED') {
        return problem(409, 'SETUP_CANCEL_NOT_ALLOWED', '이미 끝난 세팅 세션은 취소할 수 없습니다');
      }
      const cancelled = updateSession(id, {
        status: 'FAILED',
        stage: 'FAILED',
        failure_code: 'CANCELLED_BY_ADMIN',
        failure_message: '관리자가 세팅을 취소했습니다',
      });
      return HttpResponse.json(cancelled);
    }),

    // 카메라 확인 걷기 시작·확인만 다시(-687): 걷기를 기다리는 세션만 받는다. attempt 는 화면이 본 다음 번호(다르면 409)
    http.post('*/api/setup-sessions/:id/camera-check/start', async ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const found = sessions.get(id);
      if (!found) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      const next = (found.camera_check?.attempt?.no ?? 0) + 1;
      const raw: unknown = await request.json().catch(() => ({}));
      const asked =
        typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'attempt') : undefined;
      const waiting =
        found.camera_check_phase === 'AWAITING_START' || found.camera_check_phase === 'RETRY_WAIT';
      if (!waiting || found.status === 'FAILED' || (typeof asked === 'number' && asked !== next)) {
        return problem(
          409,
          'SETUP_CAMERA_CHECK_START_NOT_ALLOWED',
          '카메라 확인 걷기를 기다리는 세팅 세션만 걷기를 시작할 수 있습니다',
        );
      }
      walkAttempts.set(id, { at: t, attempt: next });
      const started = updateSession(id, {
        camera_check_request: { attempt: next },
        camera_check_phase: 'STARTING',
        paused_reason: null,
      });
      return HttpResponse.json(started);
    }),

    // 높이 확인에 답하기(-690): 워커가 확인을 기다리는 세션만 받고, 고친 높이면 CORRECTED·같으면 CONFIRMED 로 멈춘 단계부터 다시 돈다.
    // 멈춘 동안은 시간이 흐르지 않은 것으로 본다. 실제 서버는 워커가 그 높이를 실을 때 세션 높이를 바꾸지만 목업은 바로 바꾼다.
    http.post('*/api/setup-sessions/:id/resume', async ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const found = sessions.get(id);
      if (!found) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      if (
        found.paused_reason !== 'HEIGHT_CHECK' ||
        found.height_review?.status !== 'AWAITING_CONFIRMATION' ||
        found.height_decision ||
        found.status === 'FAILED'
      ) {
        return problem(
          409,
          'SETUP_RESUME_NOT_ALLOWED',
          '카메라 높이 확인을 기다리는 세팅 세션만 이어 갈 수 있습니다',
        );
      }
      const raw: unknown = await request.json().catch(() => ({}));
      const rawHeights =
        typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'camera_heights_m') : undefined;
      const heights: Record<string, number> = { ...found.camera_heights_m };
      if (typeof rawHeights === 'object' && rawHeights !== null) {
        for (const [camId, val] of Object.entries(rawHeights)) {
          if (typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= 20) {
            heights[camId] = val;
            state.cameraHeightsM[camId] = val;
          }
        }
      }
      const pausedSince = pausedAt.get(id) ?? t;
      pausedAt.delete(id);
      const corrected = Object.entries(heights).some(
        ([camId, val]) => Math.abs(val - (found.camera_heights_m[camId] ?? val)) > 1e-4,
      );
      const resumed = updateSession(id, {
        camera_heights_m: heights,
        paused_reason: null,
        height_decision: {
          decision: corrected ? 'CORRECTED' : 'CONFIRMED',
          camera_heights_m: heights,
          decided_at_ms: t,
        },
        height_review: {
          status: corrected ? 'CORRECTED' : 'CONFIRMED',
          max_relative_diff: MOCK_HEIGHT_REVIEW_MAX_RELATIVE,
          camera_heights_m: heights,
          cameras: heightReviewCameras(heights),
        },
        started_at_ms: (found.started_at_ms ?? t) + (t - pausedSince),
      });
      return HttpResponse.json(resumed);
    }),

    http.post('*/api/setup-sessions/:id/retry', async ({ request, params }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();
      const prevId = String(params.id ?? '');
      const prevSession = sessions.get(prevId);
      if (!prevSession) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      // 서버처럼(SetupService.retry) 실패한 세션만 재시도할 수 있다. 끝났거나 진행 중이면 새로 시작하거나 취소해야 한다.
      if (prevSession.status !== 'FAILED') {
        return problem(409, 'SETUP_RETRY_NOT_ALLOWED', '실패한 세팅 세션만 재시도할 수 있습니다');
      }

      const raw: unknown = await request.json().catch(() => ({}));
      const rawHeights =
        typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'camera_heights_m') : undefined;
      // 서버처럼(SetupService.retry) mode 를 주면 그 방식으로, 없으면 처음 요청한 방식 그대로 다시 시도한다(S15P31A101-689)
      const sentMode =
        typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'mode') : undefined;
      const parsedMode = setupModeSchema.safeParse(sentMode ?? prevSession.requested_mode ?? 'NEW');
      if (!parsedMode.success) {
        return problem(400, 'INVALID_SETUP_REQUEST', '세팅 모드가 올바르지 않습니다');
      }
      if (parsedMode.data === 'REUSE') {
        const blocked = reuseBlockedProblem(reuseCheckFor(user.id));
        if (blocked) return blocked;
      }

      const submittedHeights: Record<string, number> = {};
      if (typeof rawHeights === 'object' && rawHeights !== null) {
        for (const [camId, val] of Object.entries(rawHeights)) {
          if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 20) {
            return problem(
              400,
              'INVALID_SETUP_REQUEST',
              `카메라 ${camId} 높이 값이 유효하지 않습니다`,
            );
          }
          submittedHeights[camId] = val;
          state.cameraHeightsM[camId] = val;
        }
      }

      const effectiveHeights: Record<string, number> = {
        ...prevSession.camera_heights_m,
        ...submittedHeights,
      };

      const retriedSessionId = `019a0000-0000-7000-8000-${String(++seq).padStart(12, '0')}`;
      const collectionPct = Object.fromEntries(
        Object.keys(effectiveHeights).map((camId) => [camId, 0]),
      );
      const retried: SetupSessionResponse = {
        setup_session_id: retriedSessionId,
        site_id: prevSession.site_id,
        work_unit_id: prevSession.work_unit_id,
        retry_of: prevId,
        job_id: `job-setup-${seq}`,
        status: 'COLLECTING_BACKGROUND',
        stage: 'COLLECTING_BACKGROUND',
        progress_pct: 0,
        camera_heights_m: effectiveHeights,
        height_tolerance_cm: state.heightToleranceCm,
        background_collection_pct: collectionPct,
        height_checks: null,
        height_warnings: [],
        object_cross_checks: null,
        calibration_version: null,
        preview_scene_version: null,
        scene_version: null,
        config_version: null,
        zones_committed_at: null,
        zone_drafts_ref: null,
        failure_code: null,
        failure_message: null,
        requested_by: 1,
        started_at_ms: t,
        ready_at_ms: null,
        completed_at_ms: null,
        updated_at_ms: t,
        ...modePatch(parsedMode.data),
        ...anchorPatch(),
      };
      sessions.set(retriedSessionId, retried);
      workUnitSessions.set(prevSession.work_unit_id, retriedSessionId);
      retryRequests.push({
        sessionId: prevId,
        retriedSessionId,
        body:
          Object.keys(submittedHeights).length > 0 ? { camera_heights_m: submittedHeights } : {},
        ...(sentMode === undefined ? {} : { mode: parsedMode.data }),
      });

      return HttpResponse.json(retried, { status: 202 });
    }),

    http.get('*/api/setup-sessions/:id/zone-drafts', ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const session = sessions.get(id);
      if (!session) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }

      const existing = zoneDraftsBySession.get(id);
      if (existing) {
        return HttpResponse.json(existing);
      }

      const built = buildSetupZoneDraftsResponse(id, {
        site_id: session.site_id,
        calibration_version: session.calibration_version ?? 'cal-8',
        preview_scene_version: session.preview_scene_version ?? 'scene-preview-1',
      });
      zoneDraftsBySession.set(id, built);
      return HttpResponse.json(built);
    }),
    // 세팅 중 구역 목록(-612): 통째로 저장, revision 이 다르면 409 SETUP_ZONE_PLAN_CONFLICT, 완료 뒤면 409 SETUP_ZONES_CLOSED
    http.get('*/api/setup-sessions/:id/zones', ({ request, params }) => {
      if (!readLiveUser(request, now())) return unauthorized();
      const id = String(params.id ?? '');
      if (!sessions.has(id)) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      return HttpResponse.json(planView(id));
    }),

    http.put('*/api/setup-sessions/:id/zones', async ({ request, params }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();
      if (user.role !== 'ADMIN') return problem(403, 'FORBIDDEN', '관리자만 저장할 수 있습니다');
      const id = String(params.id ?? '');
      const session = sessions.get(id);
      if (!session) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      if (session.setup_completed_at_ms != null || session.status === 'FAILED') {
        return problem(409, 'SETUP_ZONES_CLOSED', '세팅이 끝나 구역 목록을 고칠 수 없습니다');
      }
      if (cameraCheckBlocks(session)) return cameraCheckProblem();
      const raw: unknown = await request.json().catch(() => null);
      const items = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'items') : undefined;
      const revision =
        typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'revision') : undefined;
      const valid =
        Array.isArray(items) &&
        items.length <= 100 &&
        items.every((item: unknown) => {
          if (typeof item !== 'object' || item === null) return false;
          const source = Reflect.get(item, 'source');
          const zoneId = Reflect.get(item, 'zone_id');
          return (
            (source === 'AI' || source === 'MANUAL') &&
            (zoneId != null || Reflect.get(item, 'zone') != null)
          );
        });
      if (!valid || typeof revision !== 'number') {
        return problem(400, 'INVALID_SETUP_ZONE_PLAN', '세팅 구역 목록이 올바르지 않습니다');
      }
      const stored = zonePlans.get(id);
      if ((stored?.revision ?? 0) !== revision) {
        return problem(
          409,
          'SETUP_ZONE_PLAN_CONFLICT',
          '다른 곳에서 먼저 고친 세팅 구역 목록입니다',
        );
      }
      zonePlans.set(id, {
        items: (items as unknown[]).map(normalizeReview),
        revision: revision + 1,
        updatedAt: t,
      });
      return HttpResponse.json(planView(id));
    }),

    // 처음 목록 채우기(-629, -758): 저장한 적 없는 재사용 목록만 확인 표시 없이 채운다. 새 모델은 채우지 않는다(이전 구역은 불러오기로만)
    http.post('*/api/setup-sessions/:id/zones/seed', ({ request, params }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();
      if (user.role !== 'ADMIN') return problem(403, 'FORBIDDEN', '관리자만 저장할 수 있습니다');
      const id = String(params.id ?? '');
      const session = sessions.get(id);
      if (!session) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      if (session.setup_completed_at_ms != null || session.status === 'FAILED') {
        return problem(409, 'SETUP_ZONES_CLOSED', '세팅이 끝나 구역 목록을 고칠 수 없습니다');
      }
      if (cameraCheckBlocks(session)) return cameraCheckProblem();
      if (session.mode === 'REUSE' && !zonePlans.has(id)) {
        const items = liveZones().map((zone) => ({
          zone_id: zone.zone_id,
          source: 'MANUAL',
          candidate_id: null,
          zone: null,
          surface: null,
          needs_review: false,
        }));
        zonePlans.set(id, { items, revision: 1, updatedAt: t });
      }
      return HttpResponse.json(planView(id));
    }),

    // 「이전 구역 불러오기」(-758): 새 모델 + World 이어짐만. 지금 관제 구역을 확인 필요로 덧붙인다(이미 있는 구역은 빼고).
    // 개발 목업은 같은 자리 판정을 하지 않는다(서버 SetupZoneOverlap)
    http.post('*/api/setup-sessions/:id/zones/import-previous', ({ request, params }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();
      if (user.role !== 'ADMIN') return problem(403, 'FORBIDDEN', '관리자만 저장할 수 있습니다');
      const id = String(params.id ?? '');
      const session = sessions.get(id);
      if (!session) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      if (session.setup_completed_at_ms != null || session.status === 'FAILED') {
        return problem(409, 'SETUP_ZONES_CLOSED', '세팅이 끝나 구역 목록을 고칠 수 없습니다');
      }
      if (cameraCheckBlocks(session)) return cameraCheckProblem();
      if (session.mode !== 'REUSE' && session.world_anchor?.accepted !== true) {
        return problem(
          409,
          'SETUP_ZONE_WORLD_MISMATCH',
          'World 좌표가 바뀐 세팅이라 기존 구역(zone_id)을 그대로 쓸 수 없습니다',
        );
      }
      const stored = zonePlans.get(id);
      const current = stored?.items ?? [];
      const listed = new Set(
        current.flatMap((item) => {
          const zoneId = typeof item === 'object' && item ? Reflect.get(item, 'zone_id') : null;
          return typeof zoneId === 'string' ? [zoneId] : [];
        }),
      );
      const added = liveZones()
        .filter((zone) => !listed.has(zone.zone_id))
        .map((zone) => ({
          zone_id: zone.zone_id,
          source: 'MANUAL',
          candidate_id: null,
          zone: null,
          surface: null,
          needs_review: zone.layout_item_id == null,
        }));
      if (added.length > 0) {
        zonePlans.set(id, {
          items: [...current, ...added],
          revision: (stored?.revision ?? 0) + 1,
          updatedAt: t,
        });
      }
      return HttpResponse.json({ ...planView(id), import_skipped: [] });
    }),

    // 세팅 완료(C17, -615): 새 모델은 정밀 맵 뒤, 재사용은 기존 맵 맞추기 뒤·완료 전만 받는다(-688, 화면 completeMapBlockedReason 과
    // 같은 판정). 완료 시각을 남기고 적용 결과(구역은 개발 서버에서 따로 저장)를 돌려준다
    http.post('*/api/setup-sessions/:id/complete', ({ request, params }) => {
      const t = now();
      const user = readLiveUser(request, t);
      if (!user) return unauthorized();
      if (user.role !== 'ADMIN')
        return problem(403, 'FORBIDDEN', '관리자만 세팅을 완료할 수 있습니다');
      const id = String(params.id ?? '');
      const found = sessions.get(id);
      if (!found) {
        return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      }
      const session = progressSession(advanceIfDue(found, t));
      if (session.setup_completed_at_ms != null) {
        return problem(409, 'SETUP_ALREADY_COMPLETED', '이 작업은 세팅을 이미 완료했습니다');
      }
      // 서버 SetupCompletionGate 처럼 고른 맵 그대로 재사용(reuse_source)은 맵 맞추기·걷기를 보지 않는다
      const reuseAsIs = session.reuse_source != null;
      const mapBlocked = reuseAsIs ? null : completeMapBlockedReason(session);
      const mapProblem = (code: string) =>
        problem(409, code, SETUP_COMPLETE_ERROR_TEXT[code] ?? '세팅을 완료할 수 없습니다');
      if (mapBlocked === 'SETUP_NOT_READY_TO_COMPLETE') return mapProblem(mapBlocked);
      if (!reuseAsIs && cameraCheckBlocks(session)) return cameraCheckProblem();
      if (mapBlocked) return mapProblem(mapBlocked);
      const unconfirmed = pendingOf(id);
      if (unconfirmed > 0) {
        return HttpResponse.json(
          {
            status: 409,
            code: 'SETUP_ZONES_UNCONFIRMED',
            detail: `확인이 필요한 구역 ${unconfirmed}개가 남아 있습니다. 구역마다 확인·수정·삭제한 뒤 세팅을 완료하세요`,
            unconfirmed_count: unconfirmed,
          },
          { status: 409 },
        );
      }
      const done = updateSession(id, { setup_completed_at_ms: t });
      // simAI-DEMO: 이 세팅에서 새로 만든 구역(zone_id 없는 항목)을 관제 구역에 더한다
      applyZones(
        (zonePlans.get(id)?.items ?? [])
          .filter((item) => typeof Reflect.get(item as object, 'zone_id') !== 'string')
          .map((item) => Reflect.get(item as object, 'zone'))
          .filter((zone) => zone != null),
      );
      return HttpResponse.json({ ...supplement.withView(done), applied_zones: appliedOf(id) });
    }),
    ...supplement.handlers,
  ];

  return {
    handlers,
    state,
    submittedBodies,
    retryRequests,
    sessions,
    zoneDraftsBySession,
    updateSession,
    failSession,
    completeAfterZonesCommit,
    setZoneDrafts,
    zonePlans,
    /** 목록 채우기가 읽을 지금 관제 구역을 잇는다(개발 서버: 구역 mock). */
    /** simAI-DEMO: 세팅 완료가 만든 구역을 관제 구역 mock 에 더하는 함수를 잇는다. */
    bindApplyZones(apply: (fields: readonly unknown[]) => void) {
      applyZones = apply;
    },
    bindLiveZones(read: () => readonly SetupMockLiveZone[]) {
      liveZones = read;
    },
  };
}

import type { Http } from '@/lib/http';
import { validateMessage } from '@simai/contracts';
import { z } from 'zod';

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.

const currentSiteSchema = z.object({
  site_id: z.string().min(1),
  name: z.string().trim().min(1),
});

/** SiteController.view 의 현장 식별자·이름만 사용한다. 규칙 기준은 교실 시험 고정이라 화면에서 고르지 않는다(S15P31A101-669). */
export function requestCurrentSite(http: Http, signal?: AbortSignal) {
  return http('/api/sites/current', { schema: currentSiteSchema, signal });
}

/** viewer_health 메시지(봉투 포함). /topic/health 와 같은 계약 검사를 통과한 것만 받는다. */
const viewerHealthMessage = z.unknown().transform((raw, ctx) => {
  const checked = validateMessage('viewer_health', raw);
  if (checked.ok) return checked.message;
  ctx.addIssue({ code: 'custom', message: 'viewer_health 계약과 다르다' });
  return z.NEVER;
});

/**
 * 지금 System Health(명세 12.6 GET /api/health, 열람). 응답은 /topic/health 와 같은 viewer_health 메시지라고
 * FE 가 제안했다(S15P31A101-268, BE S15P31A101-262 에서 확정 전). 형식이 정해지면 이 파일과 mock 만 바꾼다.
 */
export function requestHealth(http: Http, signal?: AbortSignal) {
  return http('/api/health', { schema: viewerHealthMessage, signal });
}

/** Scene 본문의 형식 판단은 뷰어가 맡는다. 앱은 받은 JSON 을 바꾸지 않는다. */
export function requestCurrentScene(http: Http, signal?: AbortSignal) {
  return http('/api/scenes/current', { schema: z.unknown(), signal });
}

/**
 * 버전을 지정한 Scene 보기(GET /api/scenes/{scene_version}/view, 관리자, S15P31A101-613). 응답은 current 와 같은 모양이고 `state`
 * 는 그 버전의 실제 상태(CANDIDATE·COMMITTED)다. 형식 판단은 뷰어가 맡는다.
 */
export function requestSceneView(http: Http, sceneVersion: string, signal?: AbortSignal) {
  return http(`/api/scenes/${encodeURIComponent(sceneVersion)}/view`, {
    schema: z.unknown(),
    signal,
  });
}

/** 현재 보정 상태·카메라 마커 자세(GET /api/calibrations/current, S15P31A101-522). 형식 검사는 뷰어(readCalibrationCameraPoses)가 맡는다. */
export function requestCurrentCalibration(http: Http, signal?: AbortSignal) {
  return http('/api/calibrations/current', { schema: z.unknown(), signal });
}

// ── Scene 입력 카메라 사진 (S15P31A101-592) ─────────────────────────────────

/**
 * GET /api/scenes/{scene_version}/camera-images 응답(계약 messages/scene_camera_images). 그 Scene 을 구운 사람 지운 배경 사진의
 * 카메라별 서명 주소다. 묶음을 모르면 bundle_id 는 null 이고 images 는 비어 있다.
 */
export const sceneCameraImagesSchema = z.object({
  scene_version: z.string(),
  bundle_id: z.string().nullable(),
  expires_at_ms: z.number().int().nullable(),
  images: z.array(z.object({ camera_id: z.string().min(1), url: z.string().min(1) })),
});

export type SceneCameraImages = z.infer<typeof sceneCameraImagesSchema>;

export function requestSceneCameraImages(http: Http, sceneVersion: string, signal?: AbortSignal) {
  return http(`/api/scenes/${encodeURIComponent(sceneVersion)}/camera-images`, {
    schema: sceneCameraImagesSchema,
    signal,
  });
}

// ── 3D 배경(Scene) 재생성 (S15P31A101-428) ─────────────────────────────────

export const SCENE_REGENERATE_POLL_INTERVAL_MS = 2000;
export const SCENE_REGENERATE_MAX_REASON_LENGTH = 120;
export const SCENE_REGENERATE_LATEST_KEY = ['scenes', 'regenerate', 'latest'] as const;

export const sceneRegenerateStatusSchema = z.enum([
  'REQUESTED',
  'CAPTURING',
  'RECONSTRUCTING',
  'CANDIDATE_READY',
  'FAILED',
]);

export type SceneRegenerateStatus = z.infer<typeof sceneRegenerateStatusSchema>;

export const sceneRegenerateAcceptedSchema = z.object({
  request_id: z.number().int().positive(),
  status: sceneRegenerateStatusSchema,
});

export type SceneRegenerateAccepted = z.infer<typeof sceneRegenerateAcceptedSchema>;

export const sceneRegenerateViewSchema = z.object({
  request_id: z.number().int().positive(),
  status: sceneRegenerateStatusSchema,
  failure_reason: z.string().nullable().optional(),
  scene_version: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  requested_at_ms: z.number().optional(),
  updated_at_ms: z.number().optional(),
});

export type SceneRegenerateView = z.infer<typeof sceneRegenerateViewSchema>;

/** 맵 재생성 품질(-461). 값이 없거나 형식이 다르면 null — 지어내지 않는다. */
const ratioSchema = z.number().min(0).max(1);
const regenerateQualitySchema = z
  .object({
    previous_fill_ratio: ratioSchema,
    unrevealed_ratio: ratioSchema,
    camera_background_quality: z
      .record(
        z.string(),
        z.object({ previous_fill_ratio: ratioSchema, unrevealed_ratio: ratioSchema }),
      )
      .optional()
      .catch(undefined),
  })
  .passthrough();

export type SceneRegenerateQuality = z.infer<typeof regenerateQualitySchema>;

/** 현재 Scene 응답(`quality`)에서 재생성 품질만 꺼낸다. */
export function parseSceneRegenerateQuality(scene: unknown): SceneRegenerateQuality | null {
  if (typeof scene !== 'object' || scene === null) return null;
  const parsed = regenerateQualitySchema.safeParse(Reflect.get(scene, 'quality'));
  return parsed.success ? parsed.data : null;
}

/** 채움 비율이 이 값 이상이면 "일부는 이전 모습" 안내를 띄운다. */
export const SCENE_REGENERATE_PREVIOUS_FILL_NOTICE_RATIO = 0.3;

export const sceneCommitResponseSchema = z
  .object({
    scene_version: z.string(),
    state: z.string(),
  })
  .passthrough();

export type SceneCommitResponse = z.infer<typeof sceneCommitResponseSchema>;

export const SCENE_REGENERATE_STEP_LABELS: Record<SceneRegenerateStatus, string> = {
  REQUESTED: '요청 대기 중',
  CAPTURING: '배경 수집 중',
  RECONSTRUCTING: '3D 재구성 중',
  CANDIDATE_READY: '새 3D 배경 후보 준비됨',
  FAILED: '재생성 실패',
};

export const SCENE_REGENERATE_FAILURE_LABELS: Record<string, string> = {
  NO_WORKER: '실행 가능한 분석 워커가 없습니다.',
  TIER0_NOT_RUNNING: '현장 게이트웨이(Tier 0)가 실행 중이 아닙니다.',
  BACKGROUND_NOT_READY: '사람 없는 배경 프레임이 아직 준비되지 않았습니다.',
  UPLOAD_FAILED: '배경 묶음 업로드에 실패했습니다.',
  RECONSTRUCT_FAILED: '3D 배경 재구성 작업에 실패했습니다.',
  TIMEOUT: '제한 시간(10분) 안에 작업이 진행되지 않아 시간 초과되었습니다.',
};

export function sceneRegenerateFailureText(reason: string | null | undefined): string {
  if (!reason) return '알 수 없는 사유로 재생성에 실패했습니다.';
  return SCENE_REGENERATE_FAILURE_LABELS[reason] ?? `재생성 실패 (${reason})`;
}

export function isSceneRegenerateInProgress(
  status: SceneRegenerateStatus | undefined | null,
): boolean {
  return status === 'REQUESTED' || status === 'CAPTURING' || status === 'RECONSTRUCTING';
}

export function requestCreateSceneRegenerate(
  http: Http,
  reason?: string,
): Promise<SceneRegenerateAccepted> {
  const trimmed = reason?.trim();
  return http('/api/scenes/regenerate', {
    method: 'POST',
    body: trimmed ? { reason: trimmed } : {},
    schema: sceneRegenerateAcceptedSchema,
  });
}

export function requestSceneRegenerateById(
  http: Http,
  requestId: number,
  signal?: AbortSignal,
): Promise<SceneRegenerateView> {
  return http(`/api/scenes/regenerate/${encodeURIComponent(String(requestId))}`, {
    schema: sceneRegenerateViewSchema,
    signal,
  });
}

const optionalRegenerateViewSchema = z
  .union([sceneRegenerateViewSchema, z.undefined()])
  .transform((val) => val ?? null);

export function requestLatestSceneRegenerate(
  http: Http,
  signal?: AbortSignal,
): Promise<SceneRegenerateView | null> {
  return http('/api/scenes/regenerate?latest=1', {
    schema: optionalRegenerateViewSchema,
    signal,
  });
}

export function requestCommitScene(http: Http, sceneVersion: string): Promise<SceneCommitResponse> {
  return http(`/api/scenes/${encodeURIComponent(sceneVersion)}/commit`, {
    method: 'POST',
    schema: sceneCommitResponseSchema,
  });
}

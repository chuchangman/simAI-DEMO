import {
  setupZonePlanViewSchema,
  toPlanRequestItems,
  type SetupZonePlanItem,
  type SetupZonePlanView,
} from '@/features/setup/setupZonePlan';
import {
  cameraHeightDefaultsResponseSchema,
  completeSetupResponseSchema,
  coverageGuidesResponseSchema,
  issuedSupplementMediaSchema,
  reuseCheckSchema,
  setupSessionResponseSchema,
  setupZoneDraftsResponseSchema,
  supplementMediaSchema,
  type CameraHeightDefaultsResponse,
  type CompleteSetupResponse,
  type CoverageGuidesResponse,
  type CreateSetupSessionBody,
  type IssuedSupplementMedia,
  type IssueSupplementMediaBody,
  type ResumeSetupSessionBody,
  type RetrySetupSessionBody,
  type ReuseCheck,
  type SetupSessionResponse,
  type SetupZoneDraftsResponse,
  type SupplementMedia,
} from '@/features/setup/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// 세팅 1단계 및 2단계 이후 REST 요청(http 주입, S15P31A101-448·-453).

/** 세팅 1단계 화면이 열려 있는 동안 카메라 각도 헬퍼를 다시 받는 주기(2~3초). */
export const COVERAGE_GUIDE_POLL_MS = 2_500;

/** 세팅 시작 뒤 GET /api/setup-sessions/{id} 조회 주기(2초). */
export const SETUP_SESSION_POLL_MS = 2_000;

export const SETUP_COVERAGE_GUIDES_KEY = ['setup', 'coverage-guides'] as const;
export const SETUP_HEIGHT_DEFAULTS_KEY = ['setup', 'camera-height-defaults'] as const;
export const SETUP_REUSE_CHECK_KEY = ['setup', 'reuse-check'] as const;
export const setupSessionKey = (id: string) => ['setup', 'session', id] as const;
export const setupWorkUnitSessionKey = (workUnitId: number) =>
  ['setup', 'work-unit-session', workUnitId] as const;
export const setupZoneDraftsKey = (id: string) => ['setup', 'session', id, 'zone-drafts'] as const;
export const setupZonePlanKey = (id: string) => ['setup', 'session', id, 'zone-plan'] as const;

export function requestCoverageGuides(
  http: Http,
  signal?: AbortSignal,
): Promise<CoverageGuidesResponse> {
  return http('/api/cameras/coverage-guides', {
    schema: coverageGuidesResponseSchema,
    signal,
  });
}

export function requestCameraHeightDefaults(
  http: Http,
  signal?: AbortSignal,
): Promise<CameraHeightDefaultsResponse> {
  return http('/api/setup-sessions/camera-height-defaults', {
    schema: cameraHeightDefaultsResponseSchema,
    signal,
  });
}

export function createSetupSession(
  http: Http,
  body: CreateSetupSessionBody,
): Promise<SetupSessionResponse> {
  return http('/api/setup-sessions', {
    method: 'POST',
    body,
    schema: setupSessionResponseSchema,
  });
}

export function requestSetupSession(
  http: Http,
  setupSessionId: string,
  signal?: AbortSignal,
): Promise<SetupSessionResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}`, {
    schema: setupSessionResponseSchema,
    signal,
  });
}

export function retrySetupSession(
  http: Http,
  setupSessionId: string,
  body: RetrySetupSessionBody = {},
): Promise<SetupSessionResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/retry`, {
    method: 'POST',
    body,
    schema: setupSessionResponseSchema,
  });
}

/**
 * 카메라 확인 걷기 창의 「걷기 시작」·「확인만 다시(30초)」(S15P31A101-687). attempt 는 화면이 본 다음 시도 번호다(다르면 409:
 * 늦게 온 이전 화면의 누름이 새 시도를 더 열지 않는다). 보정은 그대로 두고 걷기만 다시 잰다.
 */
export function startCameraCheck(
  http: Http,
  setupSessionId: string,
  attempt: number,
): Promise<SetupSessionResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/camera-check/start`, {
    method: 'POST',
    body: { attempt },
    schema: setupSessionResponseSchema,
  });
}

/** 멈춘 세팅 세션(paused_reason)을 고친 높이로 멈춘 곳부터 이어 간다(서버·워커에 요청한 계약). */
export function resumeSetupSession(
  http: Http,
  setupSessionId: string,
  body: ResumeSetupSessionBody,
): Promise<SetupSessionResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/resume`, {
    method: 'POST',
    body,
    schema: setupSessionResponseSchema,
  });
}

export function requestSetupZoneDrafts(
  http: Http,
  setupSessionId: string,
  signal?: AbortSignal,
): Promise<SetupZoneDraftsResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/zone-drafts`, {
    schema: setupZoneDraftsResponseSchema,
    signal,
  });
}

const workUnitSessionSchema = z.object({ active_setup_session_id: z.string().nullish() }).loose();

/** 작업의 진행 중 세팅 세션 ID(GET /api/work-units/{id} 의 active_setup_session_id, 없으면 null). */
export async function requestWorkUnitSetupSessionId(
  http: Http,
  workUnitId: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const work = await http(`/api/work-units/${encodeURIComponent(String(workUnitId))}`, {
    schema: workUnitSessionSchema,
    signal,
  });
  return work.active_setup_session_id ?? null;
}

/** 「이전 맵 재사용」을 지금 고를 수 있는지와 그 이유(ADMIN, S15P31A101-689). */
export function requestReuseCheck(http: Http, signal?: AbortSignal): Promise<ReuseCheck> {
  return http('/api/setup-sessions/reuse-check', { schema: reuseCheckSchema, signal });
}

/** 진행 중인 세팅 세션을 취소한다(ADMIN). 세션은 FAILED + CANCELLED_BY_ADMIN 이 된다. */
export function cancelSetupSession(
  http: Http,
  setupSessionId: string,
): Promise<SetupSessionResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/cancel`, {
    method: 'POST',
    body: {},
    schema: setupSessionResponseSchema,
  });
}

// ---- 세팅 완료(C17, S15P31A101-615) ----

/** 세팅 중 구역 목록(-612). 세팅 완료가 이 목록으로 관제 구역을 맞춘다. */
export function requestSetupZonePlan(
  http: Http,
  setupSessionId: string,
  signal?: AbortSignal,
): Promise<SetupZonePlanView> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/zones`, {
    schema: setupZonePlanViewSchema,
    signal,
  });
}

/**
 * 세팅 중 구역 목록을 통째로 저장한다(-612). revision 은 마지막으로 읽은 값이고, 그 사이 다른 곳에서 고쳤으면 409
 * SETUP_ZONE_PLAN_CONFLICT, 완료 뒤·작업 시작 뒤면 409 SETUP_ZONES_CLOSED 다. 관제 구역(zones/commit)은 바꾸지 않는다.
 */
export function saveSetupZonePlan(
  http: Http,
  setupSessionId: string,
  items: readonly SetupZonePlanItem[],
  revision: number,
): Promise<SetupZonePlanView> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/zones`, {
    method: 'PUT',
    body: { items: toPlanRequestItems(items), revision },
    schema: setupZonePlanViewSchema,
  });
}

/**
 * 구역 단계 처음 목록 채우기(S15P31A101-629). 서버가 저장한 적 없는 재사용 목록만 채운다. 새 모델은 채우지 않는다(S15P31A101-758,
 * 이전 구역은 importPreviousSetupZones 로만). 이미 저장한 목록이면 지금 목록을 그대로 돌려준다.
 */
export function seedSetupZonePlan(http: Http, setupSessionId: string): Promise<SetupZonePlanView> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/zones/seed`, {
    method: 'POST',
    schema: setupZonePlanViewSchema,
  });
}

/** 「이전 구역 불러오기」 응답: 목록 + AI 초안 구역과 같은 자리라 빼고 불러온 이전 구역 이름(S15P31A101-758). */
export const importPreviousZonesSchema = setupZonePlanViewSchema.extend({
  import_skipped: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});
export type ImportPreviousZonesView = z.infer<typeof importPreviousZonesSchema>;

/**
 * 「이전 구역 불러오기」(S15P31A101-758): 새 모델 + World 이어짐 세팅의 목록에 지금 관제 구역을 확인 필요로 더한다. 목록의 AI 초안
 * 구역과 같은 자리인 구역은 빼고 import_skipped 에 이름을 싣는다. World 가 끊긴 세팅은 409 SETUP_ZONE_WORLD_MISMATCH.
 */
export function importPreviousSetupZones(
  http: Http,
  setupSessionId: string,
): Promise<ImportPreviousZonesView> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/zones/import-previous`, {
    method: 'POST',
    schema: importPreviousZonesSchema,
  });
}

/**
 * 세팅을 완료한다(ADMIN): 구역 목록 적용 → 완료 기록 → (새 모델) 이 세션 맵 켜기 → 구성 묶음 한 번 발행.
 * 커밋 뒤 서버가 TBM AI 양식 초안을 시작한다.
 */
export function completeSetupSession(
  http: Http,
  setupSessionId: string,
): Promise<CompleteSetupResponse> {
  return http(`/api/setup-sessions/${encodeURIComponent(setupSessionId)}/complete`, {
    method: 'POST',
    body: {},
    schema: completeSetupResponseSchema,
  });
}

// ---- 맵 보강 촬영(S15P31A101-607) ----

const sessionPath = (setupSessionId: string) =>
  `/api/setup-sessions/${encodeURIComponent(setupSessionId)}`;

/** 보강 촬영 파일 하나의 올리기 주소를 받는다(서명 PUT, 키는 서버가 정한다). */
export function issueSupplementMedia(
  http: Http,
  setupSessionId: string,
  body: IssueSupplementMediaBody,
): Promise<IssuedSupplementMedia> {
  return http(`${sessionPath(setupSessionId)}/supplement-media`, {
    method: 'POST',
    body,
    schema: issuedSupplementMediaSchema,
  });
}

/** 저장소에 다 올렸다고 알린다. 서버가 객체 크기를 확인하고 UPLOADED 로 바꾼다. */
export function completeSupplementMedia(
  http: Http,
  setupSessionId: string,
  mediaId: string,
): Promise<SupplementMedia> {
  return http(
    `${sessionPath(setupSessionId)}/supplement-media/${encodeURIComponent(mediaId)}/complete`,
    { method: 'POST', body: {}, schema: supplementMediaSchema },
  );
}

/** 보강 촬영 파일을 목록에서 뺀다(다시 굽기에 들어가지 않는다). */
export async function removeSupplementMedia(
  http: Http,
  setupSessionId: string,
  mediaId: string,
): Promise<void> {
  await http(`${sessionPath(setupSessionId)}/supplement-media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

/** 올린 보강 촬영으로 맵을 다시 굽는다(고정 카메라 4대와 함께). */
export function startSupplementRebake(
  http: Http,
  setupSessionId: string,
): Promise<SetupSessionResponse> {
  return http(`${sessionPath(setupSessionId)}/supplement-rebake`, {
    method: 'POST',
    body: {},
    schema: setupSessionResponseSchema,
  });
}

/** 진행 중인 다시 굽기를 취소한다(원래 맵 유지). */
export function cancelSupplementRebake(
  http: Http,
  setupSessionId: string,
): Promise<SetupSessionResponse> {
  return http(`${sessionPath(setupSessionId)}/supplement-rebake/cancel`, {
    method: 'POST',
    body: {},
    schema: setupSessionResponseSchema,
  });
}

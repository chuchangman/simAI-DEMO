import type { SceneRegenerateStatus, SceneRegenerateView } from '@/features/layout/api';
import { DEMO_FLOW } from '@/mocks/demoFlow';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { VERSIONS } from '@/mocks/scenario/shared';
import { http, HttpResponse } from 'msw/http';

// 개발 하네스와 같은 자산만 재사용한다. 뷰어 내부 코드는 import 하지 않는다.
const demoSceneUrl = new URL(
  '../features/viewer3d/dev-harness/fixtures/scene-demo.gltf',
  import.meta.url,
).href;

// 서버가 주는 서명 URL 의 유효 시간.
const SIGNED_URL_TTL_MS = 5 * 60_000;

// simAI-DEMO: 시연 흐름은 지금 관제 Scene 이 실시간 목(world·health)과 같은 버전·보정으로 확정돼 있어 관제 3D 맵이 그대로 보인다
const MOCK_CALIBRATION_VERSION = DEMO_FLOW ? VERSIONS.calibration : 'cal-mock-1';

/** 서버가 Scene 버전으로 받는 형식(SceneService.SCENE_VERSION). 어긋나면 보이는 Scene 이 없어 404 다. */
const SCENE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/;

/**
 * 아직 확정되지 않은(CANDIDATE) 보이는 Scene 의 버전 앞부분: 세팅의 미리보기·정밀 3D 맵(mocks/setup.ts), 보충 굽기
 * (mocks/setupSupplement.ts), 재생성 후보(이 파일). 이 mock 은 모두 데모 glTF 로 보인다.
 */
const CANDIDATE_VERSION_PREFIXES = [
  'scene-preview-',
  'scene-setup-',
  'scene-supplement-',
  'scene-cand-',
] as const;

/** GET /api/scenes/{scene_version}/view 가 낼 상태. 기본 Scene(DB 행 아님)과 모르는 버전은 서버처럼 null 이다. */
function viewableSceneState(version: string): 'COMMITTED' | 'CANDIDATE' | null {
  if (!SCENE_VERSION_PATTERN.test(version)) return null;
  if (!state.isDefault && version === state.currentSceneVersion) return 'COMMITTED';
  return CANDIDATE_VERSION_PREFIXES.some((prefix) => version.startsWith(prefix))
    ? 'CANDIDATE'
    : null;
}

interface MockSceneState {
  currentSceneVersion: string;
  isDefault: boolean;
  committedAtMs: number | null;
  nextRequestId: number;
  requests: Map<number, SceneRegenerateView>;
  autoAdvanceOnPoll: boolean;
  quality: unknown;
}

const state: MockSceneState = {
  currentSceneVersion: DEMO_FLOW ? VERSIONS.scene : 'scene-demo',
  isDefault: !DEMO_FLOW,
  committedAtMs: DEMO_FLOW ? Date.now() : null,
  nextRequestId: 1,
  requests: new Map(),
  autoAdvanceOnPoll: false,
  quality: null,
};

export function resetMockSceneState(options?: { autoAdvanceOnPoll?: boolean }): void {
  state.currentSceneVersion = 'scene-demo';
  state.isDefault = true;
  state.committedAtMs = null;
  state.nextRequestId = 1;
  state.requests.clear();
  state.autoAdvanceOnPoll = options?.autoAdvanceOnPoll ?? false;
  state.quality = null;
}

/** 현재 Scene 응답의 `quality`(맵 재생성 품질, -469)를 시험에서 지정한다. */
export function setMockSceneQuality(quality: unknown): void {
  state.quality = quality;
}

export function setMockSceneRegenerateView(view: SceneRegenerateView): void {
  state.requests.set(view.request_id, { ...view });
  if (view.request_id >= state.nextRequestId) {
    state.nextRequestId = view.request_id + 1;
  }
}

function isInProgress(status: SceneRegenerateStatus): boolean {
  return status === 'REQUESTED' || status === 'CAPTURING' || status === 'RECONSTRUCTING';
}

function advanceIfEnabled(item: SceneRegenerateView): SceneRegenerateView {
  if (!state.autoAdvanceOnPoll) return item;
  const now = Date.now();
  let next: SceneRegenerateView = item;
  if (item.status === 'REQUESTED') {
    next = { ...item, status: 'CAPTURING', updated_at_ms: now };
  } else if (item.status === 'CAPTURING') {
    next = { ...item, status: 'RECONSTRUCTING', updated_at_ms: now };
  } else if (item.status === 'RECONSTRUCTING') {
    next = {
      ...item,
      status: 'CANDIDATE_READY',
      scene_version: `scene-cand-${item.request_id}`,
      updated_at_ms: now,
    };
  }
  state.requests.set(item.request_id, next);
  return next;
}

export const sceneHandlers = [
  http.get('*/api/scenes/current', ({ request }) => {
    const now = Date.now();
    if (!readLiveUser(request, now)) return unauthorized();
    return HttpResponse.json({
      scene_version: state.currentSceneVersion,
      state: state.isDefault ? 'DEFAULT' : 'COMMITTED',
      default: state.isDefault,
      calibration_version: state.isDefault ? null : MOCK_CALIBRATION_VERSION,
      committed_at_ms: state.committedAtMs,
      quality: state.quality,
      gltf_url: demoSceneUrl,
      gltf_expires_at_ms: now + SIGNED_URL_TTL_MS,
    });
  }),

  // 버전을 지정한 Scene 보기(-613, 관리자 전용). current 와 같은 모양에 `current`(지금 관제 Scene 인지)를 더하고 compatibility 는 없다.
  // state 는 그 버전의 실제 상태다: 세팅 미리보기·정밀 맵은 CANDIDATE(확정 시각 없음), 지금 관제 Scene 은 COMMITTED.
  http.get('*/api/scenes/:sceneVersion/view', ({ request, params }) => {
    const now = Date.now();
    const user = readLiveUser(request, now);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') {
      return problem(403, 'FORBIDDEN', '관리자만 Scene 을 볼 수 있습니다.');
    }
    const version = String(params.sceneVersion ?? '');
    const sceneState = viewableSceneState(version);
    if (!sceneState) return problem(404, 'SCENE_VERSION_NOT_FOUND', 'Scene 을 찾을 수 없습니다');
    const committed = sceneState === 'COMMITTED';
    return HttpResponse.json({
      scene_version: version,
      state: sceneState,
      default: false,
      calibration_version: MOCK_CALIBRATION_VERSION,
      committed_at_ms: committed ? state.committedAtMs : null,
      quality: committed ? state.quality : null,
      gltf_url: demoSceneUrl,
      gltf_expires_at_ms: now + SIGNED_URL_TTL_MS,
      current: committed,
    });
  }),

  // Scene 입력 카메라 사진(-592). 지금 mock Scene 은 데모 glTF 라 사진을 구운 입력 묶음이 없다(서버와 같이 묶음 null·빈 목록).
  // 시연용 기본 Scene 은 DB 행이 아니라 서버처럼 404 다.
  http.get('*/api/scenes/:sceneVersion/camera-images', ({ request, params }) => {
    if (!readLiveUser(request, Date.now())) return unauthorized();
    const version = String(params.sceneVersion ?? '');
    if (state.isDefault || version !== state.currentSceneVersion) {
      return problem(404, 'SCENE_VERSION_NOT_FOUND', 'Scene 을 찾을 수 없습니다');
    }
    return HttpResponse.json({
      scene_version: version,
      bundle_id: null,
      expires_at_ms: null,
      images: [],
    });
  }),

  http.post('*/api/scenes/regenerate', async ({ request }) => {
    const now = Date.now();
    const user = readLiveUser(request, now);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') {
      return problem(403, 'FORBIDDEN', '관리자만 3D 배경 재생성을 요청할 수 있습니다.');
    }

    let reason: string | null = null;
    const rawText = await request.text();
    if (rawText.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawText);
        if (typeof parsed !== 'object' || parsed === null) {
          return problem(400, 'INVALID_REGENERATE_REQUEST', '요청 형식이 올바르지 않습니다.');
        }
        const r: unknown = Reflect.get(parsed, 'reason');
        if (r !== undefined && r !== null) {
          if (typeof r !== 'string' || r.trim().length > 120) {
            return problem(
              400,
              'INVALID_REGENERATE_REQUEST',
              '재생성 사유는 120자 이하 문자열이어야 합니다.',
            );
          }
          reason = r.trim() || null;
        }
      } catch {
        return problem(400, 'INVALID_REGENERATE_REQUEST', '요청 형식이 올바르지 않습니다.');
      }
    }

    for (const existing of state.requests.values()) {
      if (isInProgress(existing.status)) {
        return HttpResponse.json(
          {
            status: 409,
            code: 'REGENERATE_IN_PROGRESS',
            detail: '이미 진행 중인 3D 배경 재생성 요청이 있습니다.',
            request_id: existing.request_id,
          },
          { status: 409 },
        );
      }
    }

    const requestId = state.nextRequestId++;
    const created: SceneRegenerateView = {
      request_id: requestId,
      status: 'REQUESTED',
      failure_reason: null,
      scene_version: null,
      reason,
      requested_at_ms: now,
      updated_at_ms: now,
    };
    state.requests.set(requestId, created);

    return HttpResponse.json(
      {
        request_id: requestId,
        status: 'REQUESTED',
      },
      { status: 202 },
    );
  }),

  http.get('*/api/scenes/regenerate/:requestId', ({ request, params }) => {
    const now = Date.now();
    if (!readLiveUser(request, now)) return unauthorized();
    const id = Number(params.requestId);
    const found = Number.isInteger(id) ? state.requests.get(id) : undefined;
    if (!found) {
      return problem(404, 'REGENERATE_NOT_FOUND', '3D 배경 재생성 요청을 찾을 수 없습니다.');
    }
    return HttpResponse.json(advanceIfEnabled(found));
  }),

  http.get('*/api/scenes/regenerate', ({ request }) => {
    const now = Date.now();
    if (!readLiveUser(request, now)) return unauthorized();
    let latest: SceneRegenerateView | null = null;
    for (const item of state.requests.values()) {
      if (!latest || item.request_id > latest.request_id) {
        latest = item;
      }
    }
    if (!latest) {
      return new HttpResponse(null, { status: 204 });
    }
    return HttpResponse.json(latest);
  }),

  http.post('*/api/scenes/:sceneVersion/commit', ({ request, params }) => {
    const now = Date.now();
    const user = readLiveUser(request, now);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') {
      return problem(403, 'FORBIDDEN', '관리자만 Scene 을 활성화할 수 있습니다.');
    }
    const version = String(params.sceneVersion ?? '');
    if (!version || version === 'current' || version === 'regenerate') {
      return problem(400, 'INVALID_SCENE', '올바르지 않은 Scene 버전입니다.');
    }
    state.currentSceneVersion = version;
    state.isDefault = false;
    state.committedAtMs = now;
    return HttpResponse.json({
      scene_version: version,
      state: 'COMMITTED',
      committed_at_ms: now,
    });
  }),
];

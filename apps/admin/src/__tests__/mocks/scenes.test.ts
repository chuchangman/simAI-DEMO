import { readCurrentScene } from '@/features/viewer3d/scene/sceneContract';
import { resetMockSceneState, sceneHandlers } from '@/mocks/scenes';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// GET /api/scenes/{scene_version}/view mock(-613): 서버 계약대로 관리자만, 세팅 미리보기는 CANDIDATE, 모르는 버전은 404.

const server = setupServer(...sceneHandlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => resetMockSceneState());

const ADMIN = 'Bearer mock-token.admin';
const view = (version: string, authorization: string | null = ADMIN) =>
  fetch(`http://api.test/api/scenes/${encodeURIComponent(version)}/view`, {
    headers: authorization ? { Authorization: authorization } : {},
  });
const commit = (version: string) =>
  fetch(`http://api.test/api/scenes/${version}/commit`, {
    method: 'POST',
    headers: { Authorization: ADMIN },
  });

describe('Scene 보기 mock', () => {
  it('세팅 미리보기는 CANDIDATE 로, 확정 시각 없이 current 와 같은 모양에 current:false 를 더해 준다', async () => {
    const response = await view('scene-preview-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      scene_version: 'scene-preview-1',
      state: 'CANDIDATE',
      default: false,
      calibration_version: 'cal-mock-1',
      committed_at_ms: null,
      current: false,
    });
    expect(body).not.toHaveProperty('compatibility');
    expect(body.gltf_url).toEqual(expect.stringContaining('scene-demo'));
    expect(body.gltf_expires_at_ms).toBeGreaterThan(Date.now());
    // 뷰어는 같은 본문을 그대로 읽는다(시험 환경의 자산 주소는 file: 이라 뷰어가 거부하므로 뺀다).
    expect(readCurrentScene({ ...body, gltf_url: null })).toMatchObject({
      ok: true,
      scene: { sceneVersion: 'scene-preview-1', state: 'CANDIDATE', committedAtMs: null },
    });
  });

  it.each(['scene-preview-setup-0001', 'scene-setup-0001', 'scene-supplement-3', 'scene-cand-2'])(
    '세팅·보충·재생성이 내는 버전 %s 도 보인다',
    async (version) => {
      expect((await view(version)).status).toBe(200);
    },
  );

  it('지금 관제 Scene 은 COMMITTED 이고 current:true 다', async () => {
    expect((await commit('scene-cand-1')).status).toBe(200);
    const body = (await (await view('scene-cand-1')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      scene_version: 'scene-cand-1',
      state: 'COMMITTED',
      current: true,
    });
    expect(body.committed_at_ms).toEqual(expect.any(Number));
    // 다른 후보는 그대로 CANDIDATE 다.
    expect(await (await view('scene-cand-2')).json()).toMatchObject({
      state: 'CANDIDATE',
      current: false,
    });
  });

  it('관리자만 본다: 보기 권한은 403, 토큰이 없으면 401', async () => {
    expect((await view('scene-preview-1', 'Bearer mock-token.viewer')).status).toBe(403);
    expect((await view('scene-preview-1', null)).status).toBe(401);
  });

  it.each([
    ['모르는 버전', 'scene-unknown-1'],
    ['시연용 기본 Scene(DB 행이 아니다)', 'scene-demo'],
    ['대문자(형식 오류)', 'Scene-Preview-1'],
    ['점으로 시작(형식 오류)', '.scene-preview-1'],
    ['160자 초과(형식 오류)', `scene-preview-${'a'.repeat(160)}`],
  ])('%s 는 기본 바닥으로 갈음하지 않고 SCENE_VERSION_NOT_FOUND 404 다', async (_name, version) => {
    const response = await view(version);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: 404, code: 'SCENE_VERSION_NOT_FOUND' });
  });
});

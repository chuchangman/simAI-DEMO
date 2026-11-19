import {
  IDLE_LOAD,
  readCurrentScene,
  sceneStatusOf,
  verifyScene,
  type CurrentScene,
  type SceneLoad,
  type SceneVersions,
} from '@/features/viewer3d/scene/sceneContract';
import { describe, expect, it } from 'vitest';

// -59 배경 Scene 입력 계약(BE -264 GET /api/scenes/current 본문)과 상태·표시 판정.

const NOW = 1_760_342_400_000;
const committed = (patch: Record<string, unknown> = {}) => ({
  scene_version: 'scene-4',
  state: 'COMMITTED',
  default: false,
  calibration_version: 'cal-2',
  committed_at_ms: NOW - 60_000,
  quality: { reprojection_px: 1.2 },
  gltf_url: 'https://bucket.example/scenes/scene-4.glb?X-Amz-Signature=abc',
  gltf_expires_at_ms: NOW + 300_000,
  ...patch,
});
// GET /api/scenes/{scene_version}/view 의 세팅 미리보기: 확정 전이라 committed_at_ms 가 null 이고 current 가 더 실린다.
const candidate = (patch: Record<string, unknown> = {}) =>
  committed({
    scene_version: 'scene-preview-1',
    state: 'CANDIDATE',
    committed_at_ms: null,
    current: false,
    ...patch,
  });
const defaultScene = (patch: Record<string, unknown> = {}) =>
  committed({
    scene_version: 'scene-default',
    state: 'DEFAULT',
    default: true,
    calibration_version: null,
    committed_at_ms: null,
    ...patch,
  });

const COMPAT = {
  scene_version: 'scene-4',
  calibration_version: 'cal-2',
  verification: 'VERIFIED' as const,
  regeneration_required: false,
  reason: 'SMALL_CHANGE' as const,
  max_center_delta_m: 0.02,
  max_rotation_delta_rad: 0.01,
};
const MATCH: SceneVersions = {
  compatibility: COMPAT,
  worldScene: 'scene-4',
  worldCalibration: 'cal-2',
  healthCommitted: 'scene-4',
  healthLive: 'scene-4',
  healthMismatch: false,
};
const UNKNOWN: SceneVersions = {
  worldScene: null,
  worldCalibration: null,
  healthCommitted: null,
  healthLive: null,
  healthMismatch: null,
};
const loaded = (sceneVersion = 'scene-4'): SceneLoad => ({
  phase: 'LOADED',
  sceneVersion,
  reason: null,
  boundsWorld: { min: [0, 0, 0], max: [10, 10, 3] },
});

const sceneOf = (raw: unknown): CurrentScene => {
  const read = readCurrentScene(raw);
  if (!read.ok) throw new Error(read.reason);
  return read.scene;
};

describe('readCurrentScene', () => {
  it('COMMITTED·CANDIDATE·DEFAULT 응답을 그대로 읽는다(quality 는 쓰지 않는다)', () => {
    expect(sceneOf(committed())).toEqual({
      sceneVersion: 'scene-4',
      state: 'COMMITTED',
      calibrationVersion: 'cal-2',
      committedAtMs: NOW - 60_000,
      gltfUrl: 'https://bucket.example/scenes/scene-4.glb?X-Amz-Signature=abc',
      gltfExpiresAtMs: NOW + 300_000,
    });
    expect(sceneOf(defaultScene())).toMatchObject({
      state: 'DEFAULT',
      calibrationVersion: null,
      committedAtMs: null,
    });
    // /view 의 CANDIDATE: 확정 시각이 없고 compatibility 도 없다. current 같은 모르는 필드는 무시한다.
    expect(sceneOf(candidate())).toEqual({
      sceneVersion: 'scene-preview-1',
      state: 'CANDIDATE',
      calibrationVersion: 'cal-2',
      committedAtMs: null,
      gltfUrl: 'https://bucket.example/scenes/scene-4.glb?X-Amz-Signature=abc',
      gltfExpiresAtMs: NOW + 300_000,
    });
    expect(sceneOf(candidate({ calibration_version: null })).calibrationVersion).toBeNull();
    // 저장소를 쓸 수 없으면 주소 없이 Scene 정보만 온다.
    expect(sceneOf(committed({ gltf_url: null, gltf_expires_at_ms: null }))).toMatchObject({
      gltfUrl: null,
      gltfExpiresAtMs: null,
    });
    // 같은 출처 경로·blob 주소도 받는다.
    expect(sceneOf(committed({ gltf_url: '/assets/scene.gltf' })).gltfUrl).toBe(
      '/assets/scene.gltf',
    );
    // map_cameras 가 있으면 읽어서 보존하고, 없으면 생략한다.
    const withMapCameras = sceneOf(
      committed({
        map_cameras: {
          cam_A: {
            image_size: [2304, 1296],
            K: [
              [1100, 0, 1152],
              [0, 1100, 648],
              [0, 0, 1],
            ],
            R: [
              [0, -1, 0],
              [0, 0, -1],
              [1, 0, 0],
            ],
            t: [-0.5, 2.5, 1.2],
            pose_source: 'MA_ALIGNED_SIM3',
          },
        },
      }),
    );
    expect(withMapCameras.mapCameras?.cam_A.poseSource).toBe('MA_ALIGNED_SIM3');
    expect(withMapCameras.mapCameras?.cam_A.imageSize).toEqual([2304, 1296]);
    expect(withMapCameras.mapCameras?.cam_A.t).toEqual([-0.5, 2.5, 1.2]);
  });

  it.each([
    ['객체 아님', null, '응답이 객체가 아니다'],
    ['배열', [], '응답이 객체가 아니다'],
    ['버전 없음', committed({ scene_version: ' ' }), 'scene_version 이 비었다'],
    [
      '상태 오류',
      committed({ state: 'DRAFT' }),
      'state 는 COMMITTED·CANDIDATE·DEFAULT 중 하나여야 한다',
    ],
    [
      'CANDIDATE 인데 default true',
      candidate({ default: true }),
      'default 와 state 가 맞지 않는다',
    ],
    ['default 불일치', committed({ default: true }), 'default 와 state 가 맞지 않는다'],
    ['default 누락', committed({ default: undefined }), 'default 와 state 가 맞지 않는다'],
    [
      'COMMITTED 보정 없음',
      committed({ calibration_version: null }),
      'COMMITTED Scene 에 calibration_version 이 없다',
    ],
    ['보정 형식', committed({ calibration_version: 3 }), 'calibration_version 형식이 틀렸다'],
    ['확정 시각 형식', committed({ committed_at_ms: '1' }), 'committed_at_ms 형식이 틀렸다'],
    [
      'javascript 주소',
      committed({ gltf_url: 'javascript:alert(1)' }),
      'gltf_url 이 읽을 수 있는 주소가 아니다',
    ],
    [
      'file 주소',
      committed({ gltf_url: 'file:///c/x.glb' }),
      'gltf_url 이 읽을 수 있는 주소가 아니다',
    ],
    ['만료 형식', committed({ gltf_expires_at_ms: NaN }), 'gltf_expires_at_ms 형식이 틀렸다'],
    ['빈 map_cameras', committed({ map_cameras: {} }), 'map_cameras 형식이 틀렸다'],
    [
      '잘못된 map_cameras pose_source',
      committed({
        map_cameras: {
          cam_A: {
            image_size: [2304, 1296],
            K: [
              [1100, 0, 1152],
              [0, 1100, 648],
              [0, 0, 1],
            ],
            R: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
            t: [0, 0, 0],
            pose_source: 'UNKNOWN_SOURCE',
          },
        },
      }),
      'map_cameras 형식이 틀렸다',
    ],
  ])('%s 이면 거부하고 주소를 이유에 넣지 않는다', (_name, raw, reason) => {
    const read = readCurrentScene(raw);
    expect(read).toEqual({ ok: false, reason });
    expect(JSON.stringify(read)).not.toContain('X-Amz');
  });
});

describe('verifyScene', () => {
  const scene = sceneOf(committed());

  it('현재 World에 결속된 서버 판정이 VERIFIED면 유지한다', () => {
    expect(verifyScene(scene, MATCH)).toEqual({ verification: 'VERIFIED', mismatches: [] });
  });

  it('DEFAULT 는 버전과 관계없이 정합 근거가 없다', () => {
    expect(verifyScene(sceneOf(defaultScene()), MATCH).verification).toBe('DEFAULT_UNVERIFIED');
  });

  it('World 가 아직 없으면 UNCONFIRMED', () => {
    expect(verifyScene(scene, UNKNOWN)).toEqual({ verification: 'UNCONFIRMED', mismatches: [] });
    expect(verifyScene(scene, { ...UNKNOWN, worldScene: 'scene-4' }).verification).toBe(
      'UNCONFIRMED',
    );
  });

  it('어긋난 항목을 모두 적는다', () => {
    expect(
      verifyScene(scene, {
        worldScene: 'scene-5',
        worldCalibration: 'cal-3',
        healthCommitted: 'scene-5',
        healthLive: 'scene-5',
        healthMismatch: true,
      }),
    ).toEqual({
      verification: 'MISMATCH',
      mismatches: ['world.scene_version=scene-5', 'health.scene.committed_version=scene-5'],
    });
    // 기존 mismatch 불리언만으로 World 계보를 추측하지 않는다.
    expect(verifyScene(scene, { ...UNKNOWN, healthMismatch: true }).verification).toBe(
      'UNCONFIRMED',
    );
  });
});

describe('sceneStatusOf', () => {
  it('입력이 없으면 NONE·HIDDEN', () => {
    expect(sceneStatusOf(null, IDLE_LOAD, MATCH)).toMatchObject({
      phase: 'NONE',
      display: 'HIDDEN',
      needsRefetch: false,
      axisConvention: 'GLTF_Y_UP_ASSUMED',
    });
  });

  it('조회 실패는 UNAVAILABLE 이고 401·403 만 다시 받기를 요청한다', () => {
    const notFound = sceneStatusOf(
      { ok: false, reason: 'SCENE_NOT_FOUND', httpStatus: 404 },
      IDLE_LOAD,
      MATCH,
    );
    expect(notFound).toMatchObject({
      phase: 'UNAVAILABLE',
      reason: 'SCENE_NOT_FOUND',
      needsRefetch: false,
      display: 'HIDDEN',
    });
    for (const httpStatus of [401, 403]) {
      expect(
        sceneStatusOf({ ok: false, reason: 'AUTH', httpStatus }, IDLE_LOAD, MATCH).needsRefetch,
      ).toBe(true);
    }
  });

  it('형식 오류는 REJECTED, 주소 없음은 NO_ASSET 이고 둘 다 숨긴다', () => {
    expect(
      sceneStatusOf({ ok: true, raw: committed({ state: 'X' }) }, IDLE_LOAD, MATCH),
    ).toMatchObject({ phase: 'REJECTED', display: 'HIDDEN', sceneVersion: null });
    expect(
      sceneStatusOf({ ok: true, raw: committed({ gltf_url: null }) }, IDLE_LOAD, MATCH),
    ).toMatchObject({
      phase: 'NO_ASSET',
      display: 'HIDDEN',
      sceneVersion: 'scene-4',
      verification: 'VERIFIED',
    });
  });

  it('표시 규칙: VERIFIED·LOADED 만 FULL, 근거 없음은 DIMMED, 불일치·미적재는 HIDDEN', () => {
    const input = { ok: true as const, raw: committed() };
    expect(sceneStatusOf(input, loaded(), MATCH)).toMatchObject({
      phase: 'LOADED',
      display: 'FULL',
      boundsWorld: { min: [0, 0, 0], max: [10, 10, 3] },
    });
    expect(sceneStatusOf(input, loaded(), UNKNOWN).display).toBe('DIMMED');
    expect(
      sceneStatusOf({ ok: true, raw: defaultScene() }, loaded('scene-default'), MATCH).display,
    ).toBe('DIMMED');
    expect(sceneStatusOf(input, loaded(), { ...MATCH, worldScene: 'scene-5' })).toMatchObject({
      display: 'HIDDEN',
      verification: 'MISMATCH',
    });
    // 읽기 전(IDLE)은 LOADING 으로 보인다.
    expect(sceneStatusOf(input, IDLE_LOAD, MATCH)).toMatchObject({
      phase: 'LOADING',
      display: 'HIDDEN',
    });
  });

  it('확정 전 CANDIDATE 도 COMMITTED 처럼 적재해 보인다', () => {
    const input = { ok: true as const, raw: candidate() };
    expect(sceneStatusOf(input, loaded('scene-preview-1'), UNKNOWN)).toMatchObject({
      phase: 'LOADED',
      state: 'CANDIDATE',
      sceneVersion: 'scene-preview-1',
      display: 'DIMMED',
    });
    expect(sceneStatusOf(input, IDLE_LOAD, UNKNOWN)).toMatchObject({
      phase: 'LOADING',
      state: 'CANDIDATE',
    });
  });

  it('다른 Scene 의 읽기 결과는 섞지 않는다', () => {
    expect(sceneStatusOf({ ok: true, raw: committed() }, loaded('scene-3'), MATCH)).toMatchObject({
      phase: 'LOADING',
      display: 'HIDDEN',
      boundsWorld: null,
    });
  });

  it('같은 Scene 을 이미 읽었으면 주소 없음·만료 응답에도 그 자산을 쓴다', () => {
    const noUrl = {
      ok: true as const,
      raw: committed({ gltf_url: null, gltf_expires_at_ms: null }),
    };
    expect(sceneStatusOf(noUrl, loaded(), MATCH)).toMatchObject({
      phase: 'LOADED',
      display: 'FULL',
    });
    expect(sceneStatusOf(noUrl, loaded('scene-3'), MATCH).phase).toBe('NO_ASSET');
  });

  it('만료면 다시 받기를 요청하고, 실패는 이유만 둔다', () => {
    const input = { ok: true as const, raw: committed() };
    const at = (phase: 'EXPIRED' | 'FAILED', reason: string): SceneLoad => ({
      phase,
      sceneVersion: 'scene-4',
      reason,
      boundsWorld: null,
    });
    expect(sceneStatusOf(input, at('EXPIRED', 'HTTP 403'), MATCH)).toMatchObject({
      phase: 'EXPIRED',
      needsRefetch: true,
      display: 'HIDDEN',
      reason: 'HTTP 403',
    });
    expect(sceneStatusOf(input, at('FAILED', 'HTTP 404'), MATCH)).toMatchObject({
      phase: 'FAILED',
      needsRefetch: false,
      display: 'HIDDEN',
    });
  });
});

describe('서버 Scene 계보 판정', () => {
  it('Scene 생성 보정과 현재 보정의 버전이 달라도 같은 World의 작은 변화면 FULL이다', () => {
    const versions = {
      ...MATCH,
      worldCalibration: 'cal-3',
      compatibility: { ...COMPAT, calibration_version: 'cal-3' },
    };
    expect(
      sceneStatusOf(
        { ok: true, raw: committed({ calibration_state: 'PROVISIONAL' }) },
        loaded(),
        versions,
      ),
    ).toMatchObject({
      verification: 'VERIFIED',
      display: 'FULL',
      provisionalBackground: true,
      regenerationRequired: false,
    });
  });
  it('큰 누적 변화는 숨기지 않고 DIMMED와 재생성 필요로 표시한다', () => {
    const versions = {
      ...MATCH,
      compatibility: {
        ...COMPAT,
        verification: 'DIMMED' as const,
        regeneration_required: true,
        reason: 'LARGE_CHANGE' as const,
      },
    };
    expect(sceneStatusOf({ ok: true, raw: committed() }, loaded(), versions)).toMatchObject({
      verification: 'DIMMED',
      display: 'DIMMED',
      regenerationRequired: true,
    });
  });
  it('서버의 다른 World 판정은 HIDDEN이다', () => {
    expect(
      sceneStatusOf({ ok: true, raw: committed() }, loaded(), {
        ...MATCH,
        compatibility: { ...COMPAT, verification: 'MISMATCH', reason: 'DIFFERENT_WORLD' },
      }).display,
    ).toBe('HIDDEN');
  });
  it('보정 전환 중 낡은 서버 판정은 흐리게 유지하고, 판정이 없어도 Scene 과 같은 보정이면 변화 0 이라 VERIFIED 다', () => {
    expect(
      verifyScene(sceneOf(committed()), { ...MATCH, worldCalibration: 'cal-new' }).verification,
    ).toBe('UNCONFIRMED');
    const scene = sceneOf(committed());
    expect(
      verifyScene(scene, {
        ...MATCH,
        worldCalibration: scene.calibrationVersion,
        compatibility: undefined,
      }).verification,
    ).toBe('VERIFIED');
    expect(
      verifyScene(scene, { ...MATCH, worldCalibration: 'cal-other', compatibility: undefined })
        .verification,
    ).toBe('UNCONFIRMED');
  });
  it('새 활성 Scene을 받으면 자산을 다시 조회한다', () => {
    expect(
      sceneStatusOf({ ok: true, raw: committed() }, loaded(), {
        ...MATCH,
        healthCommitted: 'scene-next',
      }).needsRefetch,
    ).toBe(true);
  });
  it('잘못된 REST 판정과 Scene 결속을 거부하고 유효한 REST 판정은 health 전에 사용한다', () => {
    expect(
      readCurrentScene(committed({ compatibility: { ...COMPAT, scene_version: 'other' } })).ok,
    ).toBe(false);
    expect(
      readCurrentScene(committed({ compatibility: { ...COMPAT, max_rotation_delta_rad: -1 } })).ok,
    ).toBe(false);
    expect(
      sceneStatusOf({ ok: true, raw: committed({ compatibility: COMPAT }) }, loaded(), {
        ...MATCH,
        compatibility: undefined,
      }).display,
    ).toBe('FULL');
  });
});

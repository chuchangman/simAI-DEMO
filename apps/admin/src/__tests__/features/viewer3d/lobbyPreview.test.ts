import { readSceneOption, sceneInputOf } from '@/features/viewer3d/dev-harness/devScene';
import { DEV_LOBBY_GLB_URL, readCamPose } from '@/features/viewer3d/dev-harness/lobbyPreview';
import { sceneStatusOf } from '@/features/viewer3d/scene/sceneContract';
import { describe, expect, it } from 'vitest';

// -59 실측 로비 재구성 프리뷰(개발 화면). 자산은 저장소 밖 로컬 캐시에만 있고, 입력은 COMMITTED·보정을 꾸미지 않는다.

describe('lobby-preview 개발 배경', () => {
  it('?scene=lobby-preview 를 읽는다', () => {
    expect(readSceneOption('?scene=lobby-preview')).toBe('lobby-preview');
  });

  it('DEFAULT·보정 없음으로 넘겨 판정이 DEFAULT_UNVERIFIED 로 남는다', () => {
    const input = sceneInputOf('lobby-preview', Date.now());
    if (!input?.ok) throw new Error('lobby-preview 입력이 없다');
    expect(input.raw).toMatchObject({
      scene_version: 'lobby-recon-preview',
      state: 'DEFAULT',
      default: true,
      calibration_version: null,
      committed_at_ms: null,
    });
    expect(String((input.raw as { gltf_url: unknown }).gltf_url).endsWith(DEV_LOBBY_GLB_URL)).toBe(
      true,
    );
    const status = sceneStatusOf(
      input,
      { phase: 'LOADED', sceneVersion: 'lobby-recon-preview', reason: null, boundsWorld: null },
      {
        worldScene: null,
        worldCalibration: null,
        healthCommitted: null,
        healthLive: null,
        healthMismatch: null,
      },
    );
    expect(status).toMatchObject({
      state: 'DEFAULT',
      verification: 'DEFAULT_UNVERIFIED',
      display: 'DIMMED',
    });
  });

  it('camPose 는 안전한 카메라 ID 만 받는다', () => {
    expect(readCamPose('?camPose=cam_A')).toBe('cam_A');
    expect(readCamPose('')).toBeNull();
    expect(readCamPose('?camPose=')).toBeNull();
    expect(readCamPose('?camPose=../x')).toBeNull();
    expect(readCamPose(`?camPose=${'a'.repeat(33)}`)).toBeNull();
  });
});

import { requestSceneCameraImages, type SceneCameraImages } from '@/features/layout/api';
import {
  CAMERA_IMAGES_MIN_RELOAD_MS,
  CAMERA_IMAGES_REFRESH_MARGIN_MS,
  CAMERA_IMAGES_RETRY_MS,
  cameraImagesSceneVersion,
  cameraImageUrlsOf,
  nextCameraImagesReloadMs,
} from '@/features/layout/sceneCameraImages';
import { ApiError, createHttp } from '@/lib/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = 1_762_050_000_000;
const WITH_IMAGES: SceneCameraImages = {
  scene_version: 'scene-a',
  bundle_id: 'bundle-3f6c2b1a9d8e4f70a1b2c3d4e5f60718',
  expires_at_ms: NOW + 300_000,
  images: [
    { camera_id: 'cam_A', url: 'https://s3.test/a.jpg?sig=1' },
    { camera_id: 'cam_B', url: 'https://s3.test/b.jpg?sig=1' },
  ],
};
const UNKNOWN: SceneCameraImages = {
  scene_version: 'scene-a',
  bundle_id: null,
  expires_at_ms: null,
  images: [],
};

afterEach(() => vi.restoreAllMocks());

describe('Scene 입력 카메라 사진 조회', () => {
  it('Scene 버전을 경로에 넣어 인증된 GET 으로 부르고 계약 모양을 받는다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(WITH_IMAGES), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const http = createHttp({ baseUrl: 'http://api.test', getToken: () => 'scene-token' });
    expect(await requestSceneCameraImages(http, 'scene a/1')).toEqual(WITH_IMAGES);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/scenes/scene%20a%2F1/camera-images');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer scene-token');
  });

  it('묻는 Scene 버전은 받은 본문의 scene_version 이고 기본 Scene·실패·본문 없음이면 묻지 않는다', () => {
    expect(cameraImagesSceneVersion({ ok: true, raw: { scene_version: 'scene-a' } })).toBe(
      'scene-a',
    );
    expect(
      cameraImagesSceneVersion({ ok: true, raw: { scene_version: 'scene-demo', default: true } }),
    ).toBeNull();
    expect(cameraImagesSceneVersion({ ok: true, raw: { scene_version: '' } })).toBeNull();
    expect(cameraImagesSceneVersion({ ok: true, raw: null })).toBeNull();
    expect(cameraImagesSceneVersion({ ok: false, reason: 'x' })).toBeNull();
    expect(cameraImagesSceneVersion(null)).toBeNull();
  });

  it('사진이 있으면 가장 이른 만료 1분 전에 다시 받고 하한은 5초다', () => {
    expect(nextCameraImagesReloadMs(WITH_IMAGES, null, NOW)).toBe(
      300_000 - CAMERA_IMAGES_REFRESH_MARGIN_MS,
    );
    expect(nextCameraImagesReloadMs(WITH_IMAGES, null, NOW + 299_000)).toBe(
      CAMERA_IMAGES_MIN_RELOAD_MS,
    );
    expect(nextCameraImagesReloadMs({ ...WITH_IMAGES, expires_at_ms: null }, null, NOW)).toBe(
      CAMERA_IMAGES_RETRY_MS,
    );
  });

  it('묶음을 모르거나 4xx 면 다시 받지 않고, 연결 실패·5xx·서명 실패는 1분 뒤 다시 받는다', () => {
    expect(nextCameraImagesReloadMs(UNKNOWN, null, NOW)).toBe(false);
    expect(nextCameraImagesReloadMs(undefined, null, NOW)).toBe(false);
    expect(nextCameraImagesReloadMs(undefined, new ApiError(404), NOW)).toBe(false);
    expect(nextCameraImagesReloadMs(WITH_IMAGES, new ApiError(403), NOW)).toBe(false);
    expect(nextCameraImagesReloadMs(undefined, new ApiError(503), NOW)).toBe(
      CAMERA_IMAGES_RETRY_MS,
    );
    expect(nextCameraImagesReloadMs(WITH_IMAGES, new ApiError(0), NOW)).toBe(
      CAMERA_IMAGES_RETRY_MS,
    );
    expect(
      nextCameraImagesReloadMs(
        { ...UNKNOWN, bundle_id: 'bundle-3f6c2b1a9d8e4f70a1b2c3d4e5f60718' },
        null,
        NOW,
      ),
    ).toBe(CAMERA_IMAGES_RETRY_MS);
  });

  it('뷰어에는 지금 Scene 의 사진만 카메라 ID → 주소로 넘기고 없으면 undefined', () => {
    expect(cameraImageUrlsOf(WITH_IMAGES, 'scene-a')).toEqual({
      cam_A: 'https://s3.test/a.jpg?sig=1',
      cam_B: 'https://s3.test/b.jpg?sig=1',
    });
    expect(cameraImageUrlsOf(WITH_IMAGES, 'scene-b')).toBeUndefined();
    expect(cameraImageUrlsOf(WITH_IMAGES, null)).toBeUndefined();
    expect(cameraImageUrlsOf(UNKNOWN, 'scene-a')).toBeUndefined();
    expect(cameraImageUrlsOf(undefined, 'scene-a')).toBeUndefined();
  });
});

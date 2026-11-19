import type { SceneCameraImages } from '@/features/layout/api';
import type { ViewerSceneInput } from '@/features/viewer3d';
import { ApiError } from '@/lib/http';

// Scene 입력 카메라 사진 서명 주소(S15P31A101-592)를 언제 다시 받을지와 뷰어에 넘길 모양. 화면 없이 시험한다.

/** 서명 주소가 만료되기 이 시간(ms) 전에 새로 받는다. EC2 와 이 브라우저의 시계 차이를 넉넉히 본다(평면도와 같은 값). */
export const CAMERA_IMAGES_REFRESH_MARGIN_MS = 60_000;
/** 새로 받는 간격의 하한(ms). 만료 시각이 잘못 와도 요청이 몰리지 않게 한다. */
export const CAMERA_IMAGES_MIN_RELOAD_MS = 5_000;
/** 받지 못했거나(연결·5xx) 묶음은 아는데 서명하지 못했을 때 다시 시도하는 간격(ms). */
export const CAMERA_IMAGES_RETRY_MS = 60_000;

/**
 * 사진을 물을 Scene 버전. 받은 본문이 없거나 시연용 기본 Scene(default=true, DB 행이 아니라 입력 묶음이 없다)이면 null.
 * 형식 판단은 뷰어가 맡으므로 여기서는 scene_version 문자열만 꺼낸다.
 */
export function cameraImagesSceneVersion(
  scene: ViewerSceneInput | null | undefined,
): string | null {
  if (!scene?.ok || typeof scene.raw !== 'object' || scene.raw === null) return null;
  if (Reflect.get(scene.raw, 'default') === true) return null;
  const version: unknown = Reflect.get(scene.raw, 'scene_version');
  return typeof version === 'string' && version.trim() !== '' ? version : null;
}

/**
 * 다음에 받을 때까지(ms). false 면 이 Scene 은 다시 받지 않는다.
 * - 4xx(없는 Scene·권한 없음): 다시 물어도 같으므로 받지 않는다(Scene 이 바뀌면 키가 바뀌어 새로 묻는다).
 * - 연결 실패·5xx: CAMERA_IMAGES_RETRY_MS 뒤.
 * - 묶음을 모름(bundle_id null): 받지 않는다. 묶음은 아는데 사진이 없으면(저장소 서명 실패) RETRY 뒤.
 * - 사진이 있으면 가장 이른 만료 1분 전(하한 5초).
 */
export function nextCameraImagesReloadMs(
  data: SceneCameraImages | undefined,
  error: unknown,
  now: number,
): number | false {
  if (error) {
    return error instanceof ApiError &&
      error.kind === 'HTTP' &&
      error.status >= 400 &&
      error.status < 500
      ? false
      : CAMERA_IMAGES_RETRY_MS;
  }
  if (!data) return false;
  if (data.images.length === 0) return data.bundle_id === null ? false : CAMERA_IMAGES_RETRY_MS;
  if (data.expires_at_ms === null) return CAMERA_IMAGES_RETRY_MS;
  return Math.max(
    CAMERA_IMAGES_MIN_RELOAD_MS,
    data.expires_at_ms - now - CAMERA_IMAGES_REFRESH_MARGIN_MS,
  );
}

/** 카메라 ID → 사진 주소(뷰어 `vdt.cameraImageUrls`). 받은 Scene 이 지금 Scene 과 다르거나 사진이 없으면 undefined(시점 이동만). */
export function cameraImageUrlsOf(
  data: SceneCameraImages | undefined,
  sceneVersion: string | null,
): Readonly<Record<string, string>> | undefined {
  if (!data || sceneVersion === null || data.scene_version !== sceneVersion) return undefined;
  const urls: Record<string, string> = {};
  for (const image of data.images) {
    if (!(image.camera_id in urls)) urls[image.camera_id] = image.url;
  }
  return Object.keys(urls).length > 0 ? urls : undefined;
}

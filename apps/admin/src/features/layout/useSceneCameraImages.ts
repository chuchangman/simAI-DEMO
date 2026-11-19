import { requestSceneCameraImages } from '@/features/layout/api';
import {
  cameraImagesSceneVersion,
  cameraImageUrlsOf,
  nextCameraImagesReloadMs,
} from '@/features/layout/sceneCameraImages';
import type { ViewerSceneInput } from '@/features/viewer3d';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * 지금 Scene 을 구운 카메라별 사람 지운 배경 사진 주소(GET /api/scenes/{scene_version}/camera-images, S15P31A101-592).
 * 카메라 시점 VDT(-590)가 이 주소를 그 Scene 의 map_cameras 에 투영한다. Scene 버전을 키로 묻기 때문에 Scene 이 바뀌면
 * 다른 Scene 의 사진을 섞지 않는다. 서명 주소는 만료 1분 전에 다시 받는다. 사진이 없으면 undefined(시점 이동만).
 */
export function useSceneCameraImages(
  scene: ViewerSceneInput | null,
): Readonly<Record<string, string>> | undefined {
  const sceneVersion = cameraImagesSceneVersion(scene);
  const { data } = useQuery({
    queryKey: ['scenes', sceneVersion, 'camera-images'],
    queryFn: ({ signal }) => requestSceneCameraImages(api, sceneVersion ?? '', signal),
    enabled: sceneVersion !== null,
    staleTime: Infinity,
    // 호스트를 다시 열 때는 만료됐을 수 있는 서명 주소를 재사용하지 않는다.
    gcTime: 0,
    refetchInterval: (q) => nextCameraImagesReloadMs(q.state.data, q.state.error, Date.now()),
    refetchIntervalInBackground: true,
  });
  return useMemo(() => cameraImageUrlsOf(data, sceneVersion), [data, sceneVersion]);
}

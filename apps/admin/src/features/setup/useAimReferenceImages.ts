import { requestSceneCameraImages } from '@/features/layout/api';
import { cameraImageUrlsOf, nextCameraImagesReloadMs } from '@/features/layout/sceneCameraImages';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * 기준 시점 맞추기의 기준 사진(S15P31A101-765): 헬퍼가 비교한 기준 맵(aim_check.scene_version)을 구운 카메라별 사람 지운 배경 사진 주소.
 * 뷰어 VDT 가 쓰는 같은 REST(GET /api/scenes/{scene_version}/camera-images, -592)와 같은 다시 받기 규칙을 쓴다(서명 주소 만료 1분 전).
 * 기준이 없으면(null) 묻지 않는다. 사진이 없으면 undefined(겹쳐 보기 단추를 숨긴다).
 */
export function useAimReferenceImages(
  sceneVersion: string | null,
): Readonly<Record<string, string>> | undefined {
  const { data } = useQuery({
    queryKey: ['scenes', sceneVersion, 'camera-images'],
    queryFn: ({ signal }) => requestSceneCameraImages(api, sceneVersion ?? '', signal),
    enabled: sceneVersion !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchInterval: (q) => nextCameraImagesReloadMs(q.state.data, q.state.error, Date.now()),
    refetchIntervalInBackground: true,
  });
  return useMemo(() => cameraImageUrlsOf(data, sceneVersion), [data, sceneVersion]);
}

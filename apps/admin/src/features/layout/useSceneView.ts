import { currentSceneQuery, sceneViewQuery, useSceneQuery } from '@/features/layout/useSceneQuery';

/** 호스트가 그릴 배경. 버전을 주면 그 버전(/view), 없으면 지금 관제 Scene(/current). */
export function useSceneOrCurrent(sceneVersion: string | null) {
  return useSceneQuery(sceneVersion ? sceneViewQuery(sceneVersion) : currentSceneQuery);
}

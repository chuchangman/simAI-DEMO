import { currentSceneQuery, useSceneQuery } from '@/features/layout/useSceneQuery';

/** 현재 배경. 조회 실패에는 마지막 본문을 유지하고, 처음 받기 전에는 기본 바닥을 쓴다. */
export function useCurrentScene() {
  return useSceneQuery(currentSceneQuery);
}

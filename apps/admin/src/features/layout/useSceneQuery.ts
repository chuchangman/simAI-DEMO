import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { DEMO_MAP_GLB_URL, withDemoMap } from '@/features/demo/demoMap';
import { requestCurrentScene, requestSceneView } from '@/features/layout/api';
import type { ViewerSceneInput, ViewerSceneStatus } from '@/features/viewer3d';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { keepPreviousData, skipToken, useQuery, type QueryKey } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

/** 조회 실패·자산 권한 거부가 계속돼도 요청이 몰리지 않게 하는 간격(ms). */
const RELOAD_MS = 10_000;

/** 서버가 버전 형식 오류·없는 버전·보일 자산 없음에 주는 404 코드(GET /api/scenes/{scene_version}/view). */
const SCENE_VERSION_NOT_FOUND = 'SCENE_VERSION_NOT_FOUND';

/** 받을 Scene 이 없을 때(조회를 끈 쿼리) 쓰는 키. 이 키로는 요청하지 않는다. */
const NO_SCENE_KEY = ['scenes', 'none'] as const;

/** 뷰어에 넘길 조회 결과를 만든다. 던지면 쿼리 오류가 되어 마지막 본문을 유지하고 다시 받는다. */
type SceneLoader = (signal: AbortSignal) => Promise<ViewerSceneInput>;

export interface SceneQuery {
  queryKey: QueryKey;
  load: SceneLoader;
}

/** 지금 관제 Scene(GET /api/scenes/current). */
export const currentSceneQuery: SceneQuery = {
  queryKey: ['scenes', 'current'],
  load: async (signal) => ({ ok: true, raw: await requestCurrentScene(api, signal) }),
};

/**
 * 버전을 지정한 Scene(GET /api/scenes/{scene_version}/view, 관리자). 세팅 미리보기·정밀 맵 같은 확정 전(CANDIDATE) Scene 도 낸다.
 * 서버는 기본 바닥으로 갈음하지 않고 404 를 주므로, 뷰어에 "받지 못했다"(UNAVAILABLE)를 알린다.
 */
export function sceneViewQuery(sceneVersion: string): SceneQuery {
  return {
    queryKey: ['scenes', 'view', sceneVersion],
    load: async (signal) => {
      try {
        return { ok: true, raw: await requestSceneView(api, sceneVersion, signal) };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        return { ok: false, reason: error.code ?? SCENE_VERSION_NOT_FOUND, httpStatus: 404 };
      }
    },
  };
}

/**
 * 뷰어에 넘길 Scene 입력 하나를 받는다. 조회 실패에는 마지막 본문을 유지하고, 처음 받기 전에는 기본 바닥을 쓴다.
 * 서명 주소 만료·권한 거부(뷰어의 needsRefetch)에는 즉시 다시 받고, 반복되면 10초 간격으로 제한한다. 쿼리가 null 이면 받지 않는다.
 * 시연 계정이고 코드에 시연 GLB 가 있으면 받은 Scene 의 3D 맵을 그 GLB 로 바꾼다(features/demo/demoMap).
 */
export function useSceneQuery(query: SceneQuery | null) {
  const [sceneStatus, setSceneStatus] = useState<ViewerSceneStatus | null>(null);
  const [needsRefetch, setNeedsRefetch] = useState(false);
  const nextRefetchAt = useRef(0);
  const demoGlb = useIsDemoAccount() ? DEMO_MAP_GLB_URL : null;
  const { data, refetch } = useQuery({
    queryKey: [...(query?.queryKey ?? NO_SCENE_KEY), ...(demoGlb ? ['demo-map'] : [])],
    queryFn: query
      ? async ({ signal }): Promise<ViewerSceneInput> => {
          const input = await query.load(signal);
          return demoGlb && input.ok ? { ok: true, raw: withDemoMap(input.raw, demoGlb) } : input;
        }
      : skipToken,
    staleTime: Infinity,
    // 호스트를 다시 열 때는 만료됐을 수 있는 서명 주소를 재사용하지 않는다.
    gcTime: 0,
    // 받을 버전이 바뀌면(미리보기 → 정밀) 새 본문이 올 때까지 이전 배경을 그대로 둔다.
    placeholderData: keepPreviousData,
    // 404 로 못 받은 Scene 도 다시 받아 본다(자산이 늦게 보일 수 있다).
    refetchInterval: (q) =>
      q.state.status === 'error' || needsRefetch || q.state.data?.ok === false ? RELOAD_MS : false,
    refetchIntervalInBackground: true,
  });

  const onSceneStatusChange = useCallback(
    (status: ViewerSceneStatus) => {
      setSceneStatus(status);
      setNeedsRefetch(status.needsRefetch);
      if (!status.needsRefetch || Date.now() < nextRefetchAt.current) return;
      // 첫 만료·권한 거부는 즉시 받는다. 같은 신호가 반복되면 위 주기 조회로 회복한다.
      nextRefetchAt.current = Date.now() + RELOAD_MS;
      void refetch({ cancelRefetch: false });
    },
    [refetch],
  );

  return { scene: data ?? null, sceneStatus, onSceneStatusChange };
}

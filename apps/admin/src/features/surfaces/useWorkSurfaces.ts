import { planStaticObjectsView } from '@/features/setup/setupZonePlan';
import { useSetupZonePlanQuery } from '@/features/setup/useSetupZonePlan';
import { requestStaticObjects, STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { readWorkSurfaces, toViewerWorkSurfaces } from '@/features/surfaces/surfaces';
import type { ViewerWorkSurfaces, WorkSurface } from '@/features/surfaces/types';
import { useZoneSource } from '@/features/zones/zoneSource';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/** 받기 전에 돌려주는 빈 목록. 렌더마다 새 배열이 되지 않게 하나만 둔다. */
const NONE: WorkSurface[] = [];

/** 작업면을 받지 못했을 때 다시 시도하는 간격(ms). */
const RELOAD_MS = 10_000;

/**
 * 서버 정적 객체 목록(GET /api/static-objects, 작업면·장애물 모두). 로그인마다 한 번 받고, 받지 못하면 받을 때까지 다시 시도한다.
 * 3D 틀(SpatialViewportHost)이 응답 원문을 그대로 뷰어 Source 에 넘기고, 구역 편집 화면이 같은 조회를 함께 쓴다.
 */
export function useStaticObjectsQuery() {
  const source = useZoneSource();
  const plan = useSetupZonePlanQuery(source?.sessionId ?? null);
  const query = useQuery({
    queryKey: STATIC_OBJECTS_KEY,
    queryFn: ({ signal }) => requestStaticObjects(api, signal),
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.data ? false : RELOAD_MS),
    refetchIntervalInBackground: true,
  });
  // 세팅 구역 단계(-615)는 세션 구역 목록 기준: 목록에 없는 구역의 작업면은 빼고, 목록의 작업면 본문을 덮거나 더한다
  const data = useMemo(() => {
    if (!source) return query.data;
    return plan.data && query.data ? planStaticObjectsView(plan.data, query.data) : undefined;
  }, [source, plan.data, query.data]);
  return { data, isError: query.isError };
}

/**
 * 등록 작업면. 저장하면 응답으로 목록을 바꾼다(조회는 useStaticObjectsQuery 와 같다).
 * raw 는 작업면만 담은 뷰어 묶음이다(3D 에는 틀이 응답 원문을 넣으므로 이 묶음은 넘기지 않는다). 받기 전·실패면 없다.
 */
export function useWorkSurfaces() {
  const query = useStaticObjectsQuery();
  const surfaces = useMemo(() => (query.data ? readWorkSurfaces(query.data) : NONE), [query.data]);
  const raw = useMemo<ViewerWorkSurfaces | undefined>(
    () => (query.data ? toViewerWorkSurfaces(surfaces) : undefined),
    [query.data, surfaces],
  );
  return { surfaces, raw, loaded: query.data !== undefined, failed: query.isError };
}

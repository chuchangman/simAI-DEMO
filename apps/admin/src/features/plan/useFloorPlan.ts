import { FLOOR_PLAN_KEY, requestFloorPlan } from '@/features/plan/floorPlanData';
import { nextReloadMs } from '@/features/plan/floorPlanReload';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

/**
 * 현재 평면도. 서명 주소가 만료되기 전에 새로 받고, 평면도를 만드는 중이면 자주 확인한다.
 * 받지 못하면(404 FLOOR_PLAN_NOT_READY 포함) 이전 값을 두고 다시 시도하며, 화면은 기본 방 크기로 그린다.
 */
export function useFloorPlan() {
  const query = useQuery({
    queryKey: FLOOR_PLAN_KEY,
    queryFn: ({ signal }) => requestFloorPlan(api, signal),
    retry: false,
    refetchInterval: (q) => nextReloadMs(q.state.data, Date.now()),
    refetchIntervalInBackground: true,
  });
  return query.data;
}

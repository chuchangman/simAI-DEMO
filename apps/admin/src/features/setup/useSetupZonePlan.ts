import { requestSetupZonePlan, setupZonePlanKey } from '@/features/setup/api';
import { planRefetchIntervalMs } from '@/features/setup/setupZonePlan';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

/**
 * 세팅 중 구역 목록(-612). sessionId 가 없으면 받지 않는다. 저장하면 응답으로 바꾼다(useZoneCommitMutation).
 * 구역 단계가 새로 열릴 때마다 다시 받아 다른 PC 에서 고친 목록(revision)을 따라간다.
 */
export function useSetupZonePlanQuery(sessionId: string | null) {
  return useQuery({
    queryKey: setupZonePlanKey(sessionId ?? ''),
    queryFn: ({ signal }) => requestSetupZonePlan(api, sessionId!, signal),
    enabled: sessionId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // AI 의견 대기 중이면 짧게, 전·후 사진 서명 주소가 끝나기 전에 다시 받는다(S15P31A101-631)
    refetchInterval: (query) => planRefetchIntervalMs(query.state.data),
    retry: false,
  });
}

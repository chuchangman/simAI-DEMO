import { activeWork } from '@/features/monitor/workSession';
import { requestTbmWorks, TBM_WORKS_KEY } from '@/features/tbm/api';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/** 관제 화면이 작업 목록을 다시 받는 간격(ms). 작업 관리 화면의 시작·종료는 캐시를 바로 무효화하지만, 다른 PC 에서 바꾼 것도 따라온다. */
export const WORKS_REFRESH_MS = 15_000;

/** loading: 아직 모름(받는 중). error: 받지 못했고 받아 둔 것도 없음. ready: 작업 목록을 앎(active 가 null 이면 진행 중인 작업이 없음). */
export type MonitorWorks =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; works: TbmWorkUnit[]; active: TbmWorkUnit | null };

/**
 * 관제 화면이 보는 작업 목록(GET /api/work-units, 작업 관리와 같은 캐시 TBM_WORKS_KEY).
 * passive 면 캐시만 구독하고 요청하지 않는다(이벤트 패널처럼 어느 화면에나 늘 올라 있는 곳이
 * 관제 밖 화면에서 작업 목록을 받지 않게 한다). 모르는 동안(loading·error)은 "작업 없음"으로 보지 않는다.
 */
export function useMonitorWorks({ passive = false }: { passive?: boolean } = {}): MonitorWorks {
  const query = useQuery({
    queryKey: TBM_WORKS_KEY,
    queryFn: ({ signal }) => requestTbmWorks(api, signal),
    enabled: !passive,
    refetchInterval: passive ? false : WORKS_REFRESH_MS,
  });
  const works = query.data;
  const isError = query.isError;
  return useMemo<MonitorWorks>(() => {
    if (works) return { state: 'ready', works, active: activeWork(works) };
    return isError ? { state: 'error' } : { state: 'loading' };
  }, [works, isError]);
}

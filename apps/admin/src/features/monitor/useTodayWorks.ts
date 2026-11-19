import { useNow } from '@/features/layout/useNow';
import { standbyKindOf, todayWorks, type StandbyKind } from '@/features/monitor/todayWorks';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import { useZoneEditActive } from '@/features/monitor/useZoneEditActive';
import { todayIsoDate } from '@/features/tbm/taskInput';
import { useMemo } from 'react';

/** 자정을 넘기면 오늘이 바뀐다. 날짜를 다시 보는 간격(ms). */
const TODAY_RECHECK_MS = 60_000;

/**
 * loading: 아직 모름(받는 중). error: 받지 못했고 받아 둔 것도 없음.
 * ready: standby 는 지금 관제할 작업(작업 중이거나 세팅을 마친 작업)이 없어 보일 대기 화면의 종류다. 관제할 작업이 있으면 null.
 */
export type TodayWorks =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; standby: StandbyKind | null };

/**
 * 관제 화면이 보는 오늘 작업 상태(useMonitorWorks 의 목록을 오늘 기준으로 거른다). passive 면 캐시만 구독한다.
 * 모르는 동안(loading·error)은 대기로 보지 않는다.
 */
export function useTodayWorks(options: { passive?: boolean } = {}): TodayWorks {
  const monitor = useMonitorWorks(options);
  const today = todayIsoDate(new Date(useNow(TODAY_RECHECK_MS)));
  return useMemo<TodayWorks>(() => {
    if (monitor.state !== 'ready') return monitor;
    return { state: 'ready', standby: standbyKindOf(todayWorks(monitor.works, today)) };
  }, [monitor, today]);
}

/**
 * 대기 화면이 떠 있어 아래 층(도구 모음·칼럼·2D 지도)을 막아야 하는지. 구역 편집 중에는 대기 화면을 그리지 않으므로
 * false 다(편집 패널의 편집 끝내기가 막히지 않게). 캐시만 읽어 요청하지 않는다.
 */
export function useMonitorStandby(): boolean {
  const works = useTodayWorks({ passive: true });
  const editing = useZoneEditActive();
  return works.state === 'ready' && works.standby !== null && !editing;
}

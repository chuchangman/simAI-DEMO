import { withoutCleared } from '@/features/events/entries';
import { useClearedAt } from '@/features/events/eventClear.store';
import { useLiveEvents } from '@/features/events/useLiveEvents';
import { useMemo } from 'react';

/**
 * 「모두 지우기」 뒤의 이벤트만 주는 useLiveEvents. 상단 배너·이벤트 패널·경보음·2D 평면이 쓴다.
 * 「지난 관제」(해소 전이지만 지금 Tier 0 가 들고 있지 않음)는 여기서 빼지 않는다. 패널이 접힌 칸으로 보이고,
 * 배너·소리·2D 평면은 isAlarming·isCurrent 로 거른다(S15P31A101-595).
 * 이벤트 캐시는 거르지 않는다(확인·재연결·오프라인 재전송이 전체를 쓴다).
 */
export function useVisibleLiveEvents() {
  const live = useLiveEvents();
  const clearedAt = useClearedAt();
  const entries = useMemo(() => withoutCleared(live.entries, clearedAt), [live.entries, clearedAt]);
  return { ...live, entries };
}

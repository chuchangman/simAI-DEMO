import { latestStageStart, withoutStaleAcked } from '@/features/events/entries';
import { useEventClearStore } from '@/features/events/eventClear.store';
import { EventPanel } from '@/features/events/EventPanel';
import type { Incident } from '@/features/events/events';
import { useEventsStore } from '@/features/events/events.store';
import { ec2Now } from '@/features/events/format';
import type { EventItem } from '@/features/events/types';
import { useMinuteNow } from '@/features/events/useSharedNow';
import { useVisibleLiveEvents } from '@/features/events/useVisibleLiveEvents';
import { useGpuKnownOff } from '@/features/gpu/useGpu';
import { PastEventsLink } from '@/features/monitor/PastEventsLink';
import { useMonitorWorks } from '@/features/monitor/useMonitorWorks';
import { outsideWorkKind, splitSince, workStartedAt } from '@/features/monitor/workSession';
import { useCachedWatchBindings } from '@/features/watch/useWatch';
import { useRealtimeStore } from '@/store/realtime.store';
import { useCallback, useEffect, useMemo } from 'react';

/**
 * 오른쪽 이벤트 패널. 이벤트 목록은 자주 바뀌어 여기서 직접 받는다(틀 전체가 다시 그려지지 않는다).
 * 패널이 없는 화면에서도 목록 조회는 이어지게 이 컴포넌트는 늘 두고 그리기만 거른다.
 * 「목록에서 숨기기」는 화면에서만 숨긴다(서버·이벤트 캐시·확인 상태는 그대로).
 *
 * 진행 중인 작업이 있으면 지금 실행이 시작된 뒤의 이벤트만 기본으로 보이고(확인 대기 경보는 가리지 않는다),
 * 그 전 이벤트 수는 목록 아래에 한 줄로 알린다. 경보 배너·소리·2D 평면은 이 거름과 상관없이 전체를 쓴다.
 * 진행 중인 실행이 없으면(작업 전·대기) 「최근 해소」를 비운다(S15P31A101-731: 지금 실행 이벤트만, 작업 종료 때 Tier 0 가 한꺼번에 닫은 것이
 * 대기 화면에 남지 않게). 진행 중 경보는 실행과 상관없이 보인다.
 * 작업 구역 밖이거나 진행 중인 작업이 없을 때 난 이벤트에는 「작업 구역 밖」·「작업 시간 외」 꼬리표가 붙는다.
 * 운영자가 확인한 지 24시간(ACK_HIDE_AFTER_MS)이 지난 이벤트는 이 패널에서만 숨긴다(배너·소리·2D 평면은 그대로).
 * 작업 목록은 관제 화면(MonitorPage·세션 바)이 받아 둔 캐시만 구독한다(여기서 요청하지 않는다).
 * 워치가 배정된 World ID 는 배정이 풀려도 기억해(realtime.store 의 trackLife) 그 사람의 사라짐 카드를 유령 트랙으로 접지 않는다(S15P31A101-785).
 */
export function HostEventPanel({
  visible,
  selectedKey,
  onSelect,
}: {
  visible: boolean;
  selectedKey: string | null;
  onSelect: (incident: Incident) => void;
}) {
  const { entries: visibleEntries, loaded, failed } = useVisibleLiveEvents();
  const watchBindings = useCachedWatchBindings();
  useEffect(() => {
    useRealtimeStore.getState().noteWatchedIds(watchBindings.map((b) => b.world_id));
  }, [watchBindings]);
  const works = useMonitorWorks({ passive: true });
  const active = works.state === 'ready' ? works.active : null;
  const since = active ? workStartedAt(active) : null;
  const { shown: sinceShown, hidden } = useMemo(
    () => splitSince(visibleEntries, since),
    [visibleEntries, since],
  );
  // 확인한 지 오래된(24시간) 이벤트는 패널에서만 뺀다. 분이 바뀔 때만 다시 따져 목록을 매 초 다시 그리지 않는다.
  const minuteNow = useMinuteNow();
  // EC2 시계 차이(health, 매 초 갱신)는 구독하지 않고 다시 따질 때만 읽는다: 구독하면 패널이 매 초 다시 그려진다.
  const entries = useMemo(
    () =>
      withoutStaleAcked(
        sinceShown,
        ec2Now(minuteNow, useRealtimeStore.getState().health?.clockOffsetMs),
      ),
    [sinceShown, minuteNow],
  );
  const knownWorks = works.state === 'ready' ? works.works : null;
  const outsideWork = useCallback(
    (event: EventItem) => (knownWorks !== null ? outsideWorkKind(event, knownWorks) : null),
    [knownWorks],
  );
  // 작업 목록을 받았으면 지금 실행 시작(진행 중 작업이 없으면 null = 실행 없음). 받기 전이거나 시작 시각을 모르면 undefined(거르지 않음).
  const runStartedAt = works.state !== 'ready' ? undefined : active ? (since ?? undefined) : null;
  const gpuOff = useGpuKnownOff();
  const openEventId = useEventsStore((s) => s.openEventId);
  const openEvent = useEventsStore((s) => s.openEvent);
  const clearAll = useEventClearStore((s) => s.clearAll);
  const clearShown = () => {
    const at = latestStageStart(entries);
    if (at !== null) clearAll(at);
  };
  if (!visible) return null;
  return (
    <EventPanel
      entries={entries}
      loaded={loaded}
      failed={failed}
      selectedKey={selectedKey}
      onSelect={onSelect}
      openEventId={openEventId}
      onOpen={openEvent}
      onClearAll={clearShown}
      outsideWorkOf={knownWorks !== null ? outsideWork : undefined}
      runStartedAt={runStartedAt}
      gpuOff={gpuOff}
      footer={since !== null && hidden > 0 ? <PastEventsLink hidden={hidden} /> : undefined}
    />
  );
}

import { useVisibleLiveEvents } from '@/features/events/useVisibleLiveEvents';
import { usePersonDisplayMap } from '@/features/people/usePersonDisplay';
import { FloorPlan } from '@/features/plan/FloorPlan';
import { planMarks } from '@/features/plan/plan';
import { usePlanBackdrop } from '@/features/plan/usePlanBackdrop';
import { useWorldFresh } from '@/features/plan/useWorldFresh';
import { useZones } from '@/features/zones/useZones';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import type { FloorCoverage } from '@/lib/floorCoverage';
import { useRealtimeStore } from '@/store/realtime.store';
import type { WorldTrack } from '@simai/contracts';
import { useMemo } from 'react';

const NO_TRACKS: WorldTrack[] = [];

/**
 * 실시간 2D 평면. 앱 연결이 받은 최신 world·구역·진행 중 이벤트(「모두 지우기」 뒤 것)와 현재 평면도로 그리고 3D 뷰어 코드에 기대지 않는다(명세 13.6).
 * world 가 올 때마다(10Hz) 이 컴포넌트만 다시 그린다. 바탕·구역 층은 바뀔 때만 그린다.
 */
export function LivePlan({
  selectedKey,
  onSelect,
  coverage = null,
  className,
}: {
  selectedKey: string | null;
  /** 없으면 고르지 않고 보기만 한다(미니맵). */
  onSelect?: (key: string) => void;
  /** 바닥 감시 범위(-606). 호스트가 켰고 지금 보정에 맞을 때만 넘긴다. */
  coverage?: FloorCoverage | null;
  className?: string;
}) {
  const tracks = useRealtimeStore((s) => s.world?.payload.tracks ?? NO_TRACKS);
  const { zones } = useZones();
  const personNames = usePersonDisplayMap();
  const { entries } = useVisibleLiveEvents();
  const marks = useMemo(() => planMarks(entries), [entries]);
  // 연결이 끊겼거나, 연결은 살아 있어도 world 만 멈췄으면(파이프라인 정지) 위치가 지금 것이 아니다.
  const alive = useLinkAlive();
  const fresh = useWorldFresh();
  // 방 크기와 바탕은 평면도(GET /api/floor-plans/current)에서 온다. 없으면 기본 10×10m 모눈이다.
  const { bounds, backdrop } = usePlanBackdrop();
  return (
    <FloorPlan
      tracks={tracks}
      zones={zones}
      marks={marks}
      selectedKey={selectedKey}
      onSelect={onSelect}
      stale={!alive || !fresh}
      bounds={bounds}
      backdrop={backdrop}
      coverage={coverage}
      personNames={personNames}
      className={className}
    />
  );
}

import type { PersonDisplayMap } from '@/features/people/personDisplay';
import { HoverTip, useDwell } from '@/features/plan/HoverTip';
import {
  boundsDepth,
  boundsWidth,
  markFor,
  personKey,
  PLAN_MARGIN,
  ROOM_BOUNDS,
  trackIds,
  type PlanBackdrop,
  type PlanBounds,
  type PlanMarks,
  type PlanZone,
} from '@/features/plan/plan';
import { PlanCoverage } from '@/features/plan/PlanCoverage';
import { PlanPerson } from '@/features/plan/PlanPerson';
import { PlanRoom } from '@/features/plan/PlanRoom';
import { planTip } from '@/features/plan/planTip';
import { PlanZones } from '@/features/plan/PlanZones';
import type { FloorCoverage } from '@/lib/floorCoverage';
import type { WorldTrack } from '@simai/contracts';
import { cn } from '@simai/ui/lib/utils';

// 위에서 내려다본 2D 평면(명세 13.6 비상 화면, 4.1 BEV 2D 개요). 단위는 m 이고 색은 토큰만 쓴다.
// 데이터는 props 로만 받는다. 실시간 관제는 LivePlan 이 채운다.
// 방 범위(bounds)와 평면도 바탕(backdrop)은 GET /api/floor-plans/current 에서 온다. 없으면 기본 10×10m 에 모눈을 그린다.

/** "오래된 평면도" 글자의 자리와 크기(m). 방 위쪽 여백에 놓는다. */
const OUTDATED_LABEL = { x: 0.1, y: -0.32, fontSize: 0.42 } as const;

/** 방 바깥 여백을 더한 길이(m). */
const withMargin = (extent: number) => extent + PLAN_MARGIN * 2;

export interface FloorPlanProps {
  tracks: readonly WorldTrack[];
  zones: readonly PlanZone[];
  marks: PlanMarks;
  /** 고른 대상(이벤트 패널과 같은 키, 예: person:w-0012). */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** 위치가 지금 것이 아니다(연결 끊김·world 정지). 흐리게 그린다. */
  stale?: boolean;
  /** 그리는 World 범위. 없으면 기본 방(10×10m). */
  bounds?: PlanBounds;
  /** 평면도(BEV) 바탕. 없으면 모눈을 그린다. */
  backdrop?: PlanBackdrop;
  /** 바닥 감시 범위(-606). 호스트가 켜고 지금 보정에 맞을 때만 넘긴다. 없으면 그리지 않는다. */
  coverage?: FloorCoverage | null;
  /** 단일 사람 표시 어댑터 맵(-658). 주면 2D 말풍선에도 표시 이름을 함께 보인다. */
  personNames?: PersonDisplayMap;
  className?: string;
}

export function FloorPlan({
  tracks,
  zones,
  marks,
  selectedKey = null,
  onSelect,
  stale = false,
  bounds = ROOM_BOUNDS,
  backdrop,
  coverage = null,
  personNames,
  className,
}: FloorPlanProps) {
  const dwell = useDwell();
  const tip = dwell.tip && planTip(dwell.tip.key, tracks, zones, marks, personNames);
  const viewBox = [
    -PLAN_MARGIN,
    -PLAN_MARGIN,
    withMargin(boundsWidth(bounds)),
    withMargin(boundsDepth(bounds)),
  ].join(' ');
  return (
    <>
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="2D 평면"
        className={cn('transition-opacity', stale && 'opacity-50', className)}
      >
        <PlanRoom bounds={bounds} backdrop={backdrop} />
        {backdrop?.outdated && (
          <text
            data-floor-plan-outdated
            x={OUTDATED_LABEL.x}
            y={OUTDATED_LABEL.y}
            fontSize={OUTDATED_LABEL.fontSize}
            className="fill-muted-foreground"
          >
            오래된 평면도
          </text>
        )}
        {coverage && <PlanCoverage coverage={coverage} bounds={bounds} />}
        <PlanZones
          zones={zones}
          bounds={bounds}
          marks={marks.zones}
          selectedKey={selectedKey}
          onSelect={onSelect}
          bind={dwell.on}
        />
        <g>
          {tracks.map((track) => {
            const ids = trackIds(track);
            return (
              <PlanPerson
                key={track.world_id}
                track={track}
                bounds={bounds}
                mark={markFor(marks.people, ids)}
                selected={ids.some((id) => selectedKey === personKey(id))}
                onSelect={onSelect}
                bind={dwell.on}
              />
            );
          })}
        </g>
      </svg>
      <HoverTip tip={dwell.tip} text={tip?.text} tone={tip?.tone} />
    </>
  );
}

import {
  planPoints,
  severityTone,
  toPlan,
  zoneKey,
  type PlanBounds,
  type PlanMarks,
  type PlanTone,
  type PlanZone,
} from '@/features/plan/plan';
import { ALARM_BLINK, RING_TONE, type Bind } from '@/features/plan/planDraw';
import { isAxisRect } from '@/features/zones/zones';
import { cn } from '@simai/ui/lib/utils';
import { memo } from 'react';

// 평면의 구역 층. 구역·진행 중 이벤트·고른 대상이 바뀔 때만 다시 그린다.

const ZONE_DASH = '0.18 0.1';
const STROKE = 0.05;
/** 확인 대기·선택은 선을 굵게 한다(점멸이 멈추는 설정에서도 보이게). */
const STROKE_STRONG = 0.09;
/** 구역 채움의 불투명도(채움 색은 선 색과 같다). 고른 구역은 더 짙다. */
const FILL_OPACITY = { normal: 0.1, selected: 0.24 } as const;

/** 구역 기본 색은 구역 심각도를 따른다(위험 빨강·경고 주황·주의 노랑). 안내나 등급을 모르면 중립이다. */
const ZONE_TONE = {
  critical: 'fill-sev-critical stroke-sev-critical',
  high: 'fill-sev-high stroke-sev-high',
  caution: 'fill-sev-caution stroke-sev-caution',
} as const satisfies Record<PlanTone, string>;
const NEUTRAL_ZONE = 'fill-foreground stroke-muted-foreground';

/**
 * 채움 불투명도. 진행 중 이벤트가 걸린 구역은 고리 색(RING_TONE)이 투명도를 가지고 있어 따로 정하지 않는다
 * (겹쳐 곱하면 오히려 옅어진다).
 */
const fillOpacityOf = (eventTone: PlanTone | undefined, selected: boolean) => {
  if (eventTone) return undefined;
  return selected ? FILL_OPACITY.selected : FILL_OPACITY.normal;
};

export const PlanZones = memo(function PlanZones({
  zones,
  bounds,
  marks,
  selectedKey,
  onSelect,
  bind,
}: {
  zones: readonly PlanZone[];
  bounds: PlanBounds;
  marks: PlanMarks['zones'];
  selectedKey: string | null;
  onSelect?: (key: string) => void;
  bind: Bind;
}) {
  return (
    <g>
      {zones.map((zone) => {
        const [x, y] = toPlan(zone.min[0], zone.max[1], bounds);
        const mark = marks.get(zone.zoneId);
        const eventTone = mark && severityTone(mark.severity);
        const zoneTone = zone.severity && severityTone(zone.severity);
        const baseClass = zoneTone ? ZONE_TONE[zoneTone] : NEUTRAL_ZONE;
        const key = zoneKey(zone.zoneId);
        const selected = selectedKey === key;
        // 입체 판정은 점선, 바닥 판정은 실선이다(관제 데모와 같다).
        const dash = zone.judgeType === 'GROUND_FOOTPRINT' ? undefined : ZONE_DASH;
        const shared = {
          'data-zone': zone.zoneId,
          strokeWidth: mark?.alarming || selected ? STROKE_STRONG : STROKE,
          strokeDasharray: eventTone || selected ? undefined : dash,
          fillOpacity: fillOpacityOf(eventTone, selected),
          onClick: onSelect && (() => onSelect(key)),
          ...bind(key),
          className: cn(
            eventTone ? RING_TONE[eventTone] : baseClass,
            mark?.alarming && ALARM_BLINK,
            onSelect && 'cursor-pointer',
          ),
        };
        // 축에 맞춘 직사각형은 상자로, 회전했거나 직사각형이 아닌 구역은 실제 모양으로 그린다(판정 범위와 같다).
        return zone.polygon && !isAxisRect(zone.polygon) ? (
          <polygon key={zone.zoneId} points={planPoints(zone.polygon, bounds)} {...shared} />
        ) : (
          <rect
            key={zone.zoneId}
            x={x}
            y={y}
            width={zone.max[0] - zone.min[0]}
            height={zone.max[1] - zone.min[1]}
            {...shared}
          />
        );
      })}
    </g>
  );
});

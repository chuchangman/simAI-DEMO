import { ROOM, toPlan } from '@/features/plan/plan';
import { itemHeight } from '@/features/tbm/tbm';
import { TBM_DOOR, type LayoutItem, type Rect, type TbmTask } from '@/features/tbm/tbmDemo';
import type { Zone } from '@/features/zones/types';
import { SEVERITY_LABEL } from '@/lib/ruleNames';
import { cn } from '@simai/ui/lib/utils';

// 작업 하나의 가상 레이아웃(2D 평면, m). 같은 시간대의 다른 작업은 점선으로, 배치가 겹친 자리는 '▲ 간섭'으로 그린다.
// 길이는 모두 방 기준 m 라서 선 굵기와 글자 크기가 1 보다 훨씬 작다.

const LINE_ROOM = 0.07;
const LINE_ITEM = 0.05;
/** 구역 · 개구부 테두리. */
const LINE_AREA = 0.04;
const LINE_DOOR = 0.03;
const LINE_GRID = 0.025;
const LINE_SPOT = 0.06;
const DASH = '0.15 0.1';
const FONT_LABEL = 0.24;
const ZONE_STYLE: Record<Zone['severity'], string> = {
  CRITICAL: 'fill-sev-critical/15 stroke-sev-critical',
  HIGH: 'fill-sev-high/15 stroke-sev-high',
  CAUTION: 'fill-sev-caution/15 stroke-sev-caution',
  INFO: 'fill-muted-foreground/10 stroke-muted-foreground',
};
/** 평면 둘레 여백(m). 방 밖의 글자가 잘리지 않게 한다. */
const VIEW_MARGIN = 0.5;

/** World 직사각형 → 평면 직사각형(+y 아래). 변환은 toPlan 으로만 한다. */
function planRect(r: Rect): Rect {
  const [x, y] = toPlan(r.x, r.y + r.h);
  return { x, y, w: r.w, h: r.h };
}

const DOOR = planRect(TBM_DOOR);
const VIEW_BOX = `${-VIEW_MARGIN} ${-VIEW_MARGIN} ${ROOM.width + 2 * VIEW_MARGIN} ${ROOM.depth + 2 * VIEW_MARGIN}`;

/** 1m 간격 바둑판 선(방 크기가 고정이라 한 번만 만든다). */
const GRID_LINES = [
  ...Array.from({ length: ROOM.width - 1 }, (_, n) => (
    <line key={`v${n}`} x1={n + 1} y1={0} x2={n + 1} y2={ROOM.depth} />
  )),
  ...Array.from({ length: ROOM.depth - 1 }, (_, n) => (
    <line key={`h${n}`} x1={0} y1={n + 1} x2={ROOM.width} y2={n + 1} />
  )),
];

/** 배치 항목의 이름표: 'T2 · 비계 S1 · 2.4m' (tag 는 다른 작업 번호, 높이가 없으면 생략). */
function itemName(item: LayoutItem, tag?: string) {
  const height = itemHeight(item);
  return `${tag ? `${tag} · ` : ''}${item.label}${height ? ` · ${height}m` : ''}`;
}

/** 배치 항목 하나의 모양과 색. mine 이 아니면(다른 작업) 옅은 점선이다. */
function itemStyle(mine: boolean) {
  return {
    stroke: mine ? 'stroke-point-soft' : 'stroke-muted-foreground',
    fill: mine ? 'fill-point-soft/15' : 'fill-muted-foreground/5',
    label: mine ? 'fill-foreground' : 'fill-muted-foreground',
  };
}

function PathItem({
  item,
  mine,
  name,
}: {
  item: Extract<LayoutItem, { kind: 'path' }>;
  mine: boolean;
  name: string;
}) {
  const pts = item.pts.map(([x, y]) => toPlan(x, y));
  const points = pts.map((p) => p.join(',')).join(' ');
  const [lx, ly] = pts[0]!;
  return (
    <g>
      <polyline
        points={points}
        fill="none"
        className={mine ? 'stroke-point-soft/15' : 'stroke-muted-foreground/15'}
        strokeWidth={item.w}
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        className={itemStyle(mine).stroke}
        strokeWidth={LINE_ITEM}
        strokeDasharray={DASH}
      />
      <text
        x={lx + item.w / 2 + 0.12}
        y={ly - 0.3}
        fontSize={FONT_LABEL}
        className={mine ? 'fill-point-soft' : 'fill-muted-foreground'}
      >
        {name}
      </text>
    </g>
  );
}

function BoxItem({ item, mine, name }: { item: Rect; mine: boolean; name: string }) {
  const r = planRect(item);
  const style = itemStyle(mine);
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        className={cn(style.fill, style.stroke)}
        strokeWidth={LINE_ITEM}
        strokeDasharray={mine ? undefined : DASH}
      />
      <text x={r.x + 0.1} y={r.y + r.h / 2} fontSize={FONT_LABEL} className={style.label}>
        {name}
      </text>
    </g>
  );
}

function PlanItem({ item, mine, tag }: { item: LayoutItem; mine: boolean; tag?: string }) {
  const name = itemName(item, tag);
  if (item.kind === 'path') return <PathItem item={item} mine={mine} name={name} />;
  return <BoxItem item={item} mine={mine} name={name} />;
}

/** 배치가 겹친 자리 하나. */
function SpotMark({ spot }: { spot: Rect }) {
  const r = planRect(spot);
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        className="fill-sev-critical/25 stroke-sev-critical"
        strokeWidth={LINE_SPOT}
      />
      <text
        x={r.x + r.w + 0.1}
        y={r.y + r.h / 2 + 0.08}
        fontSize={FONT_LABEL}
        fontWeight={700}
        className="fill-sev-critical"
      >
        ▲ 간섭
      </text>
    </g>
  );
}

/** 작업과 상관없이 늘 같은 바닥: 바탕 · 바둑판 · 방 테두리 · 출입문. */
function PlanBase() {
  return (
    <>
      <rect width={ROOM.width} height={ROOM.depth} className="fill-background" />
      <g className="stroke-stripe-a" strokeWidth={LINE_GRID}>
        {GRID_LINES}
      </g>
      <rect
        width={ROOM.width}
        height={ROOM.depth}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={LINE_ROOM}
      />
      <rect
        x={DOOR.x}
        y={DOOR.y}
        width={DOOR.w}
        height={DOOR.h}
        className="fill-background stroke-muted-foreground"
        strokeWidth={LINE_DOOR}
      />
    </>
  );
}

/** 바닥은 작업이 바뀌어도 같아서 요소 하나를 두고 다시 쓴다(React 가 건너뛴다). */
const PLAN_BASE = <PlanBase />;

export function TbmPlan({
  task,
  others,
  spots,
  setupZones = [],
}: {
  task: TbmTask;
  /** 같은 시간대의 다른 작업. */
  others: readonly TbmTask[];
  /** 배치가 겹친 자리(World). */
  spots: readonly Rect[];
  setupZones?: readonly Zone[];
}) {
  return (
    <svg
      viewBox={VIEW_BOX}
      role="img"
      aria-label={`${task.id} 가상 레이아웃 평면 도식`}
      className="block size-full"
    >
      {PLAN_BASE}
      {setupZones.map((zone) => (
        <polygon
          key={zone.zoneId}
          aria-label={`${zone.name} 위험 구역 (${SEVERITY_LABEL[zone.severity]})`}
          points={zone.polygon.map(([x, y]) => toPlan(x, y).join(',')).join(' ')}
          className={ZONE_STYLE[zone.severity]}
          strokeWidth={LINE_AREA}
        />
      ))}
      {others.map((other) =>
        other.items.map((item, n) => (
          <PlanItem key={`${other.id}-${n}`} item={item} mine={false} tag={other.id} />
        )),
      )}
      {task.items.map((item, n) => (
        <PlanItem key={`mine-${n}`} item={item} mine />
      ))}
      {spots.map((spot, n) => (
        <SpotMark key={`spot-${n}`} spot={spot} />
      ))}
    </svg>
  );
}

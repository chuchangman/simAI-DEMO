import {
  personKey,
  severityTone,
  sigmaRadius,
  toPlan,
  trackLook,
  type PlanBounds,
  type PlanMark,
  type TrackLook,
} from '@/features/plan/plan';
import { ALARM_BLINK, RING_TONE, type Bind } from '@/features/plan/planDraw';
import { LOOK_LABEL } from '@/features/plan/planTip';
import { SEVERITY_LABEL } from '@/lib/ruleNames';
import type { WorldTrack } from '@simai/contracts';
import { cn } from '@simai/ui/lib/utils';
import type { KeyboardEvent } from 'react';

// 평면의 사람 한 명: 관측 모양 + 불확실 원·등급 고리·선택·포커스·속도선.

/** 예측 위치에서 속도선을 그리는 시간(초). 디자인 데모와 같다. */
const LOOKAHEAD_S = 1.8;

/** 반지름(m). */
const RADIUS = {
  /** 누르는 자리(투명 원). */
  hit: 0.45,
  ring: 0.46,
  selected: 0.6,
  focus: 0.72,
  observed: 0.25,
  observedCore: 0.09,
  predicted: 0.24,
  unknown: 0.26,
} as const;
/** 선 굵기(m). 확인 대기 고리는 점멸이 멈추는 설정에서도 보이게 굵다. */
const STROKE = {
  sigma: 0.03,
  ring: 0.06,
  ringAlarm: 0.1,
  mark: 0.05,
  ahead: 0.04,
} as const;
const DASH = {
  sigma: '0.1 0.08',
  focus: '0.12 0.08',
  ahead: '0.08 0.08',
  mark: '0.08 0.06',
} as const;
const UNKNOWN_GLYPH_SIZE = 0.32;
const UNKNOWN_GLYPH_DROP = 0.11;

interface Point {
  x: number;
  y: number;
}

/** 관측 상태별 모양: 관측은 채운 점, 예측은 점선 원, 확인 불가는 ? 가 든 점선 원. */
function PersonDot({ look, x, y }: { look: TrackLook } & Point) {
  if (look === 'observed') {
    return (
      <>
        <circle cx={x} cy={y} r={RADIUS.observed} className="fill-foreground" />
        <circle cx={x} cy={y} r={RADIUS.observedCore} className="fill-surface-2" />
      </>
    );
  }
  if (look === 'predicted') {
    return (
      <circle
        cx={x}
        cy={y}
        r={RADIUS.predicted}
        strokeWidth={STROKE.mark}
        strokeDasharray={DASH.mark}
        className="fill-foreground/25 stroke-foreground"
      />
    );
  }
  return (
    <>
      <circle
        cx={x}
        cy={y}
        r={RADIUS.unknown}
        strokeWidth={STROKE.mark}
        strokeDasharray={DASH.mark}
        className="fill-surface-2 stroke-muted-foreground"
      />
      <text
        x={x}
        y={y + UNKNOWN_GLYPH_DROP}
        fontSize={UNKNOWN_GLYPH_SIZE}
        fontWeight={700}
        textAnchor="middle"
        className="fill-muted-foreground"
      >
        ?
      </text>
    </>
  );
}

/** 속도선 끝. 예측 위치만 속도 방향으로 LOOKAHEAD_S 초 앞을 그린다. */
function aheadPoint(
  track: WorldTrack,
  look: TrackLook,
  bounds: PlanBounds,
): readonly [number, number] | null {
  const velocity = track.velocity;
  if (look !== 'predicted' || !velocity) return null;
  return toPlan(
    track.position_xy[0] + velocity[0] * LOOKAHEAD_S,
    track.position_xy[1] + velocity[1] * LOOKAHEAD_S,
    bounds,
  );
}

/** 불확실 원·등급 고리·선택 고리·키보드 포커스 고리·속도선. 보이기만 하고 누르지 않는다. */
function PersonHalo({
  track,
  look,
  bounds,
  mark,
  selected,
  x,
  y,
}: {
  track: WorldTrack;
  look: TrackLook;
  bounds: PlanBounds;
  mark: PlanMark | undefined;
  selected: boolean;
} & Point) {
  const sigma = sigmaRadius(track);
  const tone = mark && severityTone(mark.severity);
  const ahead = aheadPoint(track, look, bounds);
  return (
    <g className="pointer-events-none">
      {sigma !== null && (
        <circle
          cx={x}
          cy={y}
          r={sigma}
          strokeWidth={STROKE.sigma}
          strokeDasharray={DASH.sigma}
          className="fill-foreground/5 stroke-foreground/25"
        />
      )}
      {tone && (
        <circle
          cx={x}
          cy={y}
          r={RADIUS.ring}
          strokeWidth={mark.alarming ? STROKE.ringAlarm : STROKE.ring}
          className={cn(RING_TONE[tone], mark.alarming && ALARM_BLINK)}
        />
      )}
      {selected && (
        <circle
          cx={x}
          cy={y}
          r={RADIUS.selected}
          fill="none"
          strokeWidth={STROKE.mark}
          className="stroke-primary"
        />
      )}
      {/* 키보드 포커스 표시. outline 은 SVG 그룹에 그려지지 않아 고리로 보인다. */}
      <circle
        cx={x}
        cy={y}
        r={RADIUS.focus}
        fill="none"
        strokeWidth={STROKE.mark}
        strokeDasharray={DASH.focus}
        className="stroke-transparent group-focus-visible/person:stroke-primary"
      />
      {ahead && (
        <line
          x1={x}
          y1={y}
          x2={ahead[0]}
          y2={ahead[1]}
          strokeWidth={STROKE.ahead}
          strokeDasharray={DASH.ahead}
          className="stroke-foreground/70"
        />
      )}
    </g>
  );
}

/** 고를 수 있을 때만 버튼 역할과 Enter·Space 선택을 붙인다. */
function selectProps(select: (() => void) | undefined, selected: boolean, label: string) {
  if (!select) return {};
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selected,
    'aria-label': label,
    onClick: select,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      select();
    },
  };
}

export function PlanPerson({
  track,
  bounds,
  mark,
  selected,
  onSelect,
  bind,
}: {
  track: WorldTrack;
  bounds: PlanBounds;
  mark: PlanMark | undefined;
  selected: boolean;
  onSelect?: (key: string) => void;
  bind: Bind;
}) {
  const [x, y] = toPlan(track.position_xy[0], track.position_xy[1], bounds);
  const look = trackLook(track);
  const key = personKey(track.world_id);
  const select = onSelect && (() => onSelect(key));
  const label = `${track.world_id}${LOOK_LABEL[look]}${mark ? ` · ${SEVERITY_LABEL[mark.severity]}` : ''}`;

  return (
    <g
      {...selectProps(select, selected, label)}
      {...bind(key)}
      className={cn('group/person', select && 'cursor-pointer outline-hidden')}
    >
      {/* 겹친 표시는 보이기만 한다. 누르는 자리는 아래 투명 원이라 겹친 다른 사람을 고르지 않는다. */}
      <PersonHalo
        track={track}
        look={look}
        bounds={bounds}
        mark={mark}
        selected={selected}
        x={x}
        y={y}
      />
      <circle cx={x} cy={y} r={RADIUS.hit} fill="transparent" />
      <PersonDot look={look} x={x} y={y} />
    </g>
  );
}

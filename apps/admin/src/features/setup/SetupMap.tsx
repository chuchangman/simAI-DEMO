import { PLAN_MARGIN, ROOM, toPlan } from '@/features/plan/plan';
import { cameraShortLabel } from '@/features/setup/cameraLabels';
import {
  DESKS,
  DOOR,
  OPENING,
  PODIUM,
  type CoverageCameraView,
  type CoveragePairView,
  type PlanRect,
  type SetupTone,
  type Stage,
  type Step1CoverageView,
} from '@/features/setup/setup';
import type { ZoneDraftItem } from '@/features/setup/types';
import { cn } from '@simai/ui/lib/utils';
import { memo } from 'react';

// 위에서 내려다본 교실(m)에 1단계는 4대 카메라와 옆 카메라 4쌍 연결 상태(충분·약함·부족·미확인)를,
// 이후 단계는 검증 지점·평면도를 그린다. 색은 위험 등급색(sev-*)과 겹치지 않는 토큰만 쓴다.

const HALO = { paintOrder: 'stroke', strokeWidth: 0.09, strokeLinejoin: 'round' } as const;
const HALO_CLASS = 'stroke-surface-2';

const PAIR_STROKE: Record<SetupTone, string> = {
  ok: 'stroke-ok',
  active: 'stroke-primary',
  delay: 'stroke-delay',
  idle: 'stroke-faint',
};

const PAIR_TEXT: Record<SetupTone, string> = {
  ok: 'fill-ok',
  active: 'fill-point-soft',
  delay: 'fill-delay',
  idle: 'fill-muted-foreground',
};

const CAM_FILL: Record<SetupTone, string> = {
  ok: 'fill-ok',
  active: 'fill-primary',
  delay: 'fill-delay',
  idle: 'fill-faint',
};

function planRect(r: PlanRect) {
  const [x, y] = toPlan(r.x, r.y + r.depth);
  return { x, y, width: r.width, height: r.depth };
}

const Room = memo(function Room({ grid }: { grid: boolean }) {
  const lines = [];
  if (grid) {
    for (let i = 1; i < ROOM.width; i++)
      lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={ROOM.depth} />);
    for (let i = 1; i < ROOM.depth; i++)
      lines.push(<line key={`h${i}`} x1={0} y1={i} x2={ROOM.width} y2={i} />);
  }
  return (
    <g>
      <rect width={ROOM.width} height={ROOM.depth} rx={0.08} className="fill-surface-2" />
      {grid && (
        <g className="stroke-border" strokeWidth={0.025}>
          {lines}
        </g>
      )}
    </g>
  );
});

const Walls = memo(function Walls() {
  const [doorX, doorY] = toPlan(DOOR.x, ROOM.depth);
  return (
    <g>
      <rect
        width={ROOM.width}
        height={ROOM.depth}
        rx={0.08}
        fill="none"
        strokeWidth={0.07}
        className="stroke-muted-foreground"
      />
      <rect
        x={doorX}
        y={doorY - 0.14}
        width={DOOR.width}
        height={0.28}
        strokeWidth={0.03}
        className="fill-card stroke-muted-foreground"
      />
    </g>
  );
});

const Furniture = memo(function Furniture() {
  const podium = planRect(PODIUM);
  return (
    <g>
      {DESKS.map((desk, n) => (
        <rect
          key={n}
          {...planRect(desk)}
          rx={0.05}
          strokeWidth={0.03}
          className="fill-surface-3 stroke-border"
        />
      ))}
      <rect {...podium} rx={0.05} className="fill-muted-foreground/25" />
      <text
        x={podium.x + podium.width / 2}
        y={podium.y + podium.height / 2 + 0.1}
        fontSize={0.24}
        textAnchor="middle"
        className="fill-muted-foreground"
      >
        단상
      </text>
      <rect
        {...planRect(OPENING)}
        strokeWidth={0.03}
        className="fill-faint/40 stroke-border dark:fill-background"
      />
    </g>
  );
});

function PairEdges({ pairs }: { pairs: readonly CoveragePairView[] }) {
  return (
    <g aria-label="카메라 쌍 연결 선">
      {pairs.map((pair) => {
        const [x1, y1] = toPlan(...pair.from);
        const [x2, y2] = toPlan(...pair.to);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dash =
          pair.grade === 'ENOUGH' ? undefined : pair.grade === 'WEAK' ? '0.24 0.14' : '0.1 0.12';
        const width = pair.grade === 'ENOUGH' ? 0.09 : pair.grade === 'WEAK' ? 0.075 : 0.05;
        return (
          <g key={pair.key} aria-label={`${pair.label} ${pair.gradeLabel}`}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={width}
              strokeDasharray={dash}
              className={PAIR_STROKE[pair.tone]}
            />
            <text
              x={mx}
              y={my}
              fontSize={0.25}
              fontWeight={600}
              textAnchor="middle"
              {...HALO}
              className={cn(HALO_CLASS, 'font-mono', PAIR_TEXT[pair.tone])}
            >
              {`${pair.label} ${pair.gradeLabel}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Cameras({ cameras }: { cameras: readonly CoverageCameraView[] }) {
  const cameraIds = cameras.map((cam) => cam.id);
  return (
    <g>
      {cameras.map((cam) => {
        const [px, py] = toPlan(...cam.corner);
        const sx = px <= 0 ? -1 : 1;
        const sy = py <= 0 ? -1 : 1;
        return (
          <g key={cam.id}>
            <polygon
              points={`${px + 0.4 * sx},${py + 0.4 * sy} ${px - 0.2 * sx},${py + 0.4 * sy} ${px + 0.4 * sx},${py - 0.2 * sy}`}
              className={CAM_FILL[cam.tone]}
            />
            <text
              x={sx < 0 ? px - 0.78 : px - 0.18}
              y={sy < 0 ? py - 0.52 : py + 0.78}
              fontSize={0.22}
              className={cn('font-mono', PAIR_TEXT[cam.tone])}
            >
              {cam.badge.kind === 'READY'
                ? cameraShortLabel(cameraIds, cam.id)
                : `${cameraShortLabel(cameraIds, cam.id)} (${cam.badge.label})`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DraftPolygons({
  drafts,
  acceptedDraftIds,
  discardedDraftIds,
}: {
  drafts: readonly ZoneDraftItem[];
  acceptedDraftIds: readonly string[];
  discardedDraftIds: readonly string[];
}) {
  const visibleDrafts = drafts.filter((d) => !discardedDraftIds.includes(d.candidate_id));
  if (visibleDrafts.length === 0) return null;

  return (
    <g aria-label="AI 구역 초안 다각형">
      {visibleDrafts.map((draft) => {
        const planPts = draft.polygon_xy.map(([wx, wy]) => toPlan(wx, wy));
        const pointsAttr = planPts.map(([px, py]) => `${px},${py}`).join(' ');
        const cx = planPts.reduce((acc, [px]) => acc + px, 0) / planPts.length;
        const cy = planPts.reduce((acc, [, py]) => acc + py, 0) / planPts.length;
        const accepted = acceptedDraftIds.includes(draft.candidate_id);
        const noOpinion = draft.no_opinion;

        const polygonTone = noOpinion
          ? 'fill-muted-foreground/15 stroke-muted-foreground'
          : draft.recommended_severity === 'CRITICAL'
            ? 'fill-sev-critical/15 stroke-sev-critical'
            : 'fill-sev-high/15 stroke-sev-high';

        const labelTone = noOpinion
          ? 'fill-muted-foreground'
          : draft.recommended_severity === 'CRITICAL'
            ? 'fill-sev-critical'
            : 'fill-sev-high';

        return (
          <g
            key={draft.candidate_id}
            aria-label={`AI 초안 ${draft.recommended_name}${noOpinion ? ' (AI 의견 없음)' : ''}`}
            data-candidate-id={draft.candidate_id}
            data-no-opinion={noOpinion ? 'true' : 'false'}
            data-accepted={accepted ? 'true' : 'false'}
          >
            <polygon
              points={pointsAttr}
              strokeWidth={accepted ? 0.08 : 0.06}
              strokeDasharray="0.22 0.14"
              className={polygonTone}
            />
            <text
              x={cx}
              y={cy + 0.08}
              fontSize={0.24}
              fontWeight={600}
              textAnchor="middle"
              {...HALO}
              className={cn(HALO_CLASS, 'font-mono', labelTone)}
            >
              {noOpinion ? `${draft.recommended_name} (AI 의견 없음)` : draft.recommended_name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function SetupMap({
  stage,
  coverage,
  drafts = [],
  acceptedDraftIds = [],
  discardedDraftIds = [],
  className,
}: {
  stage: Stage;
  coverage: Step1CoverageView;
  drafts?: readonly ZoneDraftItem[];
  acceptedDraftIds?: readonly string[];
  discardedDraftIds?: readonly string[];
  /** 지도 상자 크기를 바꿀 때(기본은 폭 가득, 높이 340px 이하). */
  className?: string;
}) {
  const size = (n: number) => n + PLAN_MARGIN * 2;
  return (
    <svg
      viewBox={`${-PLAN_MARGIN} ${-PLAN_MARGIN} ${size(ROOM.width)} ${size(ROOM.depth)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`교실 ${ROOM.width}×${ROOM.depth}m 위에서 본 보정 화면`}
      className={cn('block max-h-[340px] w-full', className)}
    >
      <Room grid={stage < 2} />
      {stage >= 2 && <Furniture />}
      <Walls />
      {stage === 0 && <PairEdges pairs={coverage.pairs} />}
      {drafts.length > 0 && (
        <DraftPolygons
          drafts={drafts}
          acceptedDraftIds={acceptedDraftIds}
          discardedDraftIds={discardedDraftIds}
        />
      )}
      <Cameras cameras={coverage.cameras} />
    </svg>
  );
}

import { riskStyle, type RiskHighlight } from '@/features/viewer3d/risk/riskPresentation';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import { Line } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';

// 사람·구역에 얹는 위험 표식(선). 같은 Canvas·Scene 안이며 클릭을 받지 않아 사람·구역 선택을 가로막지 않는다.
// 대상의 위치·형상·재질은 바꾸지 않는다. 위험 문구는 사람·구역 이름표 앞에 붙인다(이름표가 겹치지 않게 하나로 묶는다).

type Vec3 = [number, number, number];
const noRaycast = () => null;

function circle(radius: number, y: number, segments = 48): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius];
  });
}

// 바닥에서 3cm 띄운 발밑 고리. 몸이 놓인 기준(발)과 같은 원점이다.
const INNER_RING = circle(0.5, 0.03);
const OUTER_RING = circle(0.64, 0.03);
// 높이를 모르는 사람의 세로 표식을 둘러싼 네 기둥. 바닥 고리를 그리지 않는다(Z 를 지어내지 않는다).
const COLUMN_RAILS: Vec3[] = [
  [-0.26, 0.1, -0.26],
  [-0.26, 2.0, -0.26],
  [0.26, 0.1, -0.26],
  [0.26, 2.0, -0.26],
  [0.26, 0.1, 0.26],
  [0.26, 2.0, 0.26],
  [-0.26, 0.1, 0.26],
  [-0.26, 2.0, 0.26],
];

/**
 * 표식 그룹에 등급·이벤트를 적고, 이 강조가 장면에 반영된 시각(이 브라우저 시계)을 남긴다.
 * 개발 진단이 이벤트 수신 시각과 비교해 수신→3D 반영 시간을 잰다. 화면에는 영향이 없다.
 */
function useMarkInfo(risk: RiskHighlight, extra: Record<string, unknown> = {}) {
  const ref = useRef<Group>(null);
  const kind = extra.kind;
  useEffect(() => {
    const group = ref.current;
    if (!group) return;
    group.userData = {
      level: risk.level,
      eventIds: risk.eventIds,
      source: risk.source,
      appliedAt: Date.now(),
      ...(kind === undefined ? {} : { kind }),
    };
  }, [risk, kind]);
  return ref;
}

interface PersonRiskMarkProps {
  risk: RiskHighlight;
  /** BODY: 발밑 고리, COLUMN: 높이 미상 표식을 둘러싼 기둥. */
  kind: 'BODY' | 'COLUMN';
  worldId: string;
}

export function PersonRiskMark({ risk, kind, worldId }: PersonRiskMarkProps) {
  const style = riskStyle(risk, useScenePalette());
  const ref = useMarkInfo(risk, { kind });
  const line = {
    color: style.color,
    dashed: style.dashed,
    dashSize: 0.14,
    gapSize: 0.09,
    raycast: noRaycast,
  };
  return (
    <group ref={ref} name={`risk-person:${worldId}`}>
      {kind === 'BODY' ? (
        <>
          <Line points={INNER_RING} lineWidth={3} {...line} />
          {style.double && <Line points={OUTER_RING} lineWidth={2} {...line} />}
        </>
      ) : (
        <Line points={COLUMN_RAILS} segments lineWidth={2.5} {...line} />
      )}
    </group>
  );
}

interface ZoneRiskMarkProps {
  risk: RiskHighlight;
  zoneId: string;
  /** 구역 상자 크기(Three). 높이는 그대로 두고 수평으로만 넓혀 바깥 테두리를 그린다. */
  size: readonly [number, number, number];
}

// 구역 테두리와 겹치지 않게 바깥으로 띄우는 거리(m, 수평 한쪽). 높이 범위(하단·상단)는 바꾸지 않는다.
export const ZONE_RISK_MARGIN = 0.06;

export function ZoneRiskMark({ risk, zoneId, size }: ZoneRiskMarkProps) {
  const style = riskStyle(risk, useScenePalette());
  const ref = useMarkInfo(risk);
  const [sx, sy, sz] = size;
  const edges = useMemo(
    () => boxEdges([sx + ZONE_RISK_MARGIN * 2, sy, sz + ZONE_RISK_MARGIN * 2]),
    [sx, sy, sz],
  );
  return (
    <group ref={ref} name={`risk-zone:${zoneId}`}>
      <Line
        points={edges}
        segments
        color={style.color}
        lineWidth={style.double ? 3.5 : 2.5}
        dashed={style.dashed}
        dashSize={0.2}
        gapSize={0.12}
        raycast={noRaycast}
      />
    </group>
  );
}

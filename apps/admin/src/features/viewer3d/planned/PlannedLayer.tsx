import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import {
  PlannedStoreContext,
  type PlannedKind,
  type PlannedObjectView,
  type PlannedStore,
} from '@/features/viewer3d/planned/plannedLayout';
import { Selectable } from '@/features/viewer3d/Selectable';
import { obstacleCorners } from '@/features/viewer3d/surfaces/obstacleGeometry';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { personOnRay } from '@/features/viewer3d/zones/zonePresentation';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useContext, useMemo } from 'react';
import { useStore } from 'zustand';

// -186 PLANNED 가상 배치 레이어. 뷰어가 PLANNED 모드일 때만 그리고 장면 대상(planned)으로 올린다.
// LIVE·REPLAY 로 바뀌면 내려가 선택·편집 대상에서도 빠진다(모드 격리). 위험 강조(RiskScope) 밖이다.
// 가상 객체는 점선 모서리와 "계획 · 가상" 이름표로 실제 운영 형상(구역·작업면·장애물)과 구분한다.

const noRaycast = () => null;
const pickPerson = (event: ThreeEvent<MouseEvent>) => personOnRay(event.intersections);
// WebGL 재질은 CSS 토큰을 바로 읽지 못해 장면 전용 값을 둔다. 운영 형상(청록·푸른 회색·주황)과 겹치지 않는 색이다.
const KIND_COLOR: Record<PlannedKind, string> = {
  OPENING: '#e6c84f',
  WORK_SURFACE: '#b18cf2',
  SCAFFOLD: '#b18cf2',
  EQUIPMENT: '#5fd0a8',
};
const SELECTED_COLOR = '#ffffff';
export const PLANNED_KIND_LABEL: Record<PlannedKind, string> = {
  OPENING: '개구부',
  WORK_SURFACE: '고소 작업면',
  SCAFFOLD: '비계',
  EQUIPMENT: '장비',
};
const LABEL_LIFT = 0.22;

/** 이름표 글. 계획(가상)임과 종류·높이를 적는다. */
export function plannedLabel(
  object: Pick<PlannedObjectView, 'id' | 'kind' | 'label' | 'center' | 'size'>,
) {
  const bottom = object.center[2] - object.size[2] / 2;
  const top = object.center[2] + object.size[2] / 2;
  return `${object.label ?? object.id} · 계획 ${PLANNED_KIND_LABEL[object.kind]} · 가상 · Z ${bottom.toFixed(2)}~${top.toFixed(2)}m`;
}

/** 모서리 12개 선분(두 점씩). World 꼭짓점을 worldToThree 로 그대로 옮긴다. */
export function plannedEdges(object: PlannedObjectView): ThreePoint[] {
  const corners = obstacleCorners(object).map(worldToThree);
  const edges: ThreePoint[] = [];
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    edges.push(
      corners[i]!,
      corners[next]!,
      corners[i + 4]!,
      corners[next + 4]!,
      corners[i]!,
      corners[i + 4]!,
    );
  }
  return edges;
}

export function PlannedLayer() {
  const store = useContext(PlannedStoreContext);
  const mode = useStore(useViewerStore(), (s) => s.mode);
  if (!store || mode !== 'PLANNED') return null;
  return <PlannedObjects store={store} />;
}

function PlannedObjects({ store }: { store: PlannedStore }) {
  const objects = useStore(store, (s) => s.snapshot.objects);
  return (
    <group name="planned-layer">
      {objects.map((object) => (
        <PlannedVolume key={object.id} object={object} />
      ))}
    </group>
  );
}

function PlannedVolume({ object }: { object: PlannedObjectView }) {
  const selected = useStore(
    useViewerStore(),
    (s) => s.selected?.type === 'planned' && s.selected.id === object.id,
  );
  const edges = useMemo(() => plannedEdges(object), [object]);
  const center = useMemo(
    () => worldToThree(worldPoint(object.center[0], object.center[1], object.center[2])),
    [object],
  );
  const [w, d, h] = object.size;
  const color = KIND_COLOR[object.kind];

  return (
    <group name={`planned-entry:${object.id}`}>
      <Selectable target={{ type: 'planned', id: object.id }} pickInstead={pickPerson}>
        {/* Three Y 축 회전 = World +Z 축 회전(World→Three 가 +Z→+Y 라 같은 방향이다). */}
        <group position={center} rotation-y={object.yawRad}>
          <mesh name={`planned-box:${object.id}`}>
            <boxGeometry args={[w, h, d]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.34 : 0.2}
              depthWrite={false}
            />
          </mesh>
        </group>
      </Selectable>
      <Line
        name={`planned-edges:${object.id}`}
        points={edges}
        segments
        color={selected ? SELECTED_COLOR : color}
        lineWidth={selected ? 2.4 : 1.6}
        dashed
        dashSize={0.16}
        gapSize={0.1}
        transparent
        opacity={0.9}
        raycast={noRaycast}
      />
      <group position={center}>
        <LabelSprite text={plannedLabel(object)} y={h / 2 + LABEL_LIFT} height={0.2} />
      </group>
    </group>
  );
}

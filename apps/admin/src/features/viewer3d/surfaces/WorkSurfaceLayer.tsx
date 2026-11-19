import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import { Selectable } from '@/features/viewer3d/Selectable';
import { ObstacleLayer } from '@/features/viewer3d/surfaces/ObstacleLayer';
import {
  surfaceCorners,
  surfaceTopEdge,
  workSurfaceObb,
  type WorkSurfaceView,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { personOnRay } from '@/features/viewer3d/zones/zonePresentation';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { useStore } from 'zustand';

// -188 등록 작업면 레이어. Provider 의 작업면(Operational Geometry OBB)을 같은 Canvas·Scene 안에 surface_id 마다 그린다.
// 반투명 상자는 바닥(Z=0)부터 상판까지이고, 윗면 둘레(R2·R3 가 보는 가장자리, 명세 7.5·13.1)는 굵은 선으로 따로 그린다.
// 선은 World 꼭짓점을 worldToThree 로 그대로 옮겨 그린다(상자 회전과 별개로 꼭짓점 좌표가 정확하다).
// 보기용 glTF(Visual Geometry)는 여기서 쓰지 않는다. 위험 가장자리(높이차 기준 충족 구간) 판정은 AI 가 한다.
// 같은 묶음의 등록 정적 객체(OBSTACLE, -274)는 ObstacleLayer 가 이 레이어 옆에 따로 그린다.

const noRaycast = () => null;
const pickPerson = (event: ThreeEvent<MouseEvent>) => personOnRay(event.intersections);

/** 선분 목록(두 점씩): 윗면 둘레 4변은 따로, 세로 모서리 4개와 바닥 둘레 4변은 옅게 그린다. */
export function surfaceOutline(surface: WorkSurfaceView): {
  top: ThreePoint[];
  frame: ThreePoint[];
} {
  const top = surfaceTopEdge(surface).map(worldToThree);
  const bottom = surfaceCorners(surface, 0).map(worldToThree);
  const frame: ThreePoint[] = [];
  bottom.forEach((corner, i) => {
    frame.push(corner, bottom[(i + 1) % 4]!, corner, top[i]!);
  });
  return { top: [...top, top[0]!], frame };
}

export function WorkSurfaceLayer() {
  const surfaces = useSpatialData((s) => s.workSurfaces.surfaces);
  const layer = useStore(useViewerStore(), (s) => s.layers.workSurfaces);
  return (
    <>
      {layer !== 'hidden' && (
        <group name="work-surface-layer">
          {surfaces.map((surface) => (
            <WorkSurfaceVolume
              key={surface.surfaceId}
              surface={surface}
              interactive={layer === 'interactive'}
            />
          ))}
        </group>
      )}
      <ObstacleLayer />
    </>
  );
}

function WorkSurfaceVolume({
  surface,
  interactive,
}: {
  surface: WorkSurfaceView;
  interactive: boolean;
}) {
  const selected = useStore(
    useViewerStore(),
    (s) => s.selected?.type === 'object' && s.selected.id === surface.surfaceId,
  );
  const obb = useMemo(() => workSurfaceObb(surface), [surface]);
  const outline = useMemo(() => surfaceOutline(surface), [surface]);
  const [w, d, h] = obb.size;
  const { surface: look } = useScenePalette();
  const color = selected ? look.selected : look.color;

  return (
    <group name={`surface-entry:${surface.surfaceId}`}>
      <Selectable
        target={{ type: 'object', id: surface.surfaceId }}
        pickInstead={pickPerson}
        interactive={interactive}
      >
        {/* Three Y 축 회전 = World +Z 축 회전(World→Three 가 +Z→+Y 라 같은 방향이다). */}
        <group position={worldToThree(obb.center)} rotation-y={obb.yaw}>
          <mesh name={`surface-box:${surface.surfaceId}`}>
            <boxGeometry args={[w, h, d]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.3 : 0.18}
              depthWrite={false}
            />
          </mesh>
        </group>
      </Selectable>
      <Line
        name={`surface-top-edge:${surface.surfaceId}`}
        points={outline.top}
        color={selected ? look.selected : look.topEdge}
        lineWidth={selected ? 3.5 : 2.5}
        raycast={noRaycast}
      />
      <Line
        points={outline.frame}
        segments
        color={color}
        lineWidth={1}
        transparent
        opacity={0.55}
        raycast={noRaycast}
      />
    </group>
  );
}

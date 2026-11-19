import { useBackgroundShown } from '@/features/viewer3d/scene/useBackgroundShown';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import {
  worldBoxToThree,
  worldPoint,
  worldToThree,
  type ThreeBox,
  type ThreePoint,
} from '@/features/viewer3d/worldCoordinates';
import { Edges } from '@react-three/drei';
import { useMemo } from 'react';

/** World 원점 모서리에서 시작하는 교실. 바닥은 World X 0~sizeX, Y 0~sizeY, Z=0 이다. */
export interface WorldRoom {
  sizeX: number;
  sizeY: number;
  /** 벽 경계선 높이. 위치를 알리는 안내선일 뿐 실측 천장 높이가 아니다. */
  wallHeight: number;
}

/**
 * 실측이 아닌 DEMO 교실. 실제 치수는 캘리브레이션·COMMITTED glTF(S15P31A101-59)·Provider(S15P31A101-194)가 정한다.
 * BEV 평면도 치수는 보조 배경일 뿐 안전 판단용 World 정본이 아니라서 이 값을 대신하지 않는다.
 */
export const DEMO_ROOM: WorldRoom = { sizeX: 10, sizeY: 10, wallHeight: 1.1 };

/**
 * planeGeometry 는 로컬 XY 평면이다. X 축으로 -90° 돌리면 로컬 (u, v, 0) 이 Three (u, 0, -v) 가 되어
 * worldToThree(u, v, 0) 과 같다. 그래서 바닥 로컬 좌표가 곧 World X·Y 다(테스트로 확인한다).
 */
export const FLOOR_ROTATION_X = -Math.PI / 2;

export interface RoomLayout {
  floor: { position: ThreePoint; size: [number, number] };
  walls: ThreeBox;
}

/** 교실 바닥·벽 경계의 Three 배치. 크기가 양의 유한수가 아니면 null(그리지 않는다). */
export function roomLayout({ sizeX, sizeY, wallHeight }: WorldRoom): RoomLayout | null {
  const valid = [sizeX, sizeY, wallHeight].every((n) => Number.isFinite(n) && n > 0);
  if (!valid) return null;
  const walls = worldBoxToThree(worldPoint(0, 0, 0), worldPoint(sizeX, sizeY, wallHeight));
  if (!walls) return null;
  return {
    floor: { position: worldToThree(worldPoint(sizeX / 2, sizeY / 2, 0)), size: [sizeX, sizeY] },
    walls,
  };
}

// WebGL 재질은 CSS 토큰을 바로 읽지 못해 장면 전용 값을 여기에만 둔다. 다크·화이트 배경 모두에서 바닥이 구분되는 중간 톤이다.
const FLOOR_OPACITY = 0.3;

// 바닥·벽은 선택을 받지 않는다. 사람·구역 클릭과 빈 곳 클릭(선택 해제)을 가리지 않게 한다.
const noRaycast = () => null;

interface WorldSceneProps {
  room?: WorldRoom;
}

/**
 * World 바닥(Z=0)과 벽 경계. 바닥은 격자보다 깊이를 조금 밀어 격자선이 위에 보이게 한다(위치는 Z=0 그대로).
 * 둘 다 스캔(정적 배경)이 없을 때의 목업 바탕이라, 스캔이 보이는 동안은 숨긴다.
 */
export function WorldScene({ room = DEMO_ROOM }: WorldSceneProps) {
  const layout = useMemo(() => roomLayout(room), [room]);
  const palette = useScenePalette();
  // 정적 배경(-59)이 보이면 배경 바닥과 겹쳐 깜박이지 않게, 그리고 실제 벽과 DEMO 경계선이 어긋나 보이지 않게 숨긴다.
  const backgroundShown = useBackgroundShown();
  if (!layout) return null;

  return (
    <group name="world-room">
      <mesh
        name="world-floor"
        visible={!backgroundShown}
        position={layout.floor.position}
        rotation-x={FLOOR_ROTATION_X}
        raycast={noRaycast}
      >
        <planeGeometry args={layout.floor.size} />
        <meshStandardMaterial
          color={palette.floor}
          transparent
          opacity={FLOOR_OPACITY}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <mesh
        name="world-walls"
        visible={!backgroundShown}
        position={layout.walls.position}
        raycast={noRaycast}
      >
        <boxGeometry args={layout.walls.size} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges color={palette.wall} raycast={noRaycast} />
      </mesh>
    </group>
  );
}

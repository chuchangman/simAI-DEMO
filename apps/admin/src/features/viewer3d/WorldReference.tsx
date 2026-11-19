import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { worldPoint, worldToThree, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import { Line } from '@react-three/drei';

export interface WorldReferencePoint {
  /** 장면 객체 이름(world-ref:<key>). */
  key: string;
  label: string;
  world: WorldPoint;
  color: number;
}

// 축 색은 흔한 관례(X 빨강·Y 초록·Z 파랑)를 따른다.
const AXIS_COLOR = { X: 0xe5484d, Y: 0x30a46c, Z: 0x3e63dd } as const;
const ORIGIN_COLOR = 0xf5f5f5;

/** 원점과 World ±X·±Y·±Z 1m. 좌표 정합을 눈으로 확인하는 기준점이다. */
export const WORLD_REFERENCE_POINTS: readonly WorldReferencePoint[] = [
  { key: 'O', label: '원점 O', world: worldPoint(0, 0, 0), color: ORIGIN_COLOR },
  { key: '+X', label: '+X 1m', world: worldPoint(1, 0, 0), color: AXIS_COLOR.X },
  { key: '-X', label: '-X 1m', world: worldPoint(-1, 0, 0), color: AXIS_COLOR.X },
  { key: '+Y', label: '+Y 1m', world: worldPoint(0, 1, 0), color: AXIS_COLOR.Y },
  { key: '-Y', label: '-Y 1m', world: worldPoint(0, -1, 0), color: AXIS_COLOR.Y },
  { key: '+Z', label: '+Z 1m', world: worldPoint(0, 0, 1), color: AXIS_COLOR.Z },
  { key: '-Z', label: '-Z 1m', world: worldPoint(0, 0, -1), color: AXIS_COLOR.Z },
];

const AXES = [
  { from: worldPoint(-1, 0, 0), to: worldPoint(1, 0, 0), color: AXIS_COLOR.X },
  { from: worldPoint(0, -1, 0), to: worldPoint(0, 1, 0), color: AXIS_COLOR.Y },
  { from: worldPoint(0, 0, -1), to: worldPoint(0, 0, 1), color: AXIS_COLOR.Z },
];

const noRaycast = () => null;

/** 디버그용 World 원점·축·1m 기준점. 선택을 받지 않고 카메라도 건드리지 않는다. */
export function WorldReference() {
  return (
    <group name="world-reference">
      {AXES.map((axis) => (
        <Line
          key={axis.color}
          points={[worldToThree(axis.from), worldToThree(axis.to)]}
          color={axis.color}
          lineWidth={3}
          raycast={noRaycast}
        />
      ))}
      {WORLD_REFERENCE_POINTS.map((point) => (
        <mesh
          key={point.key}
          name={`world-ref:${point.key}`}
          position={worldToThree(point.world)}
          raycast={noRaycast}
        >
          <sphereGeometry args={[point.key.startsWith('-') ? 0.06 : 0.09, 16, 12]} />
          <meshBasicMaterial color={point.color} />
          <LabelSprite text={point.label} y={0.26} />
        </mesh>
      ))}
    </group>
  );
}

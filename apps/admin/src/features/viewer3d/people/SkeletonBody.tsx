import { useSpatialDataStore } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  COCO_BONES,
  type DrawnLook,
  type SkeletonBall,
  type SkeletonFigure,
  type SkeletonSegment,
} from '@/features/viewer3d/people/skeletonPose';
import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import {
  CylinderGeometry,
  DoubleSide,
  Matrix4,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type InstancedMesh,
  type Material,
  type Mesh,
} from 'three';

// -56 Tier 0 골격 아바타(명세 13.1 캡슐·막대, InstancedMesh). 사람마다 막대·관절 구를 실선/흐림 두 벌로 둔다.
// 모양 계산은 skeletonPose.ts 가 하고, 여기서는 새 World 표본이 올 때만 인스턴스 행렬을 다시 쓴다.

/** 마지막 World 표본이 이보다 오래되면(또는 수신이 끊기면) 골격을 한 단계 더 흐리게 해 새 관측처럼 보이지 않게 한다(ms). */
export const SKELETON_STALE_MS = 1000;
/** 흐린 관절은 실선 투명도의 이 비율로 그린다. */
const FADED_RATIO = 0.35;
const STALE_RATIO = 0.5;
const MAX_SEGMENTS = COCO_BONES.length + 4; // 몸통·목·발 막대 2
const MAX_BALLS = 13; // 몸 관절 12 + 머리

// 모든 사람이 같은 형상을 쓴다(반지름·높이 1). 사람이 늘어도 GPU 형상 수가 늘지 않고, 화면이 내려가도 버리지 않는다.
const UNIT_CYLINDER = new CylinderGeometry(1, 1, 1, 10, 1);
const UNIT_SPHERE = new SphereGeometry(1, 14, 10);
const ANCHOR_RING = new RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2);
const noRaycast = () => null;

const UP = new Vector3(0, 1, 0);
const _from = new Vector3();
const _to = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _matrix = new Matrix4();

function writeSegments(mesh: InstancedMesh, segments: readonly SkeletonSegment[], look: DrawnLook) {
  let n = 0;
  for (const s of segments) {
    if (s.look !== look) continue;
    _from.set(s.from[0], s.from[1], s.from[2]);
    _to.set(s.to[0], s.to[1], s.to[2]);
    _dir.subVectors(_to, _from);
    const length = _dir.length();
    if (length < 1e-4) continue;
    _quat.setFromUnitVectors(UP, _dir.divideScalar(length));
    _scale.set(s.radius, length, s.radius);
    _matrix.compose(_from.add(_to).multiplyScalar(0.5), _quat, _scale);
    mesh.setMatrixAt(n++, _matrix);
  }
  finish(mesh, n);
}

function writeBalls(mesh: InstancedMesh, balls: readonly SkeletonBall[], look: DrawnLook) {
  let n = 0;
  _quat.identity();
  for (const b of balls) {
    if (b.look !== look) continue;
    _scale.setScalar(b.radius);
    _matrix.compose(_from.set(b.at[0], b.at[1], b.at[2]), _quat, _scale);
    mesh.setMatrixAt(n++, _matrix);
  }
  finish(mesh, n);
}

function finish(mesh: InstancedMesh, count: number) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  // 화면 밖 잘라내기·광선 선택이 바뀐 인스턴스 범위를 쓰도록 경계를 다시 계산하게 한다.
  mesh.boundingSphere = null;
  mesh.boundingBox = null;
}

/** 인스턴스 메시들에 골격 모양을 쓴다. 없으면 모두 비운다. */
export function applySkeletonFigure(
  meshes: {
    solidSegments: InstancedMesh;
    fadedSegments: InstancedMesh;
    solidBalls: InstancedMesh;
    fadedBalls: InstancedMesh;
  },
  figure: SkeletonFigure | null,
) {
  const segments = figure?.segments ?? [];
  const balls = figure?.balls ?? [];
  writeSegments(meshes.solidSegments, segments, 'SOLID');
  writeSegments(meshes.fadedSegments, segments, 'FADED');
  writeBalls(meshes.solidBalls, balls, 'SOLID');
  writeBalls(meshes.fadedBalls, balls, 'FADED');
}

export interface SkeletonMotion {
  figure: SkeletonFigure | null;
  /** 마지막 World 표본을 받은 브라우저 시각(ms). */
  sampleAt: number;
}

interface SkeletonBodyProps {
  motion: RefObject<SkeletonMotion>;
  color: number;
  /** 관측 상태에 따른 실선 투명도(OBSERVED 1, PREDICTED 반투명). */
  opacity: number;
  /** 접지 표식: 확인(실선 고리)·불확실(흐린 고리)·없음(골반 기준 → 이름표의 접지 미확인). */
  anchor: 'CONFIRMED' | 'UNCERTAIN' | 'NONE';
}

export function SkeletonBody({ motion, color, opacity, anchor }: SkeletonBodyProps) {
  const data = useSpatialDataStore();
  const solidSegments = useRef<InstancedMesh>(null);
  const fadedSegments = useRef<InstancedMesh>(null);
  const solidBalls = useRef<InstancedMesh>(null);
  const fadedBalls = useRef<InstancedMesh>(null);
  const ring = useRef<Mesh>(null);
  const applied = useRef<SkeletonFigure | null | undefined>(undefined);

  useFrame(() => {
    const m = motion.current;
    const meshes = {
      solidSegments: solidSegments.current,
      fadedSegments: fadedSegments.current,
      solidBalls: solidBalls.current,
      fadedBalls: fadedBalls.current,
    };
    if (!meshes.solidSegments || !meshes.fadedSegments || !meshes.solidBalls || !meshes.fadedBalls)
      return;
    if (applied.current !== m.figure) {
      applySkeletonFigure(meshes as Parameters<typeof applySkeletonFigure>[0], m.figure);
      applied.current = m.figure;
    }
    // 수신이 끊기거나 표본이 오래되면 한 단계 더 흐리게 한다(새 관측처럼 보이지 않게).
    const open = data.getState().connection?.state === 'OPEN';
    const stale = !open || Date.now() - m.sampleAt > SKELETON_STALE_MS;
    const base = opacity * (stale ? STALE_RATIO : 1);
    setOpacity(meshes.solidSegments, base);
    setOpacity(meshes.solidBalls, base);
    setOpacity(meshes.fadedSegments, base * FADED_RATIO);
    setOpacity(meshes.fadedBalls, base * FADED_RATIO);
    setOpacity(ring.current, anchor === 'CONFIRMED' ? base * 0.9 : base * FADED_RATIO);
  });

  // 실선은 관측(불투명)일 때만 깊이를 쓴다. 반투명(예측)·흐린 관절은 뒤의 사람·구역을 가리지 않는다.
  const solid = { transparent: true, roughness: 0.6, color, opacity, depthWrite: opacity >= 1 };
  const faded = { ...solid, opacity: opacity * FADED_RATIO, depthWrite: false };
  return (
    <group name="person-skeleton">
      <instancedMesh
        ref={solidSegments}
        args={[UNIT_CYLINDER, undefined, MAX_SEGMENTS]}
        frustumCulled={false}
      >
        <meshStandardMaterial attach="material" {...solid} />
      </instancedMesh>
      <instancedMesh
        ref={fadedSegments}
        args={[UNIT_CYLINDER, undefined, MAX_SEGMENTS]}
        frustumCulled={false}
      >
        <meshStandardMaterial attach="material" {...faded} />
      </instancedMesh>
      <instancedMesh
        ref={solidBalls}
        args={[UNIT_SPHERE, undefined, MAX_BALLS]}
        frustumCulled={false}
      >
        <meshStandardMaterial attach="material" {...solid} />
      </instancedMesh>
      <instancedMesh
        ref={fadedBalls}
        args={[UNIT_SPHERE, undefined, MAX_BALLS]}
        frustumCulled={false}
      >
        <meshStandardMaterial attach="material" {...faded} />
      </instancedMesh>
      {anchor !== 'NONE' && (
        <mesh
          ref={ring}
          name={anchor === 'CONFIRMED' ? 'ground-anchor' : 'ground-anchor-uncertain'}
          geometry={ANCHOR_RING}
          position-y={0.01}
          raycast={noRaycast}
        >
          <meshBasicMaterial
            attach="material"
            color={color}
            transparent
            side={DoubleSide}
            depthWrite={false}
            opacity={anchor === 'CONFIRMED' ? opacity * 0.9 : opacity * FADED_RATIO}
          />
        </mesh>
      )}
    </group>
  );
}

function setOpacity(mesh: { material: Material | Material[] } | null, value: number) {
  if (mesh && !Array.isArray(mesh.material)) mesh.material.opacity = value;
}

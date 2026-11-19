import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import {
  COVERAGE_CLASSES,
  coverageRuns,
  type CoverageClassKey,
  type CoverageRun,
  type FloorCoverage,
} from '@/lib/floorCoverage';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { useStore } from 'zustand';

// 바닥 감시 범위 겹침(S15P31A101-606). 칸마다 사람을 통째로 보는 카메라 수(2대 이상·1대·사각)를 바닥 바로 위에 반투명하게 깐다.
// Visual 층이다: 클릭을 받지 않고, 사람·구역·위험 강조보다 뒤(먼저 그리고 깊이를 쓰지 않음)에 둔다.

/** 바닥(Z=0)에서 띄우는 높이(m). 재구성 바닥 메시의 요철(수 cm)에 묻히지 않을 만큼만 띄운다. */
export const FLOOR_COVERAGE_LIFT_M = 0.03;

const noRaycast = () => null;

/**
 * 한 종류 칸 묶음들의 삼각형 꼭짓점(Three 좌표, 칸마다 삼각형 둘). World → Three 는 worldToThree 로만 바꾼다(AGENTS 규칙 3).
 */
export function coverageTriangles(
  runs: readonly CoverageRun[],
  kind: CoverageClassKey,
  liftM: number = FLOOR_COVERAGE_LIFT_M,
): Float32Array {
  const picked = runs.filter((r) => r.kind === kind);
  const out = new Float32Array(picked.length * 18);
  let i = 0;
  for (const r of picked) {
    const a = worldToThree(worldPoint(r.minX, r.minY, liftM));
    const b = worldToThree(worldPoint(r.maxX, r.minY, liftM));
    const c = worldToThree(worldPoint(r.maxX, r.maxY, liftM));
    const d = worldToThree(worldPoint(r.minX, r.maxY, liftM));
    for (const p of [a, b, c, a, c, d]) {
      out.set(p, i);
      i += 3;
    }
  }
  return out;
}

function buildGeometries(coverage: FloorCoverage) {
  const runs = coverageRuns(coverage);
  return COVERAGE_CLASSES.map((cls) => {
    const positions = coverageTriangles(runs, cls.key);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return { cls, geometry, empty: positions.length === 0 };
  });
}

export function FloorCoverageLayer() {
  const viewerStore = useViewerStore();
  const coverage = useStore(viewerStore, (s) => s.floorCoverage);
  const parts = useMemo(() => (coverage ? buildGeometries(coverage) : []), [coverage]);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  if (parts.length === 0) return null;
  return (
    <group name="floor-coverage">
      {parts.map(({ cls, geometry, empty }) =>
        empty ? null : (
          <mesh
            key={cls.key}
            name={`floor-coverage-${cls.key}`}
            geometry={geometry}
            raycast={noRaycast}
            renderOrder={-1}
          >
            <meshBasicMaterial
              color={cls.color}
              transparent
              opacity={cls.opacity}
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
            />
          </mesh>
        ),
      )}
    </group>
  );
}

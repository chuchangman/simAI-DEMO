import type { SpatialDataState } from '@/features/viewer3d/data/spatialData.store';
import { useSpatialData, useSpatialDataStore } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  trackPlacement,
  type TrackView,
  type WorldFrame,
} from '@/features/viewer3d/data/spatialFrame';
import { worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { FLOOR_ROTATION_X } from '@/features/viewer3d/WorldScene';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  CircleGeometry,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Mesh,
  type MeshBasicMaterial,
} from 'three';

// 접지 그림자 레이어(S15P31A101-360). people/ 폴더를 건드리지 않고, World 의 사람 접지 상태만 읽어
// 접지가 확인된(groundConfirmed === true, contact·z·supportSurface 가 모두 VALID 이고 inferred 가 아닌) 사람 발아래에만
// 가벼운 원형 감쇠 그림자(contact shadow)를 바닥에 깐다. 접지 미확인·불확실·UNKNOWN 인 사람에게는 그리지 않는다.

export const GROUND_SHADOW_RADIUS_M = 0.34;
export const GROUND_SHADOW_LIFT_M = 0.006;
export const GROUND_SHADOW_OPACITY_OBSERVED = 0.48;
export const GROUND_SHADOW_OPACITY_PREDICTED = 0.24;
const SHADOW_POSITION_RATE = 12;
const SHADOW_SNAP_DISTANCE_M = 1.5;

const noRaycast = () => null;

const SHADOW_GEOMETRY = new CircleGeometry(GROUND_SHADOW_RADIUS_M, 24);

/** 중심에서 가장자리로 부드럽게 사라지는 원형 감쇠 텍스처(64×64 RGBA). 모든 그림자가 공유한다. */
export const GROUND_SHADOW_TEXTURE = (() => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const r2 = Math.min(1, dx * dx + dy * dy);
      const falloff = (1 - r2) * (1 - r2);
      const idx = (y * size + x) * 4;
      data[idx] = 8;
      data[idx + 1] = 12;
      data[idx + 2] = 20;
      data[idx + 3] = Math.round(falloff * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

function validGroundPoint(track: TrackView | undefined): ThreePoint | null {
  if (!track || track.observationState === 'UNKNOWN') return null;
  const placement = trackPlacement(track);
  if (placement.basis !== 'GROUND_ANCHOR' || !placement.groundConfirmed) return null;
  return worldToThree(placement.world);
}

/**
 * 이 사람 발아래에 접지 그림자를 그릴지 판정한다.
 * - 관측 상태가 UNKNOWN 이면 그리지 않는다.
 * - trackPlacement(track).groundConfirmed 가 참(groundAnchor 존재, contact·z·supportSurface 모두 VALID, surfaceSource !== 'inferred')일 때만 참이다.
 */
export function hasValidGroundShadow(track: TrackView): boolean {
  return validGroundPoint(track) !== null;
}

const trackOf = (world: WorldFrame | null, worldId: string): TrackView | undefined =>
  world?.tracks.find((t) => t.worldId === worldId);

const selectValidShadowIds = (state: SpatialDataState): string =>
  (state.world?.tracks ?? [])
    .filter(hasValidGroundShadow)
    .map((t) => t.worldId)
    .join('\n');

const approach = (current: number, target: number, dtSec: number, rate: number) =>
  current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dtSec)));

export function GroundShadowLayer() {
  const sourceId = useSpatialData((s) => s.sourceId);
  const idsKey = useSpatialData(selectValidShadowIds);
  const ids = useMemo(() => (idsKey ? idsKey.split('\n') : []), [idsKey]);
  return (
    <group name="ground-shadow-layer">
      {ids.map((id) => (
        <GroundShadow key={`${sourceId}:${id}`} worldId={id} />
      ))}
    </group>
  );
}

function GroundShadow({ worldId }: { worldId: string }) {
  const store = useSpatialDataStore();
  const observationState = useSpatialData(
    (s) => trackOf(s.world, worldId)?.observationState ?? 'UNKNOWN',
  );
  const meshRef = useRef<Mesh>(null);
  const matRef = useRef<MeshBasicMaterial>(null);
  const stateRef = useRef<{
    initialized: boolean;
    revision: number | null;
    display: [number, number, number];
  }>({
    initialized: false,
    revision: null,
    display: [0, 0, 0],
  });

  useLayoutEffect(() => {
    const off = store.subscribe((state) => {
      const track = trackOf(state.world, worldId);
      const mesh = meshRef.current;
      const point = validGroundPoint(track);
      if (!mesh || !track || !point) return;
      const [tx, ty, tz] = point;
      const s = stateRef.current;
      const revChanged = s.revision !== null && s.revision !== track.identityRevision;
      const dist = Math.hypot(tx - s.display[0], ty - s.display[1], tz - s.display[2]);
      if (!s.initialized || revChanged || dist > SHADOW_SNAP_DISTANCE_M) {
        s.initialized = true;
        s.revision = track.identityRevision;
        s.display = [tx, ty, tz];
        mesh.position.set(tx, ty + GROUND_SHADOW_LIFT_M, tz);
      }
    });
    const initialTrack = trackOf(store.getState().world, worldId);
    const initialPoint = validGroundPoint(initialTrack);
    if (meshRef.current && initialTrack && initialPoint) {
      const [tx, ty, tz] = initialPoint;
      stateRef.current.initialized = true;
      stateRef.current.revision = initialTrack.identityRevision;
      stateRef.current.display = [tx, ty, tz];
      meshRef.current.position.set(tx, ty + GROUND_SHADOW_LIFT_M, tz);
    }
    return off;
  }, [store, worldId]);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const track = trackOf(store.getState().world, worldId);
    const point = validGroundPoint(track);
    if (!mesh || !track || !point) return;
    const [tx, ty, tz] = point;
    const s = stateRef.current;
    const revChanged = s.revision !== null && s.revision !== track.identityRevision;
    const dist = Math.hypot(tx - s.display[0], ty - s.display[1], tz - s.display[2]);
    if (!s.initialized || revChanged || dist > SHADOW_SNAP_DISTANCE_M) {
      s.initialized = true;
      s.revision = track.identityRevision;
      s.display = [tx, ty, tz];
    } else {
      s.display = [
        approach(s.display[0], tx, dt, SHADOW_POSITION_RATE),
        approach(s.display[1], ty, dt, SHADOW_POSITION_RATE),
        approach(s.display[2], tz, dt, SHADOW_POSITION_RATE),
      ];
    }
    mesh.position.set(s.display[0], s.display[1] + GROUND_SHADOW_LIFT_M, s.display[2]);
  });

  const track = trackOf(store.getState().world, worldId);
  if (!track || !hasValidGroundShadow(track)) return null;
  const opacity =
    observationState === 'PREDICTED'
      ? GROUND_SHADOW_OPACITY_PREDICTED
      : GROUND_SHADOW_OPACITY_OBSERVED;

  return (
    <mesh
      ref={meshRef}
      name={`ground-shadow:${worldId}`}
      geometry={SHADOW_GEOMETRY}
      rotation-x={FLOOR_ROTATION_X}
      raycast={noRaycast}
      renderOrder={-1}
    >
      <meshBasicMaterial
        ref={matRef}
        map={GROUND_SHADOW_TEXTURE}
        transparent
        opacity={opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        toneMapped={false}
      />
    </mesh>
  );
}

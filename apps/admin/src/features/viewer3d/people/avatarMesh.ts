import type { SpatialDataState } from '@/features/viewer3d/data/spatialData.store';
import { attachAvatarAppearanceShader } from '@/features/viewer3d/people/avatarAppearance';
import {
  createAvatarAssetCache,
  type AvatarCacheEntry,
} from '@/features/viewer3d/people/avatarAssetCache';
import type { AvatarAssetView } from '@/features/viewer3d/people/avatarFrame';
import {
  avatarMeshStatus,
  type AvatarAssetState,
  type AvatarMeshStatus,
} from '@/features/viewer3d/people/avatarMeshPolicy';
import type { PoseTarget } from '@/features/viewer3d/people/avatarPose';
import { createContext, useEffect, useEffectEvent, useReducer, useState } from 'react';
import {
  BufferAttribute,
  type Bone,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Quaternion,
  type Skeleton,
  type SkinnedMesh,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// EXP-02 사람별 스키닝 glTF(-88 산출물) 읽기·확인·캐시(-65). 자산은 표시용이다. 실패하면 캡슐로 그리고 Viewer 오류로 번지지 않는다.
// 확인: 내려받은 바이트 sha256 = mesh_sha256, 뼈 수 = joint_count, 부모 배열 해시 = joint_parents_sha256, pelvis 관절 범위.

/** 자산 내려받기. FE 가 인증된 요청 함수로 바꿔 끼운다(같은 출처 /api/avatars/... 경로만 온다). */
export type AvatarMeshFetch = (url: string) => Promise<ArrayBuffer>;

export const fetchAvatarMesh: AvatarMeshFetch = async (url) => {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.arrayBuffer();
};

export interface AvatarMeshConfig {
  /** false 면 포즈가 와도 늘 캡슐(-44·-56 경로)로 그린다. */
  enabled: boolean;
  fetch: AvatarMeshFetch;
}

export const AvatarMeshContext = createContext<AvatarMeshConfig>({
  enabled: true,
  fetch: fetchAvatarMesh,
});

/** 실패한 자산을 다시 시도하기까지(ms). 워커가 자산을 10초마다 다시 알리는 간격과 같다. */
export const AVATAR_ASSET_RETRY_MS = 10_000;

export interface AvatarMeshAsset {
  key: string;
  scene: Object3D;
  jointCount: number;
  pelvisJointIndex: number;
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Of(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // 보안 컨텍스트(https·localhost)가 아니면 crypto.subtle 이 없다. 확인할 수 없는 자산은 쓰지 않는다.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('sha256 확인 불가(보안 컨텍스트 아님)');
  return 'sha256:' + hex(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

/** 계약 joint_parents_sha256: 부모 배열을 공백 없는 JSON 으로 적은 UTF-8 바이트의 sha256(-88 rig.py 와 같다). */
export const jointParentsSha256 = (parents: readonly number[]) =>
  sha256Of(new TextEncoder().encode(JSON.stringify(parents)));

export const avatarAssetKey = (asset: AvatarAssetView) =>
  [
    asset.meshSha256,
    asset.meshFormat,
    asset.jointCount,
    asset.jointParentsSha256,
    asset.pelvisJointIndex,
  ].join('|');

function firstSkinned(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null;
  root.traverse((node) => {
    if (!found && (node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh;
  });
  return found;
}

/**
 * 실제 MHR GLB(-88 gltf_export.py)는 TEXCOORD_0(uv)을 싣지만, 합성 fixture GLB 는 sha256 고정 채로 uv 가 없다.
 * uv 가 없을 때만 바인드 자세 좌표에서 glTF 상단 원점(머리 v≈0, 발끝 v≈1, 앞면 u∈[0.05,0.45], 뒷면 u∈[0.55,0.95]) UV 를 채운다.
 */
export function ensureAvatarMeshUv(geometry: BufferGeometry): void {
  if (geometry.getAttribute('uv')) return;
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = (pos.getX(i) - minX) / spanX;
    const ny = (pos.getY(i) - minY) / spanY;
    const front = pos.getZ(i) >= 0;
    uvs[i * 2] = (front ? 0.05 : 0.55) + nx * 0.4;
    uvs[i * 2 + 1] = 1 - ny;
  }
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
}

/** 내려받은 바이트를 확인하고 읽는다. 맞지 않으면 이유를 담은 Error 를 던진다. */
export async function readAvatarMesh(
  data: ArrayBuffer,
  asset: AvatarAssetView,
): Promise<AvatarMeshAsset> {
  if ((await sha256Of(data)) !== asset.meshSha256) throw new Error('sha256 불일치');
  const base = asset.meshUrl.slice(0, asset.meshUrl.lastIndexOf('/') + 1);
  const gltf = await new GLTFLoader().parseAsync(data, base);
  const skinned = firstSkinned(gltf.scene);
  if (!skinned) throw new Error('스키닝 메시 없음');
  const bones = skinned.skeleton.bones;
  if (bones.length !== asset.jointCount) throw new Error('관절 수 불일치');
  const parents = bones.map((bone) => bones.indexOf(bone.parent as Bone));
  if ((await jointParentsSha256(parents)) !== asset.jointParentsSha256) {
    throw new Error('관절 부모 해시 불일치');
  }
  if (asset.pelvisJointIndex >= bones.length) throw new Error('pelvis 관절 범위 밖');
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      ensureAvatarMeshUv(mesh.geometry);
    }
  });
  return {
    key: avatarAssetKey(asset),
    scene: gltf.scene,
    jointCount: bones.length,
    pelvisJointIndex: asset.pelvisJointIndex,
  };
}

interface Entry extends AvatarCacheEntry {
  state: AvatarAssetState;
  mesh: AvatarMeshAsset | null;
  settled: Promise<void>;
  at: number;
}

function disposeScene(scene: Object3D) {
  scene.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: Skeleton };
    mesh.geometry?.dispose();
    const materials = mesh.material ? [mesh.material].flat() : [];
    materials.forEach((m) => m.dispose());
    mesh.skeleton?.dispose();
  });
}

// 마지막 사용자가 놓은 뒤 AVATAR_ASSET_RELEASE_MS 동안 남긴다(-797: 작업 시작으로 화면이 바뀌어도 다시 받지 않음).
const meshCache = createAvatarAssetCache<Entry>((entry) => {
  if (entry.mesh) disposeScene(entry.mesh.scene);
});
const cache = meshCache.map;

/** 자산 읽기를 시작한다(이미 있으면 그대로). 실패한 지 AVATAR_ASSET_RETRY_MS 가 지났으면 다시 받는다. */
export function requestAvatarMesh(
  asset: AvatarAssetView,
  fetcher: AvatarMeshFetch = fetchAvatarMesh,
  now = Date.now(),
): Entry {
  const key = avatarAssetKey(asset);
  const prev = cache.get(key);
  if (prev && !(prev.state.status === 'ERROR' && now - prev.at >= AVATAR_ASSET_RETRY_MS)) {
    return prev;
  }
  const entry: Entry = {
    state: { status: 'LOADING' },
    mesh: null,
    settled: Promise.resolve(),
    at: now,
    refs: prev?.refs ?? 0,
    timer: prev?.timer ?? null,
    idleSeq: prev?.idleSeq ?? 0,
  };
  entry.settled = Promise.resolve()
    .then(() => fetcher(asset.meshUrl))
    .then((data) => readAvatarMesh(data, asset))
    .then(
      (mesh) => {
        entry.mesh = mesh;
        entry.state = { status: 'READY' };
      },
      (error: unknown) => {
        entry.state = {
          status: 'ERROR',
          reason: error instanceof Error ? error.message : '자산을 읽지 못함',
        };
        entry.at = Date.now();
        console.warn('아바타 메시를 읽지 못해 캡슐로 그린다: ' + asset.meshUrl, error);
      },
    );
  cache.set(key, entry);
  return entry;
}

export function avatarAssetState(asset: AvatarAssetView | null): AvatarAssetState {
  return (asset && cache.get(avatarAssetKey(asset))?.state) || { status: 'NONE' };
}

/** 한 사람의 지금 메시 판정(진단·상태 표시용). 그 사람이 World 에 없으면 null. */
export function selectAvatarMeshStatus(
  state: SpatialDataState,
  worldId: string,
  now: number,
  enabled = true,
): AvatarMeshStatus | null {
  const track = state.world?.tracks.find((t) => t.worldId === worldId);
  if (!state.world || !track) return null;
  const avatar = state.avatars.get(worldId);
  return avatarMeshStatus({
    enabled,
    track,
    world: state.world,
    avatar,
    asset: avatarAssetState(avatar?.asset ?? null),
    now,
  });
}

/** 시험용: 캐시를 비운다. */
export function clearAvatarMeshCache() {
  meshCache.clear();
}

/**
 * key 의 자산을 쓴다. 자산은 getAsset 으로 읽는다(포즈마다 새 객체라 key 로만 다시 연결한다).
 * 읽는 중·실패·없음이면 mesh 가 null 이다. 실패하면 AVATAR_ASSET_RETRY_MS 뒤 다시 시도한다.
 */
export function useAvatarMesh(
  key: string | null,
  getAsset: () => AvatarAssetView | null,
  fetcher: AvatarMeshFetch,
): { state: AvatarAssetState; mesh: AvatarMeshAsset | null } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [retry, setRetry] = useState(0);
  const readAsset = useEffectEvent(getAsset);
  useEffect(() => {
    const asset = readAsset();
    if (!key || !asset || avatarAssetKey(asset) !== key) return;
    const entry = requestAvatarMesh(asset, fetcher);
    meshCache.retain(key);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void entry.settled.then(() => {
      if (!alive) return;
      rerender();
      if (entry.state.status === 'ERROR') {
        timer = setTimeout(() => setRetry((n) => n + 1), AVATAR_ASSET_RETRY_MS);
      }
    });
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      meshCache.release(key);
    };
    // 자산은 key 가 같으면 같은 것으로 본다(포즈마다 새 객체다). retry 는 실패 뒤 다시 시도할 때만 바뀐다.
  }, [key, fetcher, retry]);
  const entry = key ? cache.get(key) : undefined;
  return {
    state: entry?.state ?? { status: 'NONE' },
    mesh: entry?.state.status === 'READY' ? entry.mesh : null,
  };
}

export interface AvatarMeshInstance extends PoseTarget {
  root: Object3D;
  materials: Material[];
  dispose(): void;
}

/** 사람 하나의 복제본. 뼈대·재질은 따로, 형상은 원본과 공유한다(해제 때 공유 자원은 건드리지 않는다). */
export function instantiateAvatarMesh(asset: AvatarMeshAsset): AvatarMeshInstance {
  const root = cloneSkinned(asset.scene);
  const materials: Material[] = [];
  const skeletons: Skeleton[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: Skeleton };
    if (mesh.skeleton && !skeletons.includes(mesh.skeleton)) skeletons.push(mesh.skeleton);
    if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
    const material = mesh.material.clone();
    material.transparent = true;
    attachAvatarAppearanceShader(material);
    mesh.material = material;
    // 스키닝 뒤 경계 구가 실제 자세와 달라 화면 밖으로 잘리지 않게 한다(-88 권장).
    node.frustumCulled = false;
    materials.push(material);
  });
  const skinned = firstSkinned(root)!;
  const bones = skinned.skeleton.bones;
  const bind: Quaternion[] = bones.map((bone) => bone.quaternion.clone());
  return {
    root,
    bones,
    bind,
    pelvis: bones[asset.pelvisJointIndex]!,
    materials,
    dispose() {
      materials.forEach((material) => material.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose());
    },
  };
}

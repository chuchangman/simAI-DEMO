import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { SceneBackground } from '@/features/viewer3d/scene/SceneBackground';
import type { ViewerSceneInput } from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  SceneLoaderContext,
  SceneStoreContext,
  SceneVdtTextureLoaderContext,
  type SceneAssetLoader,
  type SceneStore,
  type SceneVdtTextureLoader,
} from '@/features/viewer3d/scene/sceneStore';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { advance, createRoot, extend, type ReconcilerRoot } from '@react-three/fiber';
import { act } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 카메라 시점 VDT(S15P31A101-590): 시점이 카메라에 맞아 있는 동안만 장착하고 서서히 켜고 끈다.
// 사진은 장면 vdt 가 없을 때 cameraImageUrls(사람 지운 배경 자리) + map_cameras 로 만든 설정에서 온다.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const BG_URL = 'https://assets.invalid/clean-bg/cam_A.jpg';
const MAP_CAMERAS = {
  cam_A: {
    image_size: [2304, 1296],
    K: [
      [1152, 0, 1152],
      [0, 1152, 648],
      [0, 0, 1],
    ],
    R: [
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
    ],
    t: [2.0, 1.5, -1.0],
    pose_source: 'MA_ALIGNED_SIM3',
  },
};
const INPUT: ViewerSceneInput = {
  ok: true,
  raw: {
    scene_version: 'scene-cam-1',
    state: 'COMMITTED',
    default: false,
    calibration_version: 'cal-demo',
    committed_at_ms: 1_760_342_400_000,
    quality: null,
    gltf_url: 'https://assets.invalid/scene-cam-1.glb',
    gltf_expires_at_ms: Date.now() + 3_600_000,
    map_cameras: MAP_CAMERAS,
  },
};

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    dispose: () => {},
    forceContextLoss: () => {},
    domElement: canvas,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAnimationLoop: () => {},
    },
    renderLists: { dispose: () => {} },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

let viewer: ViewerStore;
let sceneStore: SceneStore;
let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let mesh: THREE.Mesh;
let textureLoader: ReturnType<typeof vi.fn<SceneVdtTextureLoader>>;
let clockS = 0;

const step = (seconds: number) =>
  act(async () => {
    clockS += seconds;
    advance(clockS);
  });
const strength = () =>
  (mesh.material as THREE.ShaderMaterial).uniforms?.uVdtStrength?.value as number | undefined;

async function mount(cameraImageUrls?: Readonly<Record<string, string>>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const rootGroup = new THREE.Group();
  mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.1, 4),
    new THREE.MeshStandardMaterial({
      map: new THREE.DataTexture(new Uint8Array([200, 180, 160, 255]), 1, 1),
    }),
  );
  rootGroup.add(mesh);
  const loader: SceneAssetLoader = vi.fn().mockResolvedValue(rootGroup);
  textureLoader = vi
    .fn<SceneVdtTextureLoader>()
    .mockImplementation((urls) =>
      Promise.resolve(
        urls.map(() => new THREE.DataTexture(new Uint8Array([90, 100, 110, 255]), 1, 1)),
      ),
    );
  sceneStore.getState().setVdtOptions({ cameraImageUrls });

  const canvas = document.createElement('canvas');
  root = createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <SpatialDataContext value={createSpatialDataStore()}>
        <ViewerStoreContext value={viewer}>
          <SceneStoreContext value={sceneStore}>
            <SceneLoaderContext value={loader}>
              <SceneVdtTextureLoaderContext value={textureLoader}>
                <SceneBackground />
              </SceneVdtTextureLoaderContext>
            </SceneLoaderContext>
          </SceneStoreContext>
        </ViewerStoreContext>
      </SpatialDataContext>,
    ),
  );
  await act(async () => sceneStore.getState().setInput(INPUT));
}

const align = (cameraId: string | null) =>
  act(async () => viewer.getState().setAlignedCamera(cameraId));

beforeEach(() => {
  clockS = 0;
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  sceneStore = createSceneStore();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

describe('카메라 시점 VDT', () => {
  it('맞아 있을 때만 사람 지운 배경 주소로 장착해 0.4 초에 걸쳐 켜고, 풀리면 서서히 끈 뒤 원래 재질로 돌린다', async () => {
    await mount({ cam_A: BG_URL });
    expect(textureLoader).not.toHaveBeenCalled();
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    const baked = mesh.material;

    await align('cam_A');
    expect(textureLoader).toHaveBeenCalledWith([BG_URL]);
    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(strength()).toBe(0);
    await step(0.2);
    expect(strength()).toBeCloseTo(0.5, 6);
    await step(0.3);
    expect(strength()).toBe(1);

    await align(null);
    await step(0.2);
    expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(strength()).toBeCloseTo(0.5, 6);
    await step(0.3);
    expect(mesh.material).toBe(baked);
  });

  it('사진 주소가 없으면(장면 vdt 도 없음) 맞아 있어도 VDT 를 켜지 않는다', async () => {
    await mount();
    await align('cam_A');
    await step(0.5);
    expect(textureLoader).not.toHaveBeenCalled();
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('사진을 받지 못하면 시점과 상관없이 원래 재질을 둔다', async () => {
    await mount({ cam_A: BG_URL });
    textureLoader.mockRejectedValueOnce(new Error('HTTP 404'));
    await align('cam_A');
    await step(0.5);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    await align(null);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('켠 동안 평균 FPS 가 기준 아래면 이번 카메라 시점에서 VDT 를 막고 서서히 끈다', async () => {
    await mount({ cam_A: BG_URL });
    const baked = mesh.material;
    await align('cam_A');
    // 10 FPS: 준비 1 초 + 창 2 초를 넘긴다
    for (let i = 0; i < 32 && viewer.getState().cameraVdtBlocked === null; i++) await step(0.1);
    expect(viewer.getState().cameraVdtBlocked).toBe('LOW_FPS');
    for (let i = 0; i < 6; i++) await step(0.1);
    expect(mesh.material).toBe(baked);
    // 시점은 맞아 있는 그대로다(시점 이동은 유지).
    expect(viewer.getState().alignedCamera).toBe('cam_A');
  });
});

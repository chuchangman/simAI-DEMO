import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import { SceneBackground } from '@/features/viewer3d/scene/SceneBackground';
import { sceneStatusOf, type ViewerSceneInput } from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  SceneLoaderContext,
  SceneStoreContext,
  sceneVersionsOf,
  type SceneAssetLoader,
  type SceneStore,
} from '@/features/viewer3d/scene/sceneStore';
import { shownScanBoundsOf } from '@/features/viewer3d/scene/useShownRoom';
import { SceneBase } from '@/features/viewer3d/SceneBase';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -59 배경 Scene 레이어. 읽기 함수를 바꿔 끼워 적재·표시·해제·늦은 결과 처리를 장면 수준에서 본다.
// 스캔이 보이는 동안 목업 바탕(격자·바닥·벽 경계)이 숨고 뷰어가 읽는 보이는 스캔 범위(shownScanBoundsOf)도 본다(-395).
// 실제 glTF 해석·픽셀은 격리 WebGL 브라우저에서 따로 확인한다.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const committed = (patch: Record<string, unknown> = {}) => ({
  ok: true as const,
  raw: {
    scene_version: 'scene-demo-1',
    state: 'COMMITTED',
    default: false,
    calibration_version: 'cal-demo',
    compatibility: {
      scene_version: patch.scene_version ?? 'scene-demo-1',
      calibration_version: 'calibration_version' in patch ? patch.calibration_version : 'cal-demo',
      verification: 'VERIFIED',
      regeneration_required: false,
      reason: 'SMALL_CHANGE',
      max_center_delta_m: 0.02,
      max_rotation_delta_rad: 0.01,
    },
    committed_at_ms: T0,
    quality: null,
    gltf_url: 'https://bucket.example/scene-demo-1.glb?sig=1',
    gltf_expires_at_ms: Date.now() + 300_000,
    ...patch,
  },
});

interface Deferred {
  url: string;
  /** 자산을 버전 키로 캐시할 때만 있다(COMMITTED). */
  cacheVersion?: string;
  resolve(root: THREE.Object3D): void;
  reject(error: unknown): void;
}
let calls: Deferred[];
const loader: SceneAssetLoader = (url, cacheVersion) =>
  new Promise((resolve, reject) => calls.push({ url, cacheVersion, resolve, reject }));

/** 바닥 판 하나(World 0..side × 0..side, 두께 0.1, 기본 한 변 10m). glTF 처럼 이미 Three 축이다. */
function asset(side = 10) {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(side, 0.1, side);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ opacity: 1 }));
  mesh.position.set(side / 2, -0.05, -side / 2);
  root.add(mesh);
  const disposed = vi.spyOn(geometry, 'dispose');
  return { root, mesh, disposed };
}

let data: SpatialDataStore;
let scene: SceneStore;
let three: THREE.Scene | null = null;

function Probe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    three = current;
  }, [current]);
  return null;
}

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

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
async function mount() {
  const canvas = document.createElement('canvas');
  root = createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <StrictMode>
        <SpatialDataContext value={data}>
          <ViewerStoreContext value={createViewerStore()}>
            <SceneStoreContext value={scene}>
              <SceneLoaderContext value={loader}>
                <Probe />
                <SceneBase />
                <SceneBackground />
              </SceneLoaderContext>
            </SceneStoreContext>
          </ViewerStoreContext>
        </SpatialDataContext>
      </StrictMode>,
    ),
  );
}

const find = (name: string) => three?.getObjectByName(name) ?? null;
const floor = () => find('world-floor')!;
const walls = () => find('world-walls')!;
const grid = () => three!.getObjectByProperty('type', 'GridHelper')!;
const roomBounds = () => shownScanBoundsOf(scene.getState());
/** 목업 바탕(격자·바닥·벽 경계)이 보이는지. 셋은 늘 같이 보이거나 같이 숨는다. */
const mockBackdrop = () => [grid().visible, floor().visible, walls().visible];
const status = () => {
  const s = scene.getState();
  return sceneStatusOf(s.input, s.load, sceneVersionsOf(data.getState()));
};
const setInput = (input: ViewerSceneInput | null) =>
  act(async () => scene.getState().setInput(input));
const settle = (d: Deferred, value: THREE.Object3D) => act(async () => d.resolve(value));
const fail = (d: Deferred, error: unknown) => act(async () => d.reject(error));
let tick = 0;
/** 새 msg_id·시각의 World 를 넣는다(같은 메시지는 중복으로 버려진다). */
const world = (patch: Record<string, unknown> = {}) => {
  const message = scenarioWorld('normal', tick, T0) as { payload: Record<string, unknown> };
  data
    .getState()
    .ingest({ ...message, payload: { ...message.payload, ...patch } }, T0 + tick * 100 + 20);
  tick += 1;
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  calls = [];
  tick = 0;
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  scene = createSceneStore();
  three = null;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

describe('SceneBackground', () => {
  it('버전이 맞는 COMMITTED 자산은 그대로(축 변환 없이) 보이고 기본 바닥을 숨기며 클릭을 받지 않는다', async () => {
    world();
    await mount();
    await setInput(committed());
    expect(calls.map((c) => c.url)).toEqual(['https://bucket.example/scene-demo-1.glb?sig=1']);
    expect(calls[0]!.cacheVersion).toBe('scene-demo-1');
    expect(status().phase).toBe('LOADING');
    const a = asset();
    await settle(calls[0]!, a.root);

    const layer = find('scene-background:scene-demo-1')!;
    expect(layer).toBe(a.root);
    expect(layer.visible).toBe(true);
    expect([
      layer.position.toArray(),
      layer.rotation.toArray().slice(0, 3),
      layer.scale.toArray(),
    ]).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(floor().visible).toBe(false);
    expect(status()).toMatchObject({ phase: 'LOADED', verification: 'VERIFIED', display: 'FULL' });
    // 스캔이 보이면 목업 격자·바닥·벽 경계가 숨고, 스캔 범위가 보이는 범위가 된다.
    expect(mockBackdrop()).toEqual([false, false, false]);
    expect(roomBounds()).toBe(status().boundsWorld);
    // World 경계: Three (5, −0.05, −5) 판 → World X·Y 0..10, Z −0.1..0.
    const bounds = status().boundsWorld!;
    expect(bounds.min.map((v) => +v.toFixed(6))).toEqual([0, 0, -0.1]);
    expect(bounds.max.map((v) => +v.toFixed(6))).toEqual([10, 10, 0]);

    const hits: THREE.Intersection[] = [];
    const ray = new THREE.Raycaster(new THREE.Vector3(5, 5, -5), new THREE.Vector3(0, -1, 0));
    a.mesh.raycast(ray, hits);
    expect(hits).toHaveLength(0);
  });

  it('확정 전 CANDIDATE 자산도 보이지만 버전 키로 캐시하지 않는다', async () => {
    await mount();
    await setInput(
      committed({
        scene_version: 'scene-preview-1',
        state: 'CANDIDATE',
        committed_at_ms: null,
        compatibility: undefined,
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cacheVersion).toBeUndefined();
    const a = asset();
    await settle(calls[0]!, a.root);

    expect(find('scene-background:scene-preview-1')).toBe(a.root);
    expect(status()).toMatchObject({ phase: 'LOADED', state: 'CANDIDATE', display: 'DIMMED' });
    expect(floor().visible).toBe(false);
  });

  it('큰 보정 변화의 서버 판정은 자산 재적재 없이 원래 재질을 유지한다', async () => {
    world();
    await mount();
    await setInput(committed());
    const a = asset();
    await settle(calls[0]!, a.root);
    await setInput(
      committed({
        compatibility: {
          scene_version: 'scene-demo-1',
          calibration_version: 'cal-demo',
          verification: 'DIMMED',
          regeneration_required: true,
          reason: 'LARGE_CHANGE',
          max_center_delta_m: 0.12,
          max_rotation_delta_rad: 0.01,
        },
      }),
    );
    expect(calls).toHaveLength(1);
    expect(a.root.visible).toBe(true);
    expect(floor().visible).toBe(false);
    expect(status()).toMatchObject({
      verification: 'DIMMED',
      display: 'DIMMED',
      regenerationRequired: true,
    });
    expect((a.mesh.material as THREE.Material).opacity).toBe(1);
  });

  it('World 버전이 바뀌어 어긋나면 배경을 숨기고 기본 바닥을 되돌린다', async () => {
    world();
    await mount();
    await setInput(committed());
    const a = asset();
    await settle(calls[0]!, a.root);
    expect(floor().visible).toBe(false);

    await act(async () => world({ scene_version: 'scene-demo-2' }));
    expect(a.root.visible).toBe(false);
    expect(floor().visible).toBe(true);
    // 장면이 숨겨지면 목업 격자·바닥·벽 경계가 돌아오고 보이는 스캔 범위도 비워진다.
    expect(mockBackdrop()).toEqual([true, true, true]);
    expect(roomBounds()).toBeNull();
    expect(status()).toMatchObject({
      verification: 'MISMATCH',
      display: 'HIDDEN',
      mismatches: ['world.scene_version=scene-demo-2'],
    });
  });

  it('DEFAULT·World 없음은 원래 재질로 보인다', async () => {
    await mount();
    await setInput(
      committed({
        scene_version: 'scene-default',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
      }),
    );
    const a = asset();
    await settle(calls[0]!, a.root);
    const material = a.mesh.material as THREE.Material;
    expect(a.root.visible).toBe(true);
    expect([material.transparent, material.opacity]).toEqual([false, 1]);
    expect(status()).toMatchObject({ verification: 'DEFAULT_UNVERIFIED', display: 'DIMMED' });
    expect(floor().visible).toBe(false);
    // 원래 재질로 보여도 스캔이 보이는 중이라 목업 바탕은 숨고 스캔 범위를 쓴다.
    expect(mockBackdrop()).toEqual([false, false, false]);
    expect(roomBounds()).toBe(status().boundsWorld);

    // COMMITTED 라도 비교할 World 가 없으면 원래 재질로 보이고 World 가 맞아도 유지된다.
    await setInput(committed());
    const b = asset();
    await settle(calls[1]!, b.root);
    const bm = b.mesh.material as THREE.Material;
    expect(status().display).toBe('DIMMED');
    expect(bm.opacity).toBe(1);
    await act(async () => world());
    expect(status().display).toBe('FULL');
    expect([bm.transparent, bm.opacity]).toEqual([false, 1]);
  });

  it('DEFAULT 배경을 원래 재질로 그리고 판정·상태를 유지한다', async () => {
    await mount();
    expect(walls().visible).toBe(true);
    await setInput(
      committed({
        scene_version: 'lobby-recon-preview',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
        committed_at_ms: null,
      }),
    );
    const a = asset();
    await settle(calls[0]!, a.root);
    const material = a.mesh.material as THREE.Material;
    expect([material.transparent, material.opacity]).toEqual([false, 1]);
    expect(status()).toMatchObject({ verification: 'DEFAULT_UNVERIFIED', display: 'DIMMED' });
    expect(walls().visible).toBe(false);

    // 배경을 거두면 DEMO 벽 경계선이 돌아온다.
    await setInput(null);
    expect(status().phase).toBe('NONE');
    expect(walls().visible).toBe(true);
  });

  it('DEFAULT 배경이 보이는 동안 DEMO 벽 경계선은 숨는다', async () => {
    await mount();
    await setInput(
      committed({
        scene_version: 'lobby-recon-preview',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
      }),
    );
    const a = asset();
    await settle(calls[0]!, a.root);
    expect((a.mesh.material as THREE.Material).opacity).toBe(1);
    expect(walls().visible).toBe(false);
  });

  it('스캔이 없으면 목업 격자·바닥·벽 경계를 그대로 보이고 보이는 스캔 범위는 비어 있다', async () => {
    await mount();
    expect(mockBackdrop()).toEqual([true, true, true]);
    expect(roomBounds()).toBeNull();
    await setInput(null);
    expect(mockBackdrop()).toEqual([true, true, true]);
  });

  it('읽는 동안과 읽기에 실패하면 목업 바탕을 유지하고, 성공하면 숨긴다', async () => {
    world();
    await mount();
    await setInput(committed());
    expect(status().phase).toBe('LOADING');
    expect(mockBackdrop()).toEqual([true, true, true]);
    expect(roomBounds()).toBeNull();

    await settle(calls[0]!, asset().root);
    expect(mockBackdrop()).toEqual([false, false, false]);

    await setInput(committed({ scene_version: 'broken', gltf_url: 'https://b.example/x.gltf' }));
    expect(mockBackdrop()).toEqual([true, true, true]);
    await fail(calls[1]!, new SyntaxError('Unexpected token'));
    expect(status().phase).toBe('FAILED');
    expect(mockBackdrop()).toEqual([true, true, true]);
    expect(roomBounds()).toBeNull();
  });

  it('스캔이 보여도 범위로 쓸 수 없으면(한 변 50m 초과) 목업 바탕과 범위가 같이 목업 교실로 돌아간다', async () => {
    world();
    await mount();
    await setInput(committed());
    await settle(calls[0]!, asset(80).root);
    expect(status()).toMatchObject({ phase: 'LOADED', display: 'FULL' });
    expect(find('scene-background:scene-demo-1')!.visible).toBe(true);
    expect(roomBounds()).toBeNull();
    expect(mockBackdrop()).toEqual([true, true, true]);
  });

  it('스캔이 내려가면(언마운트) 보이는 스캔 범위가 비워진다', async () => {
    world();
    await mount();
    await setInput(committed());
    await settle(calls[0]!, asset().root);
    expect(roomBounds()).not.toBeNull();

    await act(async () => root?.unmount());
    root = null;
    expect(roomBounds()).toBeNull();
  });

  it('늦게 끝난 이전 Scene 읽기는 버리고 해제한다', async () => {
    world();
    await mount();
    await setInput(
      committed({ scene_version: 'scene-old', gltf_url: 'https://b.example/old.glb' }),
    );
    await setInput(committed());
    expect(calls).toHaveLength(2);
    const late = asset();
    await settle(calls[0]!, late.root);
    expect(late.disposed).toHaveBeenCalled();
    expect(find('scene-background:scene-old')).toBeNull();
    const cur = asset();
    await settle(calls[1]!, cur.root);
    expect(find('scene-background:scene-demo-1')).toBe(cur.root);
  });

  it('새 scene_version 이면 이전 자산을 해제하고, 서명 주소만 바뀌면 다시 읽지 않는다', async () => {
    world();
    await mount();
    await setInput(committed());
    const a = asset();
    await settle(calls[0]!, a.root);

    await setInput(committed({ gltf_url: 'https://bucket.example/scene-demo-1.glb?sig=2' }));
    expect(calls).toHaveLength(1);
    expect(a.disposed).not.toHaveBeenCalled();
    expect(find('scene-background:scene-demo-1')).toBe(a.root);

    await setInput(
      committed({ scene_version: 'scene-demo-2', gltf_url: 'https://b.example/2.glb' }),
    );
    expect(calls).toHaveLength(2);
    expect(a.disposed).toHaveBeenCalled();
    expect(find('scene-background:scene-demo-1')).toBeNull();
    expect(floor().visible).toBe(true);
  });

  it('403 은 EXPIRED 로 다시 받기를 요청하고, 같은 Scene 의 새 주소로 다시 읽는다', async () => {
    world();
    await mount();
    await setInput(committed());
    await fail(calls[0]!, Object.assign(new Error('fetch'), { response: { status: 403 } }));
    expect(status()).toMatchObject({ phase: 'EXPIRED', needsRefetch: true, reason: 'HTTP 403' });
    expect(floor().visible).toBe(true);

    await setInput(committed({ gltf_url: 'https://bucket.example/scene-demo-1.glb?sig=2' }));
    expect(calls).toHaveLength(2);
    await settle(calls[1]!, asset().root);
    expect(status()).toMatchObject({ phase: 'LOADED', needsRefetch: false, display: 'FULL' });
  });

  it('만료 시각이 지난 주소는 읽지 않는다', async () => {
    await mount();
    await setInput(committed({ gltf_expires_at_ms: Date.now() - 1 }));
    expect(calls).toHaveLength(0);
    expect(status()).toMatchObject({ phase: 'EXPIRED', needsRefetch: true });
  });

  it('404·손상·빈 자산은 FAILED 이고 기본 바닥을 유지한다', async () => {
    world();
    await mount();
    await setInput(committed());
    await fail(calls[0]!, Object.assign(new Error('fetch'), { response: { status: 404 } }));
    expect(status()).toMatchObject({ phase: 'FAILED', reason: 'HTTP 404', needsRefetch: false });

    await setInput(committed({ scene_version: 'broken', gltf_url: 'https://b.example/x.gltf' }));
    await fail(calls[1]!, new SyntaxError('Unexpected token'));
    expect(status()).toMatchObject({ phase: 'FAILED', reason: '자산을 읽지 못했다(형식 오류 등)' });

    await setInput(committed({ scene_version: 'empty', gltf_url: 'https://b.example/e.gltf' }));
    await settle(calls[2]!, new THREE.Group());
    expect(status()).toMatchObject({ phase: 'FAILED', reason: '빈 자산이다' });
    expect(floor().visible).toBe(true);
  });

  it('입력을 거두거나 내려가면 자산을 해제한다', async () => {
    world();
    await mount();
    await setInput(committed());
    const a = asset();
    await settle(calls[0]!, a.root);
    await setInput(null);
    expect(a.disposed).toHaveBeenCalled();
    expect(status().phase).toBe('NONE');
    expect(floor().visible).toBe(true);

    await setInput(committed());
    const b = asset();
    await settle(calls[1]!, b.root);
    await act(async () => root?.unmount());
    root = null;
    expect(b.disposed).toHaveBeenCalled();
  });
});

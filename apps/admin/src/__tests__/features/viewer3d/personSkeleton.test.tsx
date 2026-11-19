import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  CROWD_PELVIS_ID,
  crowdTrackId,
  scenarioTick,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import { advance, createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import type { InstancedMesh, Material, Object3D, Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 에는 WebGL 이 없다. 그리기만 하는 가짜 renderer 로 실제 PersonLayer 의 장면 트리·인스턴스 수·재질을 본다.
// 픽셀·광선 선택·FPS 는 격리 WebGL 브라우저에서 따로 잰다.
extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

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

const T0 = 1_760_342_400_000;
let scene: Scene | null = null;
let clockOf: (() => number) | null = null;
function SceneProbe() {
  const current = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  useEffect(() => {
    scene = current;
    clockOf = () => get().clock.elapsedTime;
  }, [current, get]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let viewer: ViewerStore;
let data: SpatialDataStore;

async function mount(strict = false) {
  const canvas = document.createElement('canvas');
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  const tree = (
    <ViewerStoreContext value={viewer}>
      <SpatialDataContext value={data}>
        <SceneProbe />
        <PersonLayer />
      </SpatialDataContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

/** crowd 를 tick 까지 받고 프레임을 몇 번 돌린다(useFrame 이 새 표본을 반영). */
async function play(tick: number) {
  await act(async () => {
    for (const out of scenarioTick('crowd', tick, T0)) {
      if (out.type === 'message') data.getState().ingest(out.raw, Date.now());
    }
  });
  await frames();
}
async function frames(n = 3) {
  for (let i = 0; i < n; i++) await act(async () => advance(performance.now() + i * 16));
}

const avatar = (id: string) => scene!.getObjectByName('person-avatar:' + id)!;
const skeletons = () => {
  let n = 0;
  scene!.traverse((o) => {
    if (o.name === 'person-skeleton') n++;
  });
  return n;
};
function instances(node: Object3D) {
  const meshes: InstancedMesh[] = [];
  node.traverse((o) => {
    if ((o as InstancedMesh).isInstancedMesh) meshes.push(o as InstancedMesh);
  });
  return meshes;
}
const total = (node: Object3D) => instances(node).reduce((sum, m) => sum + m.count, 0);
const opacities = (node: Object3D) => instances(node).map((m) => (m.material as Material).opacity);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore();
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:crowd');
  data.getState().setConnection({ state: 'OPEN', at: Date.now() });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('PersonLayer Tier 0 골격 아바타(-56)', () => {
  it('12명 중 골격이 있는 10명은 골격으로, 예측·확인 불가 2명은 기본 캡슐로 그리고, 모두 선택 대상이다', async () => {
    await mount();
    await play(3);
    expect(skeletons()).toBe(10);
    // 온전한 사람: 막대 14 + 발 막대 2 + 관절 구 13 인스턴스.
    expect(total(avatar(crowdTrackId(0)))).toBe(29);
    for (const id of [crowdTrackId(10), crowdTrackId(11)]) {
      expect(avatar(id).getObjectByName('person-skeleton')).toBeUndefined();
    }
    for (let i = 0; i < 12; i++) {
      expect(viewer.getState().targets.has('person:' + crowdTrackId(i))).toBe(true);
    }
  });

  it('확인된 접지점에는 접지 표식을 두고, 골반만 있는 사람에게는 두지 않는다', async () => {
    await mount();
    await play(3);
    expect(avatar(crowdTrackId(0)).getObjectByName('ground-anchor')).toBeDefined();
    expect(avatar(CROWD_PELVIS_ID).getObjectByName('ground-anchor')).toBeUndefined();
    expect(avatar(CROWD_PELVIS_ID).getObjectByName('ground-anchor-uncertain')).toBeUndefined();
  });

  it('루트가 보간되며 따라가는 동안에도 접지 고리는 이번 표본의 접지점(World) 위치에 있다', async () => {
    await mount();
    await play(3);
    // 다음 표본을 받고 아주 짧은 프레임 하나만 돌린다(루트는 아직 목표에 닿지 않는다).
    await act(async () => {
      for (const out of scenarioTick('crowd', 4, T0)) {
        if (out.type === 'message') data.getState().ingest(out.raw, Date.now());
      }
    });
    await act(async () => advance(clockOf!() + 0.016));
    scene!.updateMatrixWorld(true);
    const node = avatar(crowdTrackId(0));
    const world = scenarioWorld('crowd', 4, T0) as unknown as {
      payload: { tracks: { world_id: string; ground_anchor_xyz: [number, number, number] }[] };
    };
    const [x, y, z] = world.payload.tracks.find(
      (t) => t.world_id === crowdTrackId(0),
    )!.ground_anchor_xyz;
    const expected = worldToThree(worldPoint(x, y, z));
    const round = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n * 1e4) / 1e4 + 0);
    const rootAt = node.getWorldPosition(new THREE.Vector3());
    const ringAt = node.getObjectByName('ground-anchor')!.getWorldPosition(new THREE.Vector3());
    expect(round(rootAt)).not.toEqual(round(new THREE.Vector3(...expected)));
    expect(round(ringAt)).toEqual(
      round(new THREE.Vector3(expected[0], expected[1] + 0.01, expected[2])),
    );
  });

  it('새 표본이 오면 인스턴스 행렬을 바꾸고, 수신이 끊기면 같은 골격을 흐리게 한다(새 관측처럼 보이지 않게)', async () => {
    await mount();
    await play(3);
    const node = avatar(crowdTrackId(0));
    const mesh = instances(node)[0]!;
    const before = Array.from(mesh.instanceMatrix.array.slice(0, 16));
    await play(4);
    expect(Array.from(mesh.instanceMatrix.array.slice(0, 16))).not.toEqual(before);
    expect(Math.max(...opacities(node))).toBe(1);

    await act(async () => data.getState().setConnection({ state: 'CLOSED', at: Date.now() }));
    await frames();
    expect(Math.max(...opacities(avatar(crowdTrackId(0))))).toBe(0.5);
  });

  it('골격이 빠지면 같은 사람이 기본 캡슐로 바뀌고, 다시 오면 골격으로 돌아온다', async () => {
    await mount();
    await play(3);
    const world = scenarioWorld('crowd', 4, T0) as {
      payload: { tracks: { world_id: string; skeleton?: unknown }[] };
    };
    const target = world.payload.tracks.find((t) => t.world_id === crowdTrackId(0))!;
    delete target.skeleton;
    await act(async () => data.getState().ingest(world, Date.now()));
    await frames();
    expect(avatar(crowdTrackId(0)).getObjectByName('person-skeleton')).toBeUndefined();
    expect(skeletons()).toBe(9);
    await play(5);
    expect(skeletons()).toBe(10);
  });

  it('StrictMode 이중 마운트와 해제에도 골격이 하나씩만 있고, 공유 형상은 사람마다 새로 만들지 않는다', async () => {
    await mount(true);
    await play(3);
    expect(skeletons()).toBe(10);
    const geometries = new Set<unknown>();
    scene!.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) geometries.add((o as InstancedMesh).geometry);
    });
    expect(geometries.size).toBe(2);
    await act(async () => root!.unmount());
    root = null;
  });
});

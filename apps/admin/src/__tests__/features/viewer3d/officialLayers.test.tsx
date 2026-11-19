import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  DEMO_STATIC_OBJECTS_BE_V1,
  DEMO_ZONES_BE_V1,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import { RiskScope } from '@/features/viewer3d/risk/RiskScope';
import { WorkSurfaceLayer } from '@/features/viewer3d/surfaces/WorkSurfaceLayer';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, useEffect } from 'react';
import type { Mesh, Object3D, Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -234 장면: BE 정식 다각형·바닥 판정 구역 표현과 레이어 값(hidden·visible·interactive). 픽셀·실제 광선은 WebGL 브라우저에서 본다.

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

let scene: Scene | null = null;
function Probe() {
  const current = useThree((s) => s.scene);
  useEffect(() => {
    scene = current;
  }, [current]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let viewer: ViewerStore;
let data: SpatialDataStore;

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
      <ViewerStoreContext value={viewer}>
        <SpatialDataContext value={data}>
          <Probe />
          <RiskScope>
            <ZoneLayer />
          </RiskScope>
          <WorkSurfaceLayer />
        </SpatialDataContext>
      </ViewerStoreContext>,
    ),
  );
}

const named = (name: string) => scene?.getObjectByName(name) ?? null;
const keys = (prefix: string) =>
  [...viewer.getState().targets.keys()].filter((k) => k.startsWith(prefix)).sort();
const hasClick = (object: Object3D | null) =>
  typeof (object as unknown as { __r3f?: { handlers?: { onClick?: unknown } } })?.__r3f?.handlers
    ?.onClick === 'function';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore();
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('s');
  data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_BE_V1) }, 1);
  data
    .getState()
    .ingestWorkSurfaces({ ok: true, raw: structuredClone(DEMO_STATIC_OBJECTS_BE_V1) }, 1);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  scene = null;
  vi.restoreAllMocks();
});

describe('정식 구역 장면', () => {
  it('BOX 는 상자, PRISM·FOOTPRINT 는 다각형으로 그리고 둘레 상자를 만들지 않는다', async () => {
    await mount();
    expect(keys('zone:')).toEqual(['zone:z-01', 'zone:z-02', 'zone:z-03', 'zone:z-04']);
    expect(named('zone-box:z-01')).not.toBeNull();
    for (const id of ['z-02', 'z-03', 'z-04']) {
      expect(named(`zone-box:${id}`)).toBeNull();
      expect(named(`zone-polygon:${id}`)).not.toBeNull();
    }
  });

  it('L자 공중 구역은 꼭짓점 6개를 World Z 1.2~2.4 에 그대로 세운다(World→Three 한 번)', async () => {
    await mount();
    const mesh = named('zone-polygon:z-03') as Mesh;
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBe(12);
    const at = (i: number) =>
      [position.getX(i), position.getY(i), position.getZ(i)].map((v) => +v.toFixed(6));
    // 아랫면 첫 꼭짓점 World (4.5, 7.5, 1.2) → Three (4.5, 1.2, -7.5), 윗면 (6.5, 9, 2.4) → (6.5, 2.4, -9)
    expect(at(0)).toEqual([4.5, 1.2, -7.5]);
    expect(at(6 + 2)).toEqual([6.5, 2.4, -9]);
    // 삼각형: 아랫·윗면 (6-2)×2 + 옆면 6×2 = 20 개
    expect(mesh.geometry.getIndex()!.count / 3).toBe(20);
  });

  it('바닥 판정 구역은 바닥 위 한 겹(높이 없음)이다', async () => {
    await mount();
    const mesh = named('zone-polygon:z-02') as Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.y - box.min.y).toBe(0);
    expect(box.min.y).toBeCloseTo(0.01, 6);
  });
});

describe('구역 이름표 위치', () => {
  /** 구역 하나의 이름표(스프라이트) World→Three 좌표. */
  const labelAt = (zoneId: string) => {
    const sprites: THREE.Sprite[] = [];
    named(`zone-entry:${zoneId}`)!.traverse((node) => {
      if (node instanceof THREE.Sprite) sprites.push(node);
    });
    expect(sprites).toHaveLength(1);
    return sprites[0]!
      .getWorldPosition(new THREE.Vector3())
      .toArray()
      .map((v) => +v.toFixed(6));
  };

  it('상자와 기둥은 앞쪽 모서리의 윗면 높이 위에, 바닥 판정은 바닥 위에 둔다', async () => {
    await mount();
    // 이름표 중심은 모서리에서 0.2m(이름표 높이 0.3m 의 절반 + 0.05m) 위다.
    // 상자 z-01: 앞 모서리 World (1.5, 5.5), 윗면 2m → Three (1.5, 2.2, -5.5)
    expect(labelAt('z-01')).toEqual([1.5, 2.2, -5.5]);
    // 기둥 z-03: 앞 꼭짓점 World (4.5, 7.5), 윗면 2.4m → Three (4.5, 2.6, -7.5)
    expect(labelAt('z-03')).toEqual([4.5, 2.6, -7.5]);
    // 바닥 판정 z-02: 앞 꼭짓점 World (6.5, 1), 바닥 0m → Three (6.5, 0.2, -1)
    expect(labelAt('z-02')).toEqual([6.5, 0.2, -1]);
  });
});

describe('레이어 값', () => {
  it('hidden 은 그리지 않고 대상에서 내려 선택을 푼다. 다시 켜면 돌아온다', async () => {
    await mount();
    act(() => {
      viewer.getState().select({ type: 'zone', id: 'z-01' });
    });
    act(() => viewer.getState().setLayers({ zones: 'hidden' }));
    expect(named('zone-layer')).toBeNull();
    expect(keys('zone:')).toEqual([]);
    expect(viewer.getState().selected).toBeNull();
    act(() => viewer.getState().setLayers({}));
    expect(keys('zone:')).toHaveLength(4);
  });

  it('visible 은 그리고 명령으로 고를 수 있지만 클릭 처리기는 없다', async () => {
    await mount();
    expect(hasClick(named('zone:z-01'))).toBe(true);
    act(() => viewer.getState().setLayers({ zones: 'visible', obstacles: 'visible' }));
    expect(named('zone-box:z-01')).not.toBeNull();
    expect(hasClick(named('zone:z-01'))).toBe(false);
    expect(hasClick(named('object:so-cabinet'))).toBe(false);
    expect(hasClick(named('object:desk-1'))).toBe(true);
    expect(viewer.getState().select({ type: 'zone', id: 'z-03' })).toEqual({ ok: true });
  });

  it('작업면·장애물 레이어는 따로 끈다', async () => {
    await mount();
    expect(keys('object:')).toEqual([
      'object:desk-1',
      'object:desk-2',
      'object:podium-1',
      'object:so-cabinet',
      'object:so-projector',
    ]);
    act(() => viewer.getState().setLayers({ workSurfaces: 'hidden' }));
    expect(keys('object:')).toEqual(['object:so-cabinet', 'object:so-projector']);
    act(() => viewer.getState().setLayers({ obstacles: 'hidden' }));
    expect(keys('object:')).toEqual(['object:desk-1', 'object:desk-2', 'object:podium-1']);
  });
});

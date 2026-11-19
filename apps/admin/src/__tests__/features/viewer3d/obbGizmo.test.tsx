import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { DEMO_WORK_SURFACES } from '@/features/viewer3d/dev-harness/scenarios';
import type { WorldObb } from '@/features/viewer3d/editing/editGeometry';
import {
  createEditStore,
  OBJECT_EDIT_HANDLES,
  type ObjectEditHandle,
} from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import {
  createObjectHandleDrag,
  ObbGizmoController,
  objectHandleWorld,
  objectPreviewLabel,
} from '@/features/viewer3d/editing/ObbGizmo';
import { obbWorkSurface, surfaceTopEdge } from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { WorkSurfaceLayer } from '@/features/viewer3d/surfaces/WorkSurfaceLayer';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import {
  createRoot,
  extend,
  useThree,
  type ReconcilerRoot,
  type RootState,
} from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import * as THREE from 'three';
import { PerspectiveCamera, Vector3, type Object3D, type Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -188 작업면 OBB 조작기. 실제 원근 카메라 투영으로 화면 좌표를 만들어 창 포인터 이벤트로 끌고 World 결과를 본다.
// 픽셀·실제 광선 피킹은 격리 WebGL 브라우저에서 따로 확인한다.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const DESK1 = { type: 'object', id: 'desk-1' } as const;
const PODIUM = { type: 'object', id: 'podium-1' } as const;
const RECT = { left: 0, top: 0, width: 800, height: 600 };

let viewer: ViewerStore;
let data: SpatialDataStore;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  data.getState().ingestWorkSurfaces({ ok: true, raw: structuredClone(DEMO_WORK_SURFACES) }, T0);
  edit = createEditStore(viewer, data);
  off = edit.connect();
});
afterEach(() => {
  off();
  vi.restoreAllMocks();
});

function placeCamera(camera: PerspectiveCamera) {
  camera.position.set(2.4, 6, 2.5);
  camera.lookAt(2.4, 0.4, -3.6);
  camera.updateMatrixWorld();
}

function rig() {
  const camera = new PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 500);
  placeCamera(camera);
  const canvas = { getBoundingClientRect: () => RECT } as unknown as HTMLCanvasElement;
  const controls = { enabled: true };
  const state = { camera, gl: { domElement: canvas }, controls } as unknown as RootState;
  return { camera, controls, drag: createObjectHandleDrag(edit.store, () => state) };
}

function screen(camera: PerspectiveCamera, point: WorldPoint) {
  const p = new Vector3(...worldToThree(point)).project(camera);
  return { clientX: ((p.x + 1) / 2) * RECT.width, clientY: ((1 - p.y) / 2) * RECT.height };
}

const draft = (): WorldObb => edit.store.getState().objectSession!.draft;

function press(
  drag: ReturnType<typeof rig>['drag'],
  camera: PerspectiveCamera,
  handle: ObjectEditHandle,
) {
  const at = screen(camera, objectHandleWorld(draft(), handle));
  drag.start(handle, { stopPropagation: vi.fn(), button: 0, nativeEvent: at } as never);
}
const moveTo = (camera: PerspectiveCamera, point: WorldPoint) =>
  window.dispatchEvent(new MouseEvent('pointermove', { ...screen(camera, point), buttons: 1 }));
const release = () => window.dispatchEvent(new MouseEvent('pointerup'));
const shift = (p: WorldPoint, dx: number, dy: number, dz: number) =>
  worldPoint(p[0] + dx, p[1] + dy, p[2] + dz);

function begin() {
  viewer.getState().registerTarget(DESK1);
  expect(edit.store.getState().begin(DESK1)).toEqual({ ok: true });
}

describe('작업면 손잡이 끌기(World)', () => {
  it('이동: X·Y 만 옮기고 크기·상판·yaw 는 그대로, 끄는 동안 카메라 조작을 끄고 놓으면 되돌린다', () => {
    begin();
    const { camera, controls, drag } = rig();
    const start = objectHandleWorld(draft(), 'move');
    press(drag, camera, 'move');
    expect(controls.enabled).toBe(false);
    moveTo(camera, shift(start, 0.5, -0.3, 0));
    release();
    expect(controls.enabled).toBe(true);
    const d = draft();
    expect(d.center[0]).toBeCloseTo(2.9, 6);
    expect(d.center[1]).toBeCloseTo(3.3, 6);
    expect(d.center[2]).toBe(0.37);
    expect([...d.size, d.yaw]).toEqual([1.2, 0.6, 0.74, 0.5236]);
  });

  it('회전: 중심을 축으로 포인터를 +0.5 rad 돌리면 yaw 가 0.5 rad 늘고 중심·크기는 그대로다', () => {
    begin();
    const { camera, drag } = rig();
    const from = draft();
    const handle = objectHandleWorld(from, 'yaw');
    const [rx, ry] = [handle[0] - from.center[0], handle[1] - from.center[1]];
    const [c, s] = [Math.cos(0.5), Math.sin(0.5)];
    press(drag, camera, 'yaw');
    moveTo(
      camera,
      worldPoint(from.center[0] + rx * c - ry * s, from.center[1] + rx * s + ry * c, handle[2]),
    );
    release();
    expect(draft().yaw).toBeCloseTo(1.0236, 5);
    expect(draft().center).toEqual(from.center);
    expect(draft().size).toEqual(from.size);
  });

  it("X'+ 면: 회전된 지역 축으로만 늘고 반대 면 꼭짓점은 그대로다", () => {
    begin();
    const { camera, drag } = rig();
    const from = draft();
    const start = objectHandleWorld(from, 'x+');
    const [c, s] = [Math.cos(from.yaw), Math.sin(from.yaw)];
    press(drag, camera, 'x+');
    // 지역 X' 로 0.3m, 지역 Y' 로 0.2m 끈다. Y' 성분은 이 면에 영향이 없다.
    moveTo(camera, shift(start, 0.3 * c - 0.2 * s, 0.3 * s + 0.2 * c, 0));
    release();
    expect(draft().size[0]).toBeCloseTo(1.5, 5);
    expect(draft().size[1]).toBe(0.6);
    const [before, after] = [
      surfaceTopEdge(obbWorkSurface(from)),
      surfaceTopEdge(obbWorkSurface(draft())),
    ];
    for (const i of [0, 3]) {
      expect(after[i]![0]).toBeCloseTo(before[i]![0], 5);
      expect(after[i]![1]).toBeCloseTo(before[i]![1], 5);
    }
  });

  it('상판: 위로 0.2m 끌면 상판만 오르고 바닥(Z=0)은 그대로다', () => {
    begin();
    const { camera, drag } = rig();
    const start = objectHandleWorld(draft(), 'z+');
    press(drag, camera, 'z+');
    moveTo(camera, shift(start, 0, 0, 0.2));
    release();
    const d = draft();
    expect(d.center[2] + d.size[2] / 2).toBeCloseTo(0.94, 5);
    expect(d.center[2] - d.size[2] / 2).toBeCloseTo(0, 9);
    expect([d.center[0], d.center[1], d.yaw]).toEqual([2.4, 3.6, 0.5236]);
  });

  it('Esc: 끄는 중이면 그 끌기만 되돌리고, 아니면 편집을 취소한다. Enter 는 World 결과로 끝낸다', () => {
    begin();
    const { camera, controls, drag } = rig();
    const from = draft();
    press(drag, camera, 'move');
    moveTo(camera, shift(objectHandleWorld(from, 'move'), 1, 0, 0));
    drag.escape();
    expect(controls.enabled).toBe(true);
    expect(draft()).toEqual(from);
    expect(edit.store.getState().objectSession).not.toBeNull();
    drag.enter();
    expect(edit.store.getState().lastObjectResult).toMatchObject({
      status: 'FINISHED',
      changed: false,
      saved: false,
    });
    begin();
    drag.escape();
    expect(edit.store.getState().lastObjectResult).toMatchObject({
      status: 'CANCELLED',
      reason: 'USER',
    });
  });
});

// ---- 장면: WorkSurfaceLayer + ObbGizmoController ----

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
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    scene = current;
    placeCamera(camera as PerspectiveCamera);
  }, [current, camera]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
async function mount() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    ...RECT,
    x: 0,
    y: 0,
    right: 800,
    bottom: 600,
    toJSON: () => RECT,
  });
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <StrictMode>
        <ViewerStoreContext value={viewer}>
          <SpatialDataContext value={data}>
            <EditStoreContext value={edit.store}>
              <Probe />
              <WorkSurfaceLayer />
              <ObbGizmoController />
            </EditStoreContext>
          </SpatialDataContext>
        </ViewerStoreContext>
      </StrictMode>,
    ),
  );
}

const named = (prefix: string) => {
  const out: Object3D[] = [];
  scene?.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};

type Handler = (event: unknown) => void;
const onClickOf = (object: Object3D) =>
  (object as unknown as { __r3f: { handlers: { onClick: Handler } } }).__r3f.handlers.onClick;

describe('초안 이름표', () => {
  const obb: WorldObb = { center: worldPoint(1, 2, 0.5), size: [1, 2, 1], yaw: 0 };

  it('작업면·정적 객체는 ID 를 적지 않고, 계획 가상 객체만 ID 를 적는다', () => {
    expect(objectPreviewLabel('desk-1', obb)).toBe('미저장 · 상판 1.00m · 0.0°');
    expect(objectPreviewLabel('desk-1', obb, true)).toBe('새 작업면 · 미등록 · 상판 1.00m · 0.0°');
    expect(objectPreviewLabel('so-1', obb, false, 'OBSTACLE')).toBe(
      '정적 객체 · 미저장 · Z 0.00~1.00m · 0.0°',
    );
    expect(objectPreviewLabel('pl-1', obb, false, 'PLANNED')).toBe(
      'pl-1 · 계획(PLANNED) 가상 객체 · 미저장 · Z 0.00~1.00m · 0.0°',
    );
  });
});

describe('WorkSurfaceLayer·ObbGizmo 장면', () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
  });

  it('유효 작업면 3개를 object 대상으로 등록하고 상자 중심·회전이 World OBB 와 같다', async () => {
    await mount();
    expect(
      named('surface-box:')
        .map((o) => o.name)
        .sort(),
    ).toEqual(['surface-box:desk-1', 'surface-box:desk-2', 'surface-box:podium-1']);
    expect([...viewer.getState().targets.keys()].sort()).toEqual([
      'object:desk-1',
      'object:desk-2',
      'object:podium-1',
    ]);
    const box = named('surface-box:desk-1')[0]!;
    box.updateWorldMatrix(true, false);
    const center = box.getWorldPosition(new Vector3()).toArray();
    worldToThree(worldPoint(2.4, 3.6, 0.37)).forEach((v, i) => expect(center[i]).toBeCloseTo(v, 9));
    expect(box.parent!.rotation.y).toBe(0.5236);
    expect(named('surface-top-edge:')).toHaveLength(3);
  });

  it('작업면에는 이름표(Sprite)를 달지 않는다', async () => {
    await mount();
    let sprites = 0;
    scene!.traverse((o) => {
      if (o instanceof THREE.Sprite) sprites += 1;
    });
    expect(sprites).toBe(0);
  });

  it('작업면 클릭은 그 object 를 선택한다. 거부된 묶음이면 아무것도 그리지 않는다', async () => {
    await mount();
    const group = named('object:desk-1')[0]!;
    await act(async () =>
      onClickOf(group)({
        delta: 0,
        stopPropagation: () => {},
        intersections: [],
        nativeEvent: { detail: 1 },
      }),
    );
    expect(viewer.getState().selected).toEqual(DESK1);
    // 작업면 위·안의 사람이 광선에 있으면 사람을 고른다(단상 위 작업자 선택을 가리지 않는다).
    act(() => viewer.getState().registerTarget({ type: 'person', id: 'w-0001' }));
    await act(async () =>
      onClickOf(group)({
        delta: 0,
        stopPropagation: () => {},
        intersections: [
          { eventObject: { name: 'object:desk-1' } },
          { eventObject: { name: 'person:w-0001' } },
        ],
        nativeEvent: { detail: 1 },
      }),
    );
    expect(viewer.getState().selected).toEqual({ type: 'person', id: 'w-0001' });
    await act(async () =>
      data.getState().ingestWorkSurfaces({ ok: false, reason: 'HTTP 503' }, T0 + 1),
    );
    expect(named('surface-box:')).toHaveLength(0);
    expect([...viewer.getState().targets.keys()]).toEqual(['person:w-0001']);
  });

  it('편집 중인 선택 작업면 하나에만 손잡이 7개를 붙이고 원본 상자는 남긴다. 선택이 바뀌면 내린다', async () => {
    await mount();
    expect(named('object-edit-gizmo')).toHaveLength(0);
    await act(async () => void edit.store.getState().begin(DESK1));
    expect(named('object-edit-gizmo')).toHaveLength(1);
    expect(
      named('object-edit-handle:')
        .map((o) => o.name.slice(19))
        .sort(),
    ).toEqual([...OBJECT_EDIT_HANDLES].sort());
    const yaw = named('object-edit-handle:yaw')[0]!.getWorldPosition(new Vector3()).toArray();
    worldToThree(objectHandleWorld(draft(), 'yaw')).forEach((v, i) =>
      expect(yaw[i]).toBeCloseTo(v, 9),
    );
    expect(named('surface-box:desk-1')).toHaveLength(1);
    await act(async () => void viewer.getState().select(PODIUM));
    expect(named('object-edit-gizmo')).toHaveLength(0);
    expect(edit.store.getState().lastObjectResult).toMatchObject({ reason: 'SELECTION_CHANGED' });
  });

  it('새 작업면은 원본 상자 없이 미리보기·손잡이만 그리고, 초점용 object:ID 그룹을 둔다', async () => {
    await mount();
    await act(
      async () =>
        void edit.store.getState().createObject({
          id: 'new-1',
          geometry: { centerXy: [8, 5], sizeXy: [1.2, 0.6], yawRad: 0.4, topHeightM: 0.74 },
        }),
    );
    expect(named('object-edit-handle:')).toHaveLength(7);
    expect(named('surface-box:new-1')).toHaveLength(0);
    const anchor = named('object:new-1')[0]!.getWorldPosition(new Vector3()).toArray();
    worldToThree(worldPoint(8, 5, 0.37)).forEach((v, i) => expect(anchor[i]).toBeCloseTo(v, 9));
    await act(async () => void edit.store.getState().cancelObject('USER'));
    expect(named('object-edit-gizmo')).toHaveLength(0);
    expect(viewer.getState().targets.has('object:new-1')).toBe(false);
  });
});

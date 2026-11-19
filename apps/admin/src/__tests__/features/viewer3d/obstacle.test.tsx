import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { DEMO_OPERATIONAL_GEOMETRY } from '@/features/viewer3d/dev-harness/scenarios';
import type { WorldObb } from '@/features/viewer3d/editing/editGeometry';
import {
  createEditStore,
  OBSTACLE_EDIT_HANDLES,
  type ObjectEditHandle,
} from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import type { ViewerObjectEditResult } from '@/features/viewer3d/editing/editTypes';
import {
  createObjectHandleDrag,
  ObbGizmoController,
  objectHandleWorld,
} from '@/features/viewer3d/editing/ObbGizmo';
import {
  obbObstacle,
  obstacleCorners,
  obstacleItem,
  obstacleObb,
  readObstacle,
  type ObstacleGeometry,
  type ObstacleView,
} from '@/features/viewer3d/surfaces/obstacleGeometry';
import { obstacleEdges } from '@/features/viewer3d/surfaces/ObstacleLayer';
import { adaptWorkSurfaces } from '@/features/viewer3d/surfaces/workSurfaceGeometry';
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

// -274 등록 정적 객체(OBSTACLE) OBB: BE -58 묶음 형식 검사, World 꼭짓점, 공통 편집 엔진 정책(XYZ 이동·수평 회전·크기),
// 결과 항목(afterItem)·원본 불변·취소·stale, 장면 표시·선택·손잡이. 픽셀·실제 광선 피킹은 격리 WebGL 브라우저 몫이다.

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const CABINET = { type: 'object', id: 'so-cabinet' } as const;
const PROJECTOR = { type: 'object', id: 'so-projector' } as const;
const DESK1 = { type: 'object', id: 'desk-1' } as const;
const near = (actual: readonly number[], expected: readonly number[], digits = 9) =>
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, digits));
const item = (patch: Record<string, unknown> = {}, obb: Record<string, unknown> = {}) => ({
  object_id: 'so-1',
  kind: 'OBSTACLE',
  ...patch,
  obb: { center: [1, 2, 0.5], size: [0.4, 0.6, 1], yaw_rad: 0.2, ...obb },
});
const reasonOf = (raw: unknown) => {
  const checked = readObstacle(raw);
  return 'reason' in checked ? checked.reason : null;
};

describe('정적 객체 묶음 검사(BE -58 static_objects 형식)', () => {
  it('DEMO 묶음: 유효 2개만 받고 크기 0·작업면 ID 와 겹침·작업면 kind 는 이유와 함께 뺀다. 작업면은 그대로다', () => {
    const snapshot = adaptWorkSurfaces(structuredClone(DEMO_OPERATIONAL_GEOMETRY), T0);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.surfaces.map((s) => s.surfaceId)).toEqual(['podium-1', 'desk-1', 'desk-2']);
    expect(snapshot.obstacles.map((o) => o.objectId)).toEqual(['so-cabinet', 'so-projector']);
    expect(snapshot.invalidObstacles).toEqual([
      { objectId: 'so-bad', reason: 'obb.size 는 양수 3개여야 한다' },
      { objectId: 'desk-1', reason: 'object_id 가 작업면 surface_id 와 겹친다' },
      { objectId: 'so-ws', reason: '작업면은 work_surfaces 로 받는다' },
    ]);
    // center 는 3D 중심 그대로다(바닥 기준으로 바꾸지 않는다). 떠 있는 프로젝터는 아랫면이 2.525m 다.
    expect(snapshot.obstacles[1]).toMatchObject({
      objectId: 'so-projector',
      center: [5, 5.5, 2.6],
      size: [0.4, 0.3, 0.15],
      yawRad: 0.3,
    });
  });

  it('BE 가 저장할 때 거부하는 값은 이유와 함께 빼고, 값을 고쳐 맞추지 않는다', () => {
    expect(reasonOf(null)).toBe('항목이 객체가 아니다');
    expect(reasonOf([])).toBe('항목이 객체가 아니다');
    expect(reasonOf(item({ object_id: '' }))).toBe('object_id 가 비었다');
    expect(reasonOf(item({ object_id: 7 }))).toBe('object_id 가 비었다');
    expect(reasonOf(item({ kind: undefined }))).toBe('kind 는 OBSTACLE 이어야 한다');
    expect(reasonOf(item({ kind: 'obstacle' }))).toBe('kind 는 OBSTACLE 이어야 한다');
    expect(reasonOf({ object_id: 'so-1', kind: 'OBSTACLE' })).toBe('obb 가 객체가 아니다');
    expect(reasonOf(item({}, { center: [1, 2] }))).toBe('obb.center 는 유한수 3개여야 한다');
    expect(reasonOf(item({}, { center: [1, 2, Number.NaN] }))).toBe(
      'obb.center 는 유한수 3개여야 한다',
    );
    expect(reasonOf(item({}, { center: [1, 2, '0'] }))).toBe('obb.center 는 유한수 3개여야 한다');
    expect(reasonOf(item({}, { size: [0.4, 0.6, -1] }))).toBe('obb.size 는 양수 3개여야 한다');
    expect(reasonOf(item({}, { size: [0.4, 0.6, Infinity] }))).toBe(
      'obb.size 는 양수 3개여야 한다',
    );
    expect(reasonOf(item({}, { yaw_rad: '0.2' }))).toBe('obb.yaw_rad 가 유한한 수가 아니다');
    expect(reasonOf(item({}, { top_height_sigma_m: -0.01 }))).toBe(
      'obb.top_height_sigma_m 은 0 이상 유한수여야 한다',
    );
    expect(reasonOf(item({ top_height_m: 'x' }))).toBe('top_height_m 은 유한수여야 한다');
  });

  it('yaw_rad 가 없거나 null 이면 0(BE 저장 규칙), 범위 밖이면 같은 방향의 [-π, π] 로 감고 원본 항목은 얼린 사본이다', () => {
    const raw = item({ top_height_m: null, name: '사물함' }, { yaw_rad: null });
    const checked = readObstacle(raw);
    if ('reason' in checked) throw new Error(checked.reason);
    expect(checked.obstacle.yawRad).toBe(0);
    expect(checked.obstacle.name).toBe('사물함');
    expect(Object.isFrozen(checked.obstacle.source)).toBe(true);
    expect(checked.obstacle.source).toEqual(raw);
    expect(checked.obstacle.source).not.toBe(raw);
    const turned = readObstacle(item({}, { yaw_rad: 4 * Math.PI + 0.5 }));
    if ('reason' in turned) throw new Error(turned.reason);
    expect(turned.obstacle.yawRad).toBeCloseTo(0.5, 12);
    const noYaw = item();
    delete (noYaw.obb as Record<string, unknown>).yaw_rad;
    expect(readObstacle(noYaw)).toMatchObject({ obstacle: { yawRad: 0 } });
  });

  it('묶음 규칙: static_objects 가 없으면 0개, 배열이 아니면 묶음 전체 거부, 같은 object_id 는 앞 유효 항목만 쓴다', () => {
    expect(adaptWorkSurfaces({ version: 'g1', work_surfaces: [] }, T0)).toMatchObject({
      status: 'READY',
      obstacles: [],
      invalidObstacles: [],
    });
    expect(adaptWorkSurfaces({ version: 'g1', static_objects: {} }, T0)).toMatchObject({
      status: 'REJECTED',
      reason: 'static_objects 가 배열이 아니다',
      surfaces: [],
      obstacles: [],
    });
    const snapshot = adaptWorkSurfaces(
      {
        static_objects: [
          item({}, { size: [0, 1, 1] }),
          item({}, { center: [3, 3, 1] }),
          item({}, { center: [4, 4, 1] }),
        ],
      },
      T0,
    );
    expect(snapshot.obstacles).toHaveLength(1);
    expect(snapshot.obstacles[0]!.center).toEqual([3, 3, 1]);
    expect(snapshot.invalidObstacles.map((i) => i.reason)).toEqual([
      'obb.size 는 양수 3개여야 한다',
      'object_id 가 겹친다(앞 항목 사용)',
    ]);
  });
});

// 손으로 확인하기 쉬운 90° 회전·바닥에서 1m 뜬 정적 객체. 지역 (u, v) → World (−v, u) + 중심.
const TURNED: ObstacleGeometry = { center: [2, 3, 1.5], size: [2, 1, 1], yawRad: Math.PI / 2 };

describe('정적 객체 형상(World)', () => {
  it('꼭짓점 8개: 아랫면 Z=1 → 윗면 Z=2, 지역 (−,−)→(+,−)→(+,+)→(−,+) 순서로 World 위치·yaw 그대로다', () => {
    const corners = obstacleCorners(TURNED);
    const expected: WorldPoint[] = [
      worldPoint(2.5, 2, 1),
      worldPoint(2.5, 4, 1),
      worldPoint(1.5, 4, 1),
      worldPoint(1.5, 2, 1),
      worldPoint(2.5, 2, 2),
      worldPoint(2.5, 4, 2),
      worldPoint(1.5, 4, 2),
      worldPoint(1.5, 2, 2),
    ];
    expect(corners).toHaveLength(8);
    corners.forEach((corner, i) => near(corner, expected[i]!, 12));
  });

  it('모서리 12개 선분은 World 꼭짓점을 worldToThree 로 옮긴 것이다(상판 가장자리 선은 따로 없다)', () => {
    const view: ObstacleView = { ...TURNED, objectId: 'so-t', name: null, source: {} };
    const edges = obstacleEdges(view);
    expect(edges).toHaveLength(24);
    const three = obstacleCorners(TURNED).map(worldToThree);
    // 첫 변: 아랫면 0→1, 윗면 4→5, 세로 0→4
    expect(edges.slice(0, 6)).toEqual([three[0], three[1], three[4], three[5], three[0], three[4]]);
  });

  it('OBB 변환은 계약 obb 를 그대로 옮긴다(center 는 3D 중심) — 왕복해도 같다', () => {
    const obb = obstacleObb(TURNED);
    expect(obb).toEqual({ center: [2, 3, 1.5], size: [2, 1, 1], yaw: Math.PI / 2 });
    expect(obbObstacle(obb)).toEqual(TURNED);
  });

  it('결과 항목: object_id·kind·obb 형상만 덮어쓰고 원본의 다른 키(obb 안 포함)는 그대로, 원본은 바꾸지 않는다', () => {
    const source = Object.freeze(
      item({ top_height_m: 1.2, name: '사물함' }, { top_height_sigma_m: 0.03 }),
    );
    const copy = structuredClone(source);
    expect(obstacleItem('so-1', TURNED, source)).toEqual({
      object_id: 'so-1',
      kind: 'OBSTACLE',
      top_height_m: 1.2,
      name: '사물함',
      obb: { center: [2, 3, 1.5], size: [2, 1, 1], yaw_rad: Math.PI / 2, top_height_sigma_m: 0.03 },
    });
    expect(source).toEqual(copy);
  });
});

// ---- 편집 세션: 작업면과 같은 Store·엔진·수명 규칙, 정책만 다르다 ----

let viewer: ViewerStore;
let data: SpatialDataStore;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;
const objectResults: ViewerObjectEditResult[] = [];
const ingest = (raw: unknown = structuredClone(DEMO_OPERATIONAL_GEOMETRY), at = T0) =>
  data.getState().ingestWorkSurfaces({ ok: true, raw }, at);
const session = () => edit.store.getState().objectSession!;
const draft = (): WorldObb => session().draft;

function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  ingest();
  edit = createEditStore(viewer, data);
  off = edit.connect();
  objectResults.length = 0;
  edit.store.subscribe((s, p) => {
    if (s.lastObjectResult && s.lastObjectResult !== p.lastObjectResult)
      objectResults.push(s.lastObjectResult);
  });
}
function teardown() {
  off();
  vi.restoreAllMocks();
}
function beginObstacle(target: typeof CABINET | typeof PROJECTOR = PROJECTOR) {
  viewer.getState().registerTarget(target);
  expect(edit.store.getState().begin(target)).toEqual({ ok: true });
}

describe('정적 객체 편집 세션', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('시작하면 OBSTACLE 정책으로 원본 OBB 사본(3D 중심 그대로)을 잡고 선택한다', () => {
    beginObstacle();
    expect(viewer.getState().selected).toEqual(PROJECTOR);
    expect(session().objectKind).toBe('OBSTACLE');
    expect(session().policy.name).toBe('obstacle-obb');
    expect(session().base).toEqual({ center: [5, 5.5, 2.6], size: [0.4, 0.3, 0.15], yaw: 0.3 });
  });

  it('Z 이동·높이·수평 회전·폭을 고친 뒤 완료하면 계약 obb 결과와 afterItem 을 돌려주고 원본 묶음은 그대로다', () => {
    const snapshot = data.getState().workSurfaces;
    const copy = structuredClone(snapshot);
    beginObstacle();
    const edit1 = edit.store.getState();
    expect(edit1.updateObjectField('centerZ', 2.2)).toEqual({ ok: true });
    expect(edit.store.getState().updateObjectField('height', 0.3)).toEqual({ ok: true });
    expect(edit.store.getState().updateObjectField('yaw', -0.4)).toEqual({ ok: true });
    expect(edit.store.getState().updateObjectField('width', 0.6)).toEqual({ ok: true });
    const d = draft();
    near(d.center, [5, 5.5, 2.2], 12);
    near(d.size, [0.6, 0.3, 0.3], 12);
    expect(d.yaw).toBeCloseTo(-0.4, 12);
    const result = edit.store.getState().finishObject();
    if (result?.status !== 'FINISHED' || result.objectKind !== 'OBSTACLE')
      throw new Error('정적 객체 FINISHED 가 아니다');
    expect(result).toMatchObject({
      target: PROJECTOR,
      origin: 'REGISTERED',
      before: { center: [5, 5.5, 2.6], size: [0.4, 0.3, 0.15], yawRad: 0.3 },
      changed: true,
      saved: false,
    });
    near(result.after.center, [5, 5.5, 2.2], 12);
    near(result.after.size, [0.6, 0.3, 0.3], 12);
    expect(Object.keys(result.afterItem).sort()).toEqual(['kind', 'obb', 'object_id']);
    expect(result.afterItem).toMatchObject({ object_id: 'so-projector', kind: 'OBSTACLE' });
    const obb = result.afterItem.obb as Record<string, number[] | number>;
    near(obb.center as number[], [5, 5.5, 2.2], 12);
    expect(obb.yaw_rad).toBeCloseTo(-0.4, 12);
    expect(data.getState().workSurfaces).toBe(snapshot);
    expect(data.getState().workSurfaces).toEqual(copy);
    expect(objectResults).toEqual([result]);
  });

  it('기울임(pitch·roll)은 NOT_EDITABLE 로 거부하고 초안은 그대로다. 크기 0 은 INVALID_GEOMETRY 다', () => {
    beginObstacle();
    const before = draft();
    for (const axis of ['pitch', 'roll'] as const) {
      expect(
        edit.store.getState().previewObject(before, { type: 'rotate', axis, radians: 0.1 }),
      ).toMatchObject({ ok: false, reason: 'NOT_EDITABLE' });
    }
    expect(edit.store.getState().updateObjectField('height', 0)).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(edit.store.getState().updateObjectField('yaw', 90)).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(draft()).toEqual(before);
  });

  it('작업면 정책은 그대로다: 작업면의 Z 이동·높이(아랫면 이동)는 NOT_EDITABLE', () => {
    viewer.getState().registerTarget(DESK1);
    edit.store.getState().begin(DESK1);
    expect(session().objectKind).toBe('WORK_SURFACE');
    expect(edit.store.getState().updateObjectField('centerZ', 1)).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
    expect(edit.store.getState().updateObjectField('height', 1)).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });

  it('취소하면 초안을 버리고 원본 형상으로 CANCELLED 를 알린다', () => {
    beginObstacle(CABINET);
    edit.store.getState().updateObjectField('centerX', 1.4);
    const result = edit.store.getState().cancelObject('USER');
    expect(result).toEqual(
      expect.objectContaining({
        status: 'CANCELLED',
        objectKind: 'OBSTACLE',
        target: CABINET,
        reason: 'USER',
        before: { center: [0.6, 8.8, 0.9], size: [0.5, 1.2, 1.8], yawRad: 0 },
      }),
    );
    expect(edit.store.getState().objectSession).toBeNull();
    expect(data.getState().workSurfaces.obstacles[0]!.center).toEqual([0.6, 8.8, 0.9]);
  });

  it('원본 정적 객체 형상이 바뀌거나 사라지면 STALE_SOURCE 로 끝낸다', () => {
    beginObstacle();
    const changed = structuredClone(DEMO_OPERATIONAL_GEOMETRY);
    changed.static_objects[1]!.obb.center = [5, 5.5, 2.7];
    ingest(changed, T0 + 1);
    expect(objectResults.at(-1)).toMatchObject({
      status: 'REJECTED',
      reason: 'STALE_SOURCE',
      detail: '원본 정적 객체 형상이 바뀌었다',
    });
    beginObstacle();
    const gone = structuredClone(DEMO_OPERATIONAL_GEOMETRY);
    gone.static_objects.splice(1, 1);
    ingest(gone, T0 + 2);
    expect(objectResults.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: '원본 정적 객체가 사라졌다',
    });
  });

  it('REPLAY 에서는 시작하지 않고, 새 작업면 ID 가 정적 객체 ID 와 겹치면 INVALID_TARGET 이다', () => {
    viewer.getState().registerTarget(PROJECTOR);
    viewer.getState().setMode('REPLAY');
    expect(edit.store.getState().begin(PROJECTOR)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    viewer.getState().setMode('LIVE');
    expect(
      edit.store.getState().createObject({
        id: 'so-cabinet',
        geometry: { centerXy: [8, 5], sizeXy: [1, 1], yawRad: 0, topHeightM: 0.7 },
      }),
    ).toEqual({ ok: false, reason: 'INVALID_TARGET' });
  });
});

// ---- 손잡이 끌기(World): 실제 원근 카메라 투영으로 화면 좌표를 만든다 ----

const RECT = { left: 0, top: 0, width: 800, height: 600 };
function placeCamera(camera: PerspectiveCamera) {
  // 떠 있는 프로젝터(World (5, 5.5, 2.6) = Three (5, 2.6, −5.5))를 남쪽 조금 위에서 본다.
  camera.position.set(5, 3.4, -1.5);
  camera.lookAt(5, 2.6, -5.5);
  camera.updateMatrixWorld();
}
function rig() {
  const camera = new PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 500);
  placeCamera(camera);
  const canvas = { getBoundingClientRect: () => RECT } as unknown as HTMLCanvasElement;
  const state = { camera, gl: { domElement: canvas }, controls: { enabled: true } };
  return { camera, drag: createObjectHandleDrag(edit.store, () => state as unknown as RootState) };
}
function screen(camera: PerspectiveCamera, point: WorldPoint) {
  const p = new Vector3(...worldToThree(point)).project(camera);
  return { clientX: ((p.x + 1) / 2) * RECT.width, clientY: ((1 - p.y) / 2) * RECT.height };
}
function dragHandle(handle: ObjectEditHandle, dz: number) {
  const { camera, drag } = rig();
  const start = objectHandleWorld(draft(), handle);
  drag.start(handle, {
    stopPropagation: vi.fn(),
    button: 0,
    nativeEvent: screen(camera, start),
  } as never);
  window.dispatchEvent(
    new MouseEvent('pointermove', {
      ...screen(camera, worldPoint(start[0], start[1], start[2] + dz)),
      buttons: 1,
    }),
  );
  window.dispatchEvent(new MouseEvent('pointerup'));
}

describe('정적 객체 손잡이 끌기(World)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('lift: 크기·X·Y·yaw 를 지키고 중심 Z 만 옮긴다(바닥에 붙이지 않는다)', () => {
    beginObstacle();
    dragHandle('lift', 0.4);
    const d = draft();
    near(d.center, [5, 5.5, 3], 6);
    expect([...d.size, d.yaw]).toEqual([0.4, 0.3, 0.15, 0.3]);
  });

  it('z-: 아랫면만 내리고 윗면은 고정이다', () => {
    beginObstacle();
    const top = 2.6 + 0.075;
    dragHandle('z-', -0.2);
    const d = draft();
    expect(d.center[2] + d.size[2] / 2).toBeCloseTo(top, 9);
    expect(d.size[2]).toBeCloseTo(0.35, 6);
  });
});

// ---- 장면: WorkSurfaceLayer(정적 객체 포함) + ObbGizmoController ----

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
async function mount() {
  const canvas = document.createElement('canvas');
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

describe('정적 객체 레이어·조작기 장면', () => {
  beforeEach(setup);
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    teardown();
  });

  it('유효 정적 객체 2개를 object 대상으로 올리고 상자 중심·회전이 계약 obb 와 같다. 상판 가장자리 선은 없다', async () => {
    await mount();
    expect(
      named('obstacle-box:')
        .map((o) => o.name)
        .sort(),
    ).toEqual(['obstacle-box:so-cabinet', 'obstacle-box:so-projector']);
    const keys = [...viewer.getState().targets.keys()];
    expect(keys).toContain('object:so-cabinet');
    expect(keys).toContain('object:so-projector');
    expect(keys.filter((k) => k === 'object:desk-1')).toHaveLength(1);
    const box = named('obstacle-box:so-projector')[0]!;
    box.updateWorldMatrix(true, false);
    const center = box.getWorldPosition(new Vector3()).toArray();
    near(center, worldToThree(worldPoint(5, 5.5, 2.6)), 9);
    expect(box.parent!.rotation.y).toBe(0.3);
    expect(named('obstacle-edges:')).toHaveLength(2);
    expect(named('surface-top-edge:so-')).toHaveLength(0);
    expect(named('surface-box:so-')).toHaveLength(0);
  });

  it('정적 객체에는 이름표(Sprite)를 달지 않는다', async () => {
    await mount();
    let sprites = 0;
    scene!.traverse((o) => {
      if (o instanceof THREE.Sprite) sprites += 1;
    });
    expect(sprites).toBe(0);
  });

  it('클릭하면 그 정적 객체를 선택하고, 편집하면 손잡이 9개(아랫면·Z 이동 포함)를 붙이고 상판 선은 그리지 않는다', async () => {
    await mount();
    await act(async () =>
      onClickOf(named('object:so-cabinet')[0]!)({
        delta: 0,
        stopPropagation: () => {},
        intersections: [],
        nativeEvent: { detail: 1 },
      }),
    );
    expect(viewer.getState().selected).toEqual(CABINET);
    await act(async () => void edit.store.getState().begin(CABINET));
    expect(
      named('object-edit-handle:')
        .map((o) => o.name.slice(19))
        .sort(),
    ).toEqual([...OBSTACLE_EDIT_HANDLES].sort());
    expect(named('object-edit-top-edge')).toHaveLength(0);
    const lift = named('object-edit-handle:lift')[0]!.getWorldPosition(new Vector3()).toArray();
    near(lift, worldToThree(objectHandleWorld(draft(), 'lift')), 9);
    expect(named('obstacle-box:so-cabinet')).toHaveLength(1);
  });
});

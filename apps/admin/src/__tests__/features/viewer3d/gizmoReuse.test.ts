import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { DEMO_WORK_SURFACES, DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { EDIT_FACES, type EditPolicy } from '@/features/viewer3d/editing/editGeometry';
import {
  createEditStore,
  type ObjectEditHandle,
} from '@/features/viewer3d/editing/editSession.store';
import { createHandleDrag, handleWorld } from '@/features/viewer3d/editing/GizmoController';
import { createObjectHandleDrag, objectHandleWorld } from '@/features/viewer3d/editing/ObbGizmo';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { worldPoint, worldToThree, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import type { RootState } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -195 공통 Gizmo 인수: 같은 편집 Store·엔진·손잡이 입력(카메라 조작 끄기·되돌리기)을
// 구역 AABB(-47·-241), 작업면 OBB(-188), PLANNED 가상 객체 Fixture(-186 도메인 전 단계)가 함께 쓴다.
// PLANNED 는 도메인(TBM 배치·저장)을 만들지 않고, 같은 OBB 손잡이에 정책만 바꿔 끼워 조작이 되는지 본다.

const T0 = 1_760_342_400_000;
const RECT = { left: 0, top: 0, width: 800, height: 600 };
const Z1 = { type: 'zone', id: 'z-01' } as const;
const DESK1 = { type: 'object', id: 'desk-1' } as const;

/** -195 Jira 의 PLANNED 정책: 허용 축별 이동·수평 회전·크기, 기울임 금지. */
const PLANNED_FIXTURE: EditPolicy = {
  name: 'fixture-planned',
  translate: { x: true, y: true, z: true },
  faces: EDIT_FACES,
  rotate: { yaw: true, pitch: false, roll: false },
};

let viewer: ReturnType<typeof createViewerStore>;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;

beforeEach(() => {
  viewer = createViewerStore('PLANNED');
  viewer.getState().markReady();
  viewer.getState().registerTarget(Z1);
  viewer.getState().registerTarget(DESK1);
  const data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  data.getState().ingestWorkSurfaces({ ok: true, raw: structuredClone(DEMO_WORK_SURFACES) }, T0);
  edit = createEditStore(viewer, data);
  off = edit.connect();
});
afterEach(() => off());

function rig() {
  const camera = new PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 500);
  camera.position.set(3, 6, 1.5);
  camera.lookAt(2.6, 0.4, -4.5);
  camera.updateMatrixWorld();
  const canvas = { getBoundingClientRect: () => RECT } as unknown as HTMLCanvasElement;
  const controls = { enabled: true };
  const state = { camera, gl: { domElement: canvas }, controls } as unknown as RootState;
  return { camera, controls, state };
}

function screen(camera: PerspectiveCamera, point: WorldPoint) {
  const p = new Vector3(...worldToThree(point)).project(camera);
  return { clientX: ((p.x + 1) / 2) * RECT.width, clientY: ((1 - p.y) / 2) * RECT.height };
}
const moveTo = (camera: PerspectiveCamera, point: WorldPoint) =>
  window.dispatchEvent(new MouseEvent('pointermove', { ...screen(camera, point), buttons: 1 }));
const release = () => window.dispatchEvent(new MouseEvent('pointerup'));
const shift = (p: WorldPoint, dx: number, dy: number, dz: number) =>
  worldPoint(p[0] + dx, p[1] + dy, p[2] + dz);

/** 작업면 세션을 PLANNED Fixture 정책으로 바꿔 끼운다(도메인 없이 같은 조작기만 시험). */
function beginPlannedFixture() {
  expect(edit.store.getState().begin(DESK1)).toEqual({ ok: true });
  const session = edit.store.getState().objectSession!;
  edit.store.setState({ objectSession: { ...session, policy: PLANNED_FIXTURE } });
}

function dragObject(handle: ObjectEditHandle, to: (start: WorldPoint) => WorldPoint) {
  const { camera, controls, state } = rig();
  const drag = createObjectHandleDrag(edit.store, () => state);
  const start = objectHandleWorld(edit.store.getState().objectSession!.draft, handle);
  drag.start(handle, {
    stopPropagation: vi.fn(),
    button: 0,
    nativeEvent: screen(camera, start),
  } as never);
  const during = controls.enabled;
  moveTo(camera, to(start));
  release();
  return { during, after: controls.enabled };
}

describe('-195 공통 Gizmo 재사용(AABB·OBB·PLANNED Fixture)', () => {
  it('구역 AABB 와 작업면 OBB 는 같은 Store 에서 차례로 열리고, 둘 다 끄는 동안 카메라 조작을 껐다가 되돌린다', () => {
    const { camera, controls, state } = rig();
    edit.store.getState().begin(Z1);
    const zoneDrag = createHandleDrag(edit.store, () => state);
    const from = handleWorld(edit.store.getState().session!.draft, 'move');
    zoneDrag.start('move', {
      stopPropagation: vi.fn(),
      button: 0,
      nativeEvent: screen(camera, from),
    } as never);
    expect(controls.enabled).toBe(false);
    moveTo(camera, shift(from, 0.3, 0, 0));
    release();
    expect(controls.enabled).toBe(true);
    expect(edit.store.getState().session!.draft.min[0]).toBeCloseTo(1.8, 5);

    edit.store.getState().begin(DESK1);
    expect(edit.store.getState().lastResult).toMatchObject({
      status: 'CANCELLED',
      reason: 'REPLACED',
    });
    const moved = dragObject('move', (s) => shift(s, 0.2, 0.1, 0));
    expect(moved).toEqual({ during: false, after: true });
    expect(edit.store.getState().objectSession!.draft.center[0]).toBeCloseTo(2.6, 5);
  });

  it('PLANNED Fixture: 같은 OBB 손잡이로 이동·회전·크기·높이를 바꾸고 원본 작업면은 그대로다', () => {
    beginPlannedFixture();
    const base = edit.store.getState().objectSession!.base;
    dragObject('move', (s) => shift(s, -0.4, 0.2, 0));
    dragObject('yaw', (s) => {
      const c = edit.store.getState().objectSession!.draft.center;
      const [rx, ry] = [s[0] - c[0], s[1] - c[1]];
      const [cos, sin] = [Math.cos(0.4), Math.sin(0.4)];
      return worldPoint(c[0] + rx * cos - ry * sin, c[1] + rx * sin + ry * cos, s[2]);
    });
    const yaw = edit.store.getState().objectSession!.draft.yaw;
    dragObject('x+', (s) => shift(s, 0.25 * Math.cos(yaw), 0.25 * Math.sin(yaw), 0));
    dragObject('z+', (s) => shift(s, 0, 0, 0.3));
    const d = edit.store.getState().objectSession!.draft;
    expect(d.center[0]).toBeCloseTo(2.0 + 0.125 * Math.cos(yaw), 4);
    expect(d.yaw).toBeCloseTo(0.5236 + 0.4, 4);
    expect(d.size[0]).toBeCloseTo(1.45, 4);
    expect(d.center[2] + d.size[2] / 2).toBeCloseTo(1.04, 4);
    expect(edit.store.getState().objectSession!.base).toEqual(base);
    expect(edit.store.getState().objectSession!.policy.name).toBe('fixture-planned');
  });

  it('PLANNED Fixture 에서도 기울임은 거부되고 초안은 마지막 유효 값에 머문다', () => {
    beginPlannedFixture();
    const draft = edit.store.getState().objectSession!.draft;
    const out = edit.store
      .getState()
      .previewObject(draft, { type: 'rotate', axis: 'roll', radians: 0.2 });
    expect(out).toMatchObject({ ok: false, reason: 'NOT_EDITABLE' });
    expect(edit.store.getState().objectSession!.draft).toEqual(draft);
    expect(edit.store.getState().objectSession!.refused?.reason).toBe('NOT_EDITABLE');
  });
});

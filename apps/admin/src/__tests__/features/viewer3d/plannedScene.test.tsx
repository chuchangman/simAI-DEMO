import * as viewer3d from '@/features/viewer3d';
import { createViewerTestHandle, Viewer3D, type Viewer3DHandle } from '@/features/viewer3d';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { DEMO_PLANNED_LAYOUT } from '@/features/viewer3d/dev-harness/PlannedPanel';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import { ObbGizmoController } from '@/features/viewer3d/editing/ObbGizmo';
import { PlannedLayer } from '@/features/viewer3d/planned/PlannedLayer';
import {
  createPlannedStore,
  PlannedStoreContext,
  type PlannedStore,
} from '@/features/viewer3d/planned/plannedLayout';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { cleanup, render } from '@testing-library/react';
import { act, createRef, StrictMode, useEffect } from 'react';
import type { Object3D, Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -186 장면·공개 입구. PLANNED 모드에서만 가상 객체가 장면 대상이 되고, 같은 OBB 손잡이가 가상 객체에도 붙는다.

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
let planned: PlannedStore;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;

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
        <ViewerStoreContext value={viewer}>
          <SpatialDataContext value={data}>
            <PlannedStoreContext value={planned}>
              <EditStoreContext value={edit.store}>
                <Probe />
                <PlannedLayer />
                <ObbGizmoController />
              </EditStoreContext>
            </PlannedStoreContext>
          </SpatialDataContext>
        </ViewerStoreContext>
      </StrictMode>,
    ),
  );
}

const named = (name: string): Object3D | null => scene?.getObjectByName(name) ?? null;
const plannedKeys = () =>
  [...viewer.getState().targets.keys()].filter((k) => k.startsWith('planned:')).sort();

describe('PlannedLayer 장면', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    viewer = createViewerStore('LIVE');
    viewer.getState().markReady();
    data = createSpatialDataStore();
    planned = createPlannedStore();
    planned.getState().setInput(structuredClone(DEMO_PLANNED_LAYOUT));
    edit = createEditStore(viewer, data, planned);
    off = edit.connect();
  });
  afterEach(async () => {
    off();
    await act(async () => root?.unmount());
    root = null;
    scene = null;
    vi.restoreAllMocks();
  });

  it('LIVE 에서는 그리지도 대상으로 올리지도 않고, PLANNED 에서만 올린다(StrictMode 에서도 하나씩)', async () => {
    await mount();
    expect(named('planned-layer')).toBeNull();
    expect(plannedKeys()).toEqual([]);
    act(() => {
      viewer.getState().setMode('PLANNED');
    });
    expect(plannedKeys()).toEqual([
      'planned:plan-equip-1',
      'planned:plan-open-1',
      'planned:plan-scaf-1',
    ]);
    expect([...viewer.getState().targets.values()].every((n) => n === 1)).toBe(true);
  });

  it('가상 객체 상자는 World 중심·yaw 를 Three 로 한 번 옮긴 자리에 있다', async () => {
    viewer.getState().setMode('PLANNED');
    await mount();
    const box = named('planned-entry:plan-equip-1')!.getObjectByName('planned-box:plan-equip-1')!;
    const holder = box.parent!;
    expect(holder.position.toArray().map((v) => +v.toFixed(9))).toEqual([3, 0.6, -8.8]);
    expect(holder.rotation.y).toBeCloseTo(0.4, 12);
  });

  it('PLANNED 를 떠나면 내려가고 선택·편집이 풀린다', async () => {
    viewer.getState().setMode('PLANNED');
    await mount();
    act(() => {
      edit.store.getState().begin({ type: 'planned', id: 'plan-scaf-1' });
    });
    expect(named('object-edit-gizmo')).not.toBeNull();
    expect(named('object-edit-handle:lift')).not.toBeNull();
    act(() => {
      viewer.getState().setMode('LIVE');
    });
    expect(plannedKeys()).toEqual([]);
    expect(viewer.getState().selected).toBeNull();
    expect(edit.store.getState().objectSession).toBeNull();
    expect(edit.store.getState().lastPlannedResult).toMatchObject({
      status: 'CANCELLED',
      reason: 'MODE_CHANGED',
    });
  });

  it('새 가상 객체는 손잡이와 초점 이름(planned:ID)을 갖는다', async () => {
    viewer.getState().setMode('PLANNED');
    await mount();
    act(() => {
      edit.store.getState().createPlanned({
        id: 'plan-new-1',
        kind: 'OPENING',
        geometry: { center: [5, 2.5, 0.05], size: [1, 1, 0.1], yawRad: 0 },
      });
    });
    expect(named('planned:plan-new-1')).not.toBeNull();
    expect(named('object:plan-new-1')).toBeNull();
    expect(named('object-edit-handle:yaw')).not.toBeNull();
  });
});

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Viewer3D PLANNED 공개 계약', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('plannedLayout·콜백을 받고, PLANNED 명령은 준비 전 NOT_READY 이며 LIVE object 명령과 섞이지 않는다', () => {
    const ref = createRef<Viewer3DHandle>();
    const results: unknown[] = [];
    const { container } = render(
      <Viewer3D
        ref={ref}
        plannedLayout={DEMO_PLANNED_LAYOUT}
        onPlannedEditResult={(r) => results.push(r)}
      />,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    const handle = ref.current!;
    expect(
      handle.beginPlannedCreate!({
        id: 'n',
        kind: 'SCAFFOLD',
        geometry: { center: [1, 1, 1], size: [1, 1, 2], yawRad: 0 },
      }),
    ).toEqual({ ok: false, reason: 'NOT_READY' });
    expect(results).toMatchObject([{ status: 'REJECTED', reason: 'NOT_READY' }]);
    expect(handle.cancelPlannedEdit!()).toBeNull();
    expect(handle.finishPlannedEdit!()).toBeNull();
    expect(handle.updatePlannedEditField!({ field: 'yaw', value: 0 })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });

  it('입구가 PLANNED 계약을 내보내고, 시험 핸들도 새 명령을 갖는다', () => {
    for (const name of [
      'PLANNED_KINDS',
      'readPlannedLayout',
      'plannedGeometryProblem',
      'PLANNED_OBB_POLICY',
    ]) {
      expect(viewer3d).toHaveProperty(name);
    }
    const handle = createViewerTestHandle();
    expect(handle.finishPlannedEdit()).toBeNull();
    expect(handle.calls.map((c) => c.method)).toEqual(['finishPlannedEdit']);
  });
});

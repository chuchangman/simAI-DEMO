import { applyZoneBoxOperation, fieldOperation, restoreZoneBoxSteps } from '@/features/viewer3d';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { DraftOverlay } from '@/features/viewer3d/editing/DraftOverlay';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import { EditOverlayContext, EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import type { ViewerEditOverlay } from '@/features/viewer3d/editing/editTypes';
import {
  EDIT_HANDLES,
  GizmoController,
  HANDLE_HINTS,
  handleWorld,
} from '@/features/viewer3d/editing/GizmoController';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint } from '@/features/viewer3d/worldCoordinates';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import { act, useEffect } from 'react';
import type { Object3D, Scene } from 'three';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const Z1 = { type: 'zone', id: 'z-01' } as const;
const Z3 = { type: 'zone', id: 'z-03' } as const;

let viewer: ViewerStore;
let data: SpatialDataStore;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  for (const id of ['z-01', 'z-02', 'z-03']) viewer.getState().registerTarget({ type: 'zone', id });
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  edit = createEditStore(viewer, data);
  off = edit.connect();
});
afterEach(() => {
  off();
  vi.restoreAllMocks();
});

const draft = () => edit.store.getState().session!.draft;
const set = (
  field: Parameters<ReturnType<typeof edit.store.getState>['updateField']>[0],
  value: number,
) => edit.store.getState().updateField(field, value);

describe('숫자 입력(updateField) — 손잡이와 같은 엔진·한 세션 누적', () => {
  it('X·Y 시작은 min·max 를 함께 옮겨 폭·깊이를 지키고, 폭·깊이는 min 을 고정한다', () => {
    edit.store.getState().begin(Z1);
    expect(set('originX', 2)).toEqual({ ok: true });
    expect(draft()).toEqual({ min: [2, 5.5, 0], max: [5, 8.5, 2] });
    expect(set('originY', 4)).toEqual({ ok: true });
    expect(draft()).toEqual({ min: [2, 4, 0], max: [5, 7, 2] });
    expect(set('width', 1.25)).toEqual({ ok: true });
    expect(set('depth', 0.5)).toEqual({ ok: true });
    expect(draft()).toEqual({ min: [2, 4, 0], max: [3.25, 4.5, 2] });
  });

  it('하단·상단은 그 면만 바꾸고, 다른 값 입력에서는 바닥·공중 하단을 그대로 둔다', () => {
    edit.store.getState().begin(Z3);
    set('originX', 1);
    set('width', 3);
    expect(draft().min[2]).toBe(1.2);
    expect(set('zMin', 0.4)).toEqual({ ok: true });
    expect(set('zMax', 3)).toEqual({ ok: true });
    expect(draft()).toEqual({ min: [1, 7.5, 0.4], max: [4, 9, 3] });
  });

  it('NaN·Infinity·크기 0 이하·경계 교차는 거부하고 마지막 유효 초안을 유지한다', () => {
    edit.store.getState().begin(Z1);
    const valid = draft();
    for (const [field, value] of [
      ['originX', Number.NaN],
      ['width', Number.POSITIVE_INFINITY],
      ['width', 0],
      ['depth', -1],
      ['zMin', 2],
      ['zMax', -0.5],
    ] as const) {
      expect(set(field, value)).toEqual({ ok: false, reason: 'INVALID_GEOMETRY' });
      expect(draft()).toEqual(valid);
    }
    expect(edit.store.getState().session!.refused?.reason).toBe('INVALID_GEOMETRY');
  });

  it('편집 중이 아니면 NOT_EDITABLE, 끄는 중이면 NOT_READY, 원본 구역은 바뀌지 않는다', () => {
    const snapshot = structuredClone(data.getState().zones);
    expect(set('width', 1)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    edit.store.getState().begin(Z1);
    edit.store.getState().setDragging('x+');
    expect(set('width', 1)).toEqual({ ok: false, reason: 'NOT_READY' });
    edit.store.getState().setDragging(null);
    set('width', 1);
    expect(edit.store.getState().finish()).toMatchObject({
      status: 'FINISHED',
      after: { min: [1.5, 5.5, 0], max: [2.5, 8.5, 2] },
      saved: false,
    });
    expect(data.getState().zones).toEqual(snapshot);
  });

  it('fieldOperation 은 절대값을 조작으로만 바꾼다(유한하지 않으면 null)', () => {
    const box = { min: worldPoint(1, 2, 0), max: worldPoint(3, 5, 2) };
    expect(fieldOperation(box, 'width', 4)).toEqual({ type: 'face', face: 'x+', delta: 2 });
    expect(fieldOperation(box, 'originY', 0)).toEqual({ type: 'translate', delta: [0, -2, 0] });
    expect(fieldOperation(box, 'zMin', Number.NaN)).toBeNull();
  });

  it('S03: Viewer 언마운트 전 직렬화해 보관한 초안(ViewerEditBox)을 새 Viewer 인스턴스에 6단계로 오차 없이 복원한다', () => {
    // 1번째 Viewer 세션에서 편집 후 완료 결과(직렬화 가능한 JSON)를 외부 Store 에 보관
    edit.store.getState().begin(Z1);
    set('originX', 3.25);
    set('originY', 6.1);
    set('width', 4.2);
    set('depth', 2.4);
    set('zMin', 2.2); // 기존 base.max[2](2.0)보다 높은 하단으로도 이동
    set('zMax', 3.6);
    const finished = edit.store.getState().finish();
    expect(finished?.status).toBe('FINISHED');
    const serialized = JSON.parse(JSON.stringify(finished)) as Extract<
      NonNullable<typeof finished>,
      { status: 'FINISHED' }
    >;
    expect(serialized.saved).toBe(false);

    // 기존 Viewer 언마운트
    off();

    // 새 Viewer 인스턴스 마운트 후 외부 보관 초안을 restoreZoneBoxSteps 로 복원
    const viewer2 = createViewerStore('LIVE');
    viewer2.getState().markReady();
    viewer2.getState().registerTarget(Z1);
    const data2 = createSpatialDataStore();
    data2.getState().reset('mock:normal:1');
    data2.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
    const edit2 = createEditStore(viewer2, data2);
    const off2 = edit2.connect();

    expect(edit2.store.getState().begin(Z1)).toEqual({ ok: true });
    const baseBox = edit2.store.getState().session!.base;
    for (const step of restoreZoneBoxSteps(baseBox, serialized.after)) {
      expect(edit2.store.getState().updateField(step.field, step.value)).toEqual({ ok: true });
    }
    expect(edit2.store.getState().session!.draft).toEqual(serialized.after);
    off2();
  });

  it('S05: 2D 화면용 순수 World 연산(applyZoneBoxOperation)은 3D EditStore 와 동일한 결과·거부 이유를 낸다', () => {
    edit.store.getState().begin(Z1);
    const initial = { min: [1.5, 5.5, 0] as const, max: [4.5, 8.5, 2] as const };
    const ops = [
      { type: 'translate' as const, delta: [0.75, -1.2, 0] as const },
      { type: 'face' as const, face: 'x+' as const, delta: 1.1 },
      { type: 'face' as const, face: 'y-' as const, delta: -0.4 },
      { type: 'face' as const, face: 'z+' as const, delta: 0.6 },
      { type: 'face' as const, face: 'z-' as const, delta: 0.3 },
    ];
    let box2d = {
      min: [...initial.min] as [number, number, number],
      max: [...initial.max] as [number, number, number],
    };
    for (const op of ops) {
      const res2d = applyZoneBoxOperation(box2d, op);
      expect(res2d.ok).toBe(true);
      if (res2d.ok) box2d = res2d.box;
      const res3d = edit.store.getState().preview(edit.store.getState().session!.draft, op);
      expect(res3d.ok).toBe(true);
    }
    expect(box2d).toEqual(edit.store.getState().session!.draft);

    // 경계 역전·Z 평행이동 거절도 2D 순수 함수와 3D Store 가 동일하다.
    expect(applyZoneBoxOperation(box2d, { type: 'face', face: 'x+', delta: -99 })).toMatchObject({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(applyZoneBoxOperation(box2d, { type: 'translate', delta: [0, 0, 1] })).toMatchObject({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });
});

// ---- 장면(WebGL 없이) ----

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
async function mount(overlay: ViewerEditOverlay | readonly ViewerEditOverlay[] | null) {
  const canvas = document.createElement('canvas');
  root ??= createRoot(canvas);
  await root.configure({
    gl: fakeRenderer(canvas) as never,
    size: { width: 800, height: 600, top: 0, left: 0 },
    frameloop: 'never',
  });
  await act(async () =>
    root!.render(
      <ViewerStoreContext value={viewer}>
        <SpatialDataContext value={data}>
          <EditStoreContext value={edit.store}>
            <EditOverlayContext value={overlay}>
              <Probe />
              <GizmoController />
              <DraftOverlay />
            </EditOverlayContext>
          </EditStoreContext>
        </SpatialDataContext>
      </ViewerStoreContext>,
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

describe('연속 7핸들 세션·호버 강조·미저장 미리보기 겹침(장면)', () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
  });

  it('도구 모드 전환 없이 한 세션에서 7개 손잡이를 모두 보이고, 이동 손잡이는 상자 기하 중심의 구(SphereGeometry)이며 호버 시 강조한다(U04, U09)', async () => {
    await mount(null);
    await act(async () => void edit.store.getState().begin(Z1));
    expect(
      named('edit-handle:')
        .map((o) => o.name.slice(12))
        .sort(),
    ).toEqual([...EDIT_HANDLES].sort());
    for (const h of EDIT_HANDLES) {
      expect(HANDLE_HINTS[h].length).toBeGreaterThan(0);
    }
    expect(HANDLE_HINTS.move).toContain('구역 전체 이동 · X/Y');
    expect(handleWorld(edit.store.getState().session!.draft, 'move')).toEqual([3, 7, 1]);
    const moveMesh = named('edit-handle:move')[0] as THREE.Mesh & {
      __r3f: {
        handlers: {
          onPointerOver: (e: { stopPropagation: () => void }) => void;
          onPointerOut: () => void;
        };
      };
    };
    expect(moveMesh.geometry.type).toBe('SphereGeometry');
    expect(moveMesh.scale.x).toBe(1);
    await act(async () => moveMesh.__r3f.handlers.onPointerOver({ stopPropagation: () => {} }));
    expect(moveMesh.scale.x).toBeCloseTo(1.2, 5);
    await act(async () => moveMesh.__r3f.handlers.onPointerOut());
    expect(moveMesh.scale.x).toBe(1);
  });

  it('다중 보관 미리보기도 클릭 대상 등록이나 광선 판정에 관여하지 않는다', async () => {
    const overlays: ViewerEditOverlay[] = [
      { target: Z1, box: { min: [2, 5, 0], max: [5, 8, 2] } },
      { target: Z3, box: { min: [5, 2, 1.2], max: [7, 4, 2.4] } },
    ];
    await mount(overlays);
    expect(named('edit-draft-overlay:')).toHaveLength(2);
    expect(viewer.getState().targets.get('zone:z-01')).toBe(1);
    expect(viewer.getState().targets.get('zone:z-03')).toBe(1);
    const hits: THREE.Intersection[] = [];
    scene!.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(3, 5, -6), new THREE.Vector3(0, -1, 0));
    for (const ghost of named('edit-draft-overlay:')) {
      ghost.traverse((object) => object.raycast(ray, hits));
    }
    expect(hits).toHaveLength(0);
  });

  it('미저장 미리보기 Ghost 는 클릭을 받지 않고, 같은 구역 편집 중·장면에 없는 구역이면 그리지 않는다', async () => {
    const overlay: ViewerEditOverlay = { target: Z1, box: { min: [2, 5, 0], max: [5, 8, 2] } };
    await mount(overlay);
    const ghost = named('edit-draft-overlay:z-01');
    expect(ghost).toHaveLength(1);
    const hits: THREE.Intersection[] = [];
    ghost[0]!.traverse((o) =>
      o.raycast(new THREE.Raycaster(new THREE.Vector3(3, 5, 0), new THREE.Vector3(0, -1, 0)), hits),
    );
    expect(hits).toHaveLength(0);
    await act(async () => void edit.store.getState().begin(Z1));
    expect(named('edit-draft-overlay:')).toHaveLength(0);
    await act(async () => void edit.store.getState().cancel('USER'));
    expect(named('edit-draft-overlay:')).toHaveLength(1);
    await mount({ target: { type: 'zone', id: 'missing' }, box: overlay.box });
    expect(named('edit-draft-overlay:')).toHaveLength(0);
  });

  it('미저장 미리보기 Ghost 이름표는 구역 이름과 미저장만 적는다(구역 번호 없음)', async () => {
    const fillText = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      fillText,
    } as unknown as CanvasRenderingContext2D);
    await mount({ target: Z1, box: { min: [2, 5, 0], max: [5, 8, 2] } });
    const texts = fillText.mock.calls.map(([text]) => text as string);
    expect(texts).toEqual(['예시 구역 A · 미저장']);
  });
});

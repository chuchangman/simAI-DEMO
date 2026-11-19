import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { createEditStore, type EditHandle } from '@/features/viewer3d/editing/editSession.store';
import { EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import {
  createHandleDrag,
  EDIT_HANDLES,
  GizmoController,
  handleWorld,
} from '@/features/viewer3d/editing/GizmoController';
import { Selectable } from '@/features/viewer3d/Selectable';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import { ZoneLayer } from '@/features/viewer3d/zones/ZoneLayer';
import { previewLabel } from '@/features/viewer3d/zones/zonePresentation';
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

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const T0 = 1_760_342_400_000;
const Z1 = { type: 'zone', id: 'z-01' } as const;
const Z3 = { type: 'zone', id: 'z-03' } as const;
const RECT = { left: 0, top: 0, width: 800, height: 600 };

let viewer: ViewerStore;
let data: SpatialDataStore;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;

beforeEach(() => {
  // 이름표 텍스처용 2D 캔버스는 jsdom 에 없다(글자만 비고 장면은 그대로).
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

// ---- 끌기: 실제 원근 카메라 투영으로 화면 좌표를 만들어 창 포인터 이벤트로 끈다 ----

function rig() {
  const camera = new PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 500);
  camera.position.set(9, 7, 6);
  camera.lookAt(4, 0.8, -6);
  camera.updateMatrixWorld();
  const canvas = { getBoundingClientRect: () => RECT } as unknown as HTMLCanvasElement;
  const controls = { enabled: true };
  const state = { camera, gl: { domElement: canvas }, controls } as unknown as RootState;
  return { camera, controls, drag: createHandleDrag(edit.store, () => state) };
}

function screen(camera: PerspectiveCamera, point: WorldPoint) {
  const p = new Vector3(...worldToThree(point)).project(camera);
  return { clientX: ((p.x + 1) / 2) * RECT.width, clientY: ((1 - p.y) / 2) * RECT.height };
}

function press(
  drag: ReturnType<typeof rig>['drag'],
  camera: PerspectiveCamera,
  handle: EditHandle,
) {
  const at = screen(camera, handleWorld(edit.store.getState().session!.draft, handle));
  const stopPropagation = vi.fn();
  drag.start(handle, { stopPropagation, button: 0, nativeEvent: at } as never);
  return stopPropagation;
}

const moveTo = (camera: PerspectiveCamera, point: WorldPoint) =>
  window.dispatchEvent(new MouseEvent('pointermove', { ...screen(camera, point), buttons: 1 }));
const release = () => window.dispatchEvent(new MouseEvent('pointerup'));
const draft = () => edit.store.getState().session!.draft;
const shift = (p: WorldPoint, dx: number, dy: number, dz: number) =>
  worldPoint(p[0] + dx, p[1] + dy, p[2] + dz);

describe('손잡이 끌기(World)', () => {
  it('X·Y 이동 손잡이: 수평으로 옮기고 높이는 그대로, 끄는 동안 카메라 조작을 끄고 놓으면 되돌린다', () => {
    edit.store.getState().begin(Z1);
    const { camera, controls, drag } = rig();
    const start = handleWorld(draft(), 'move');
    const stop = press(drag, camera, 'move');
    expect(stop).toHaveBeenCalled();
    expect(controls.enabled).toBe(false);
    expect(edit.store.getState().session!.dragging).toBe('move');
    moveTo(camera, shift(start, 0.8, -0.6, 0));
    release();
    expect(controls.enabled).toBe(true);
    expect(edit.store.getState().session!.dragging).toBeNull();
    const { min, max } = draft();
    expect(min[0]).toBeCloseTo(2.3, 6);
    expect(min[1]).toBeCloseTo(4.9, 6);
    expect(max[0]).toBeCloseTo(5.3, 6);
    expect(max[1]).toBeCloseTo(7.9, 6);
    expect([min[2], max[2]]).toEqual([0, 2]);
  });

  it('X+ 확장·Y- 축소는 반대 면을 고정한다', () => {
    edit.store.getState().begin(Z1);
    const { camera, drag } = rig();
    press(drag, camera, 'x+');
    moveTo(camera, shift(handleWorld(draft(), 'x+'), 0.7, 0.3, 0));
    release();
    press(drag, camera, 'y-');
    moveTo(camera, shift(handleWorld(draft(), 'y-'), -0.2, 0.5, 0));
    release();
    const { min, max } = draft();
    expect(max[0]).toBeCloseTo(5.2, 6);
    expect(min[0]).toBe(1.5);
    expect(min[1]).toBeCloseTo(6, 6);
    expect(max[1]).toBe(8.5);
  });

  it('상단은 z_max 만, 하단은 z_min 만 바꾼다(공중 구역 하단 1.2m 유지 후 단독 변경)', () => {
    edit.store.getState().begin(Z3);
    const { camera, drag } = rig();
    press(drag, camera, 'z+');
    moveTo(camera, shift(handleWorld(draft(), 'z+'), 0, 0, 0.5));
    release();
    expect(draft().max[2]).toBeCloseTo(2.9, 6);
    expect(draft().min[2]).toBe(1.2);
    press(drag, camera, 'z-');
    moveTo(camera, shift(handleWorld(draft(), 'z-'), 0, 0, -0.4));
    release();
    expect(draft().min[2]).toBeCloseTo(0.8, 6);
    expect(draft().max[2]).toBeCloseTo(2.9, 6);
    expect([draft().min[0], draft().max[0], draft().min[1], draft().max[1]]).toEqual([
      4.5, 6.5, 7.5, 9,
    ]);
  });

  it('Esc 는 끄던 조작만 되돌리고, 끄지 않을 때 Esc 는 편집을 취소한다', () => {
    edit.store.getState().begin(Z1);
    const { camera, controls, drag } = rig();
    const before = draft();
    press(drag, camera, 'x-');
    moveTo(camera, shift(handleWorld(before, 'x-'), -1, 0, 0));
    expect(draft()).not.toEqual(before);
    drag.escape();
    expect(draft()).toEqual(before);
    expect(controls.enabled).toBe(true);
    drag.escape();
    expect(edit.store.getState().session).toBeNull();
    expect(edit.store.getState().lastResult).toMatchObject({ status: 'CANCELLED', reason: 'USER' });

    // 이동 후 Enter(drag.enter)는 현재 초안을 FINISHED(미리보기 유지)로 마친다.
    edit.store.getState().begin(Z1);
    press(drag, camera, 'move');
    moveTo(camera, shift(handleWorld(before, 'move'), 0.5, 0, 0));
    // 끄는 도중에는 Enter 가 무시된다.
    drag.enter();
    expect(edit.store.getState().session).not.toBeNull();
    release();
    drag.enter();
    expect(edit.store.getState().session).toBeNull();
    expect(edit.store.getState().lastResult).toMatchObject({ status: 'FINISHED', changed: true });
  });

  it('창 밖에서 놓아 버튼이 떨어진 움직임·내려감은 끌기를 끝내고 카메라를 되돌리며, 끄기 전 꺼져 있던 카메라는 꺼진 채 둔다', () => {
    edit.store.getState().begin(Z1);
    const { camera, controls, drag } = rig();
    press(drag, camera, 'move');
    const held = draft();
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        ...screen(camera, shift(handleWorld(held, 'move'), 1, 1, 0)),
        buttons: 0,
      }),
    );
    expect(controls.enabled).toBe(true);
    expect(draft()).toEqual(held);
    controls.enabled = false;
    press(drag, camera, 'move');
    drag.end();
    drag.end();
    expect(controls.enabled).toBe(false);
    // 끝난 뒤 움직임은 초안을 바꾸지 않는다.
    const after = draft();
    moveTo(camera, shift(handleWorld(after, 'move'), 2, 2, 0));
    expect(draft()).toEqual(after);
  });

  it('교차하는 끌기는 거부하고 마지막 유효 초안에 머문다', () => {
    edit.store.getState().begin(Z1);
    const { camera, drag } = rig();
    press(drag, camera, 'x+');
    moveTo(camera, shift(handleWorld(draft(), 'x+'), 1, 0, 0));
    const valid = draft();
    moveTo(camera, shift(handleWorld(edit.store.getState().session!.base, 'x+'), -4, 0, 0));
    release();
    expect(draft()).toEqual(valid);
    expect(edit.store.getState().session!.refused?.reason).toBe('INVALID_GEOMETRY');
  });

  it.each(EDIT_HANDLES)(
    '%s: 거의 평행한 시점에서는 시작을 거부하고 Orbit과 초안을 유지한다',
    (handle) => {
      edit.store.getState().begin(Z1);
      const { camera, controls, drag } = rig();
      const before = draft();
      const anchor = new Vector3(...worldToThree(handleWorld(before, handle)));
      camera.position
        .copy(anchor)
        .add(handle[0] === 'z' ? new Vector3(0.001, 10, 0) : new Vector3(10, 0.001, 0));
      camera.lookAt(anchor);
      camera.updateMatrixWorld();
      press(drag, camera, handle);
      expect(edit.store.getState().session!.dragging).toBeNull();
      expect(controls.enabled).toBe(true);
      moveTo(camera, shift(handleWorld(before, handle), 0.5, 0, 0.5));
      expect(draft()).toEqual(before);
      release();
    },
  );

  it('끄는 중 평면과 거의 평행해진 포인터는 무시하고 마지막 유효 초안과 해제를 유지한다', () => {
    edit.store.getState().begin(Z1);
    const { camera, controls, drag } = rig();
    const start = handleWorld(draft(), 'move');
    press(drag, camera, 'move');
    moveTo(camera, shift(start, 0.5, 0, 0));
    const valid = draft();
    const distant = camera
      .getWorldDirection(new Vector3())
      .setY(0)
      .normalize()
      .multiplyScalar(100_000)
      .add(camera.position);
    distant.y -= 0.001;
    distant.project(camera);
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: ((distant.x + 1) / 2) * RECT.width,
        clientY: ((1 - distant.y) / 2) * RECT.height,
        buttons: 1,
      }),
    );
    expect(draft()).toEqual(valid);
    release();
    expect(controls.enabled).toBe(true);
    expect(edit.store.getState().session!.dragging).toBeNull();
  });
});

// ---- 장면: 실제 ZoneLayer·GizmoController 트리(WebGL 없이) ----

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
let sceneCamera: PerspectiveCamera | null = null;
const controls = { enabled: true };
function Probe() {
  const current = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const set = useThree((s) => s.set);
  useEffect(() => {
    scene = current;
    camera.position.set(9, 7, 6);
    camera.lookAt(4, 0.8, -6);
    camera.updateMatrixWorld();
    sceneCamera = camera as PerspectiveCamera;
    set({ controls: controls as never });
  }, [current, camera, set]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
async function mount(strict = false) {
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
  const tree = (
    <ViewerStoreContext value={viewer}>
      <SpatialDataContext value={data}>
        <EditStoreContext value={edit.store}>
          <Probe />
          <ZoneLayer />
          <GizmoController />
        </EditStoreContext>
      </SpatialDataContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
  return canvas;
}

const named = (prefix: string) => {
  const out: Object3D[] = [];
  scene?.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};

describe('GizmoController 장면', () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    controls.enabled = true;
  });

  it('편집 중인 선택 구역 하나에만 손잡이 7개를 붙이고, 선택이 바뀌거나 끝나면 내린다', async () => {
    await mount(true);
    expect(named('edit-gizmo')).toHaveLength(0);
    await act(async () => void edit.store.getState().begin(Z1));
    expect(named('edit-gizmo')).toHaveLength(1);
    expect(
      named('edit-handle:')
        .map((o) => o.name.slice(12))
        .sort(),
    ).toEqual([...EDIT_HANDLES].sort());
    // 원본 구역 상자는 그대로 남는다(초안과 따로 그린다).
    expect(named('zone-box:z-01')).toHaveLength(1);
    await act(async () => void viewer.getState().select(Z3));
    expect(named('edit-gizmo')).toHaveLength(0);
    expect(edit.store.getState().lastResult).toMatchObject({ reason: 'SELECTION_CHANGED' });
  });

  it('초안 상자·모서리는 클릭을 받지 않고 손잡이만 받는다', async () => {
    await mount();
    await act(async () => void edit.store.getState().begin(Z1));
    const preview = named('edit-preview')[0]!;
    const hits: THREE.Intersection[] = [];
    preview.traverse((o) => {
      if ((o as THREE.Mesh).isMesh)
        o.raycast(new THREE.Raycaster(new Vector3(3, 5, 0), new Vector3(0, -1, 0)), hits);
    });
    expect(hits).toHaveLength(0);
    const handle = named('edit-handle:move')[0] as unknown as {
      __r3f: { handlers: Record<string, unknown> };
    };
    // 손잡이는 끌기·호버 안내만 받고 클릭 선택 처리기는 없다.
    expect(Object.keys(handle.__r3f.handlers).sort()).toEqual([
      'onPointerDown',
      'onPointerOut',
      'onPointerOver',
    ]);
  });

  it('StrictMode에서도 전역 Enter 한 번만 완료하고 드래그 중에는 완료하지 않는다', async () => {
    await mount(true);
    await act(async () => void edit.store.getState().begin(Z1));
    const finish = vi.spyOn(edit.store.getState(), 'finish');
    const results = vi.fn();
    const unsubscribe = edit.store.subscribe((state, previous) => {
      if (state.lastResult !== previous.lastResult) results(state.lastResult);
    });
    const handle = named('edit-handle:move')[0] as THREE.Mesh & {
      __r3f: { handlers: { onPointerDown: (e: unknown) => void } };
    };
    await act(async () =>
      handle.__r3f.handlers.onPointerDown({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, handleWorld(draft(), 'move')),
      }),
    );
    await act(async () => {
      moveTo(sceneCamera!, shift(handleWorld(draft(), 'move'), 0.5, 0, 0));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(finish).not.toHaveBeenCalled();
    expect(results).not.toHaveBeenCalled();
    expect(edit.store.getState().session?.dragging).toBe('move');
    await act(async () => {
      release();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(results).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 'FINISHED',
        changed: true,
        saved: false,
      }),
    );
    expect(controls.enabled).toBe(true);
    unsubscribe();
  });

  it.each(['Enter', 'Escape'])(
    '%s: 소비·반복·IME·네이티브 입력 키는 세션에 전달하지 않는다',
    async (key) => {
      await mount();
      await act(async () => void edit.store.getState().begin(Z1));
      const before = edit.store.getState().session;
      for (const init of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
        await act(
          async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init })),
        );
        expect(edit.store.getState().session).toBe(before);
      }
      const consumed = new KeyboardEvent('keydown', { key, cancelable: true });
      consumed.preventDefault();
      await act(async () => void window.dispatchEvent(consumed));
      expect(edit.store.getState().session).toBe(before);
      for (const html of [
        '<input />',
        '<textarea></textarea>',
        '<select><option>구역</option></select>',
        '<button><span>완료</span></button>',
        '<a href="#"><span>구역</span></a>',
        '<div contenteditable="true"><span>값</span></div>',
        '<div contenteditable="plaintext-only"><span>값</span></div>',
      ]) {
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.append(container);
        const target = container.querySelector('span, option') ?? container.firstElementChild!;
        await act(
          async () =>
            void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
        );
        expect(edit.store.getState().session, html).toBe(before);
        container.remove();
      }
      expect(edit.store.getState().lastResult).toBeNull();
    },
  );

  it('전역 Escape는 드래그만 되돌리고 다음 Escape에서 세션을 취소한다', async () => {
    await mount();
    await act(async () => void edit.store.getState().begin(Z1));
    const before = draft();
    const handle = named('edit-handle:x+')[0] as THREE.Mesh & {
      __r3f: { handlers: { onPointerDown: (e: unknown) => void } };
    };
    await act(async () =>
      handle.__r3f.handlers.onPointerDown({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, handleWorld(before, 'x+')),
      }),
    );
    await act(async () => moveTo(sceneCamera!, shift(handleWorld(before, 'x+'), 0.5, 0, 0)));
    expect(draft()).not.toEqual(before);
    await act(
      async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(draft()).toEqual(before);
    expect(edit.store.getState().lastResult).toBeNull();
    expect(controls.enabled).toBe(true);
    await act(
      async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    );
    expect(edit.store.getState().lastResult).toMatchObject({ status: 'CANCELLED', reason: 'USER' });
  });

  it('활성 이름표는 구역 이름과 미저장만 표시하고 거부 안내는 유지한다', async () => {
    expect(previewLabel({ name: '예시 구역 A' })).toBe('예시 구역 A · 미저장');
    expect(previewLabel({ name: '' })).toBe('구역 · 미저장');
    const fillText = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      fillText,
    } as unknown as CanvasRenderingContext2D);
    await mount();
    await act(async () => void edit.store.getState().begin(Z1));
    expect(fillText).toHaveBeenCalledWith(
      '예시 구역 A · 미저장',
      expect.any(Number),
      expect.any(Number),
    );
    await act(async () => void edit.store.getState().updateField('width', -10));
    expect(fillText).toHaveBeenCalledWith(
      `예시 구역 A · 미저장 · 편집 거부 · ${edit.store.getState().session!.refused!.detail}`,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it.each([8, 80])(
    '%sm 거리에서도 표시 형상은 그대로 두고 최소 24px 포인터 영역을 제공한다',
    async (distance) => {
      await mount();
      await act(async () => void edit.store.getState().begin(Z1));
      scene!.updateMatrixWorld(true);
      for (const handle of named('edit-handle:') as THREE.Mesh[]) {
        const center = handle.getWorldPosition(new Vector3());
        sceneCamera!.position.copy(center).add(new Vector3(0, 0, distance));
        sceneCamera!.lookAt(center);
        sceneCamera!.updateMatrixWorld();
        const geometry = handle.geometry;
        const scale = handle.scale.clone();
        const hitAt = (dx: number, dy: number) => {
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(
            new THREE.Vector2((2 * dx) / RECT.width, (-2 * dy) / RECT.height),
            sceneCamera!,
          );
          return raycaster.intersectObject(handle, false);
        };
        expect(hitAt(11, 11), handle.name).toHaveLength(1);
        expect(hitAt(30, 30), handle.name).toHaveLength(0);
        expect(handle.geometry).toBe(geometry);
        expect(handle.scale).toEqual(scale);
        expect(handle.position.toArray()).toEqual(
          worldToThree(handleWorld(draft(), handle.name.slice(12) as EditHandle)),
        );
      }
    },
  );

  it('끄는 중 장면에서 내려가면(취소·StrictMode 재마운트) 카메라 조작을 되돌린다', async () => {
    const canvas = await mount(true);
    await act(async () => void edit.store.getState().begin(Z1));
    const handle = named('edit-handle:x+')[0] as unknown as {
      __r3f: {
        handlers: { onPointerDown: (e: unknown) => void; onPointerOver: (e: unknown) => void };
      };
    };
    await act(async () => handle.__r3f.handlers.onPointerOver({ stopPropagation: () => {} }));
    expect(canvas.style.cursor).toBe('grab');
    const at = screen(sceneCamera!, handleWorld(draft(), 'x+'));
    await act(async () =>
      handle.__r3f.handlers.onPointerDown({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: at,
      }),
    );
    expect(edit.store.getState().session?.dragging).toBe('x+');
    expect(controls.enabled).toBe(false);
    expect(canvas.style.cursor).toBe('grabbing');
    await act(async () => void edit.store.getState().cancel('USER'));
    expect(controls.enabled).toBe(true);
    expect(canvas.style.cursor).toBe('');
    expect(named('edit-gizmo')).toHaveLength(0);
  });
});

describe('Selectable', () => {
  it('끈 동작(delta > 2px)은 선택으로 보지 않는다', async () => {
    const canvas = document.createElement('canvas');
    const r = createRoot(canvas);
    await r.configure({
      gl: fakeRenderer(canvas) as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
    });
    let sceneRef: Scene | null = null;
    function Grab() {
      const s = useThree((st) => st.scene);
      useEffect(() => {
        sceneRef = s;
      }, [s]);
      return null;
    }
    await act(async () =>
      r.render(
        <ViewerStoreContext value={viewer}>
          <Grab />
          <Selectable target={Z1}>
            <mesh />
          </Selectable>
        </ViewerStoreContext>,
      ),
    );
    const group = (sceneRef as unknown as Scene).getObjectByName('zone:z-01') as unknown as {
      __r3f: { handlers: { onClick: (e: unknown) => void } };
    };
    const event = (delta: number) => ({ delta, stopPropagation: () => {} });
    group.__r3f.handlers.onClick(event(12));
    expect(viewer.getState().selected).toBeNull();
    group.__r3f.handlers.onClick(event(1));
    expect(viewer.getState().selected).toEqual(Z1);
    expect(viewer.getState().activated).toBeNull();
    // 같은 대상을 연속 클릭(더블클릭)하면 activated 를 알린다.
    group.__r3f.handlers.onClick(event(1));
    expect(viewer.getState().activated).toEqual({ target: Z1 });
    await act(async () => r.unmount());
  });
});

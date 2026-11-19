import type { BoxEditHandle } from '@/features/viewer3d/editing/boxEdit';
import { createBoxEditDrag } from '@/features/viewer3d/editing/boxEditDrag';
import {
  BoxEditContext,
  BoxEditGizmo,
  type BoxEditBinding,
} from '@/features/viewer3d/editing/BoxEditGizmo';
import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import { IDLE_LOAD, type SceneLoad } from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  SceneStoreContext,
  type SceneStore,
} from '@/features/viewer3d/scene/sceneStore';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { DEFAULT_ROOM_LIMIT as ROOM, roomLimitFrom, type RoomLimit } from '@/lib/roomLimit';
import {
  createRoot,
  extend,
  useThree,
  type ReconcilerRoot,
  type RootState,
} from '@react-three/fiber';
import { act, StrictMode, useEffect } from 'react';
import * as THREE from 'three';
import { PerspectiveCamera, Vector3, type Mesh, type Object3D, type Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const RECT = { left: 0, top: 0, width: 800, height: 600 };
// World 상자: 가운데 (3, 4.5, 1). Three 가운데는 (3, 1, -4.5).
const BOX: ViewerEditBox = { min: [2, 3, 0], max: [4, 6, 2] };
const CENTER = [3, 4.5, 1] as const;
const LOOK_AT = new Vector3(3, 1, -4.5);

/** World 점 → Three 점. World (x, y, z) → Three (x, z, −y). */
const three = (x: number, y: number, z: number) => new Vector3(x, z, -y);

function setupCamera(camera: THREE.Camera) {
  camera.position.set(9, 7, 6);
  camera.lookAt(LOOK_AT);
  camera.updateMatrixWorld();
}

function screen(camera: PerspectiveCamera, point: Vector3) {
  const p = point.clone().project(camera);
  return { clientX: ((p.x + 1) / 2) * RECT.width, clientY: ((1 - p.y) / 2) * RECT.height };
}

// ---- 끌기 객체(createBoxEditDrag): 실제 원근 카메라 투영으로 화면 좌표를 만들어 창 포인터 이벤트로 끈다 ----

function rig(limit: RoomLimit = ROOM) {
  const camera = new PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 500);
  setupCamera(camera);
  const canvas = { getBoundingClientRect: () => RECT } as unknown as HTMLCanvasElement;
  const controls = { enabled: true };
  const state = { camera, gl: { domElement: canvas }, controls } as unknown as RootState;
  const setDragging = vi.fn();
  const emit = vi.fn();
  const drag = createBoxEditDrag(() => state, setDragging);
  drag.sync(BOX, emit, limit);
  return { camera, controls, drag, setDragging, emit };
}

const press = (
  drag: ReturnType<typeof rig>['drag'],
  camera: PerspectiveCamera,
  handle: BoxEditHandle,
  at: Vector3,
  button = 0,
) => {
  const stopPropagation = vi.fn();
  drag.start(handle, { stopPropagation, button, nativeEvent: screen(camera, at) } as never);
  return stopPropagation;
};
const moveTo = (camera: PerspectiveCamera, at: Vector3, buttons = 1) =>
  window.dispatchEvent(new MouseEvent('pointermove', { ...screen(camera, at), buttons }));
const release = () => window.dispatchEvent(new MouseEvent('pointerup'));
const escKey = () => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('끌기 객체', () => {
  it('화살표: 그 면만 움직이고, 끄는 동안 카메라 조작을 끄고 놓으면 되돌린다', () => {
    const { camera, controls, drag, setDragging, emit } = rig();
    const stop = press(drag, camera, 'x+', three(CENTER[0] + 1, CENTER[1], CENTER[2]));
    expect(stop).toHaveBeenCalled();
    expect(controls.enabled).toBe(false);
    expect(setDragging).toHaveBeenLastCalledWith('x+');
    moveTo(camera, three(CENTER[0] + 1.5, CENTER[1], CENTER[2]));
    expect(emit).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [4.5, 6, 2] });
    release();
    expect(controls.enabled).toBe(true);
    expect(setDragging).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ['x-', [-1, 0, 0], { min: [1.5, 3, 0], max: [4, 6, 2] }],
    ['y+', [0, 1, 0], { min: [2, 3, 0], max: [4, 6.5, 2] }],
    ['y-', [0, -1, 0], { min: [2, 2.5, 0], max: [4, 6, 2] }],
    ['z+', [0, 0, 1], { min: [2, 3, 0], max: [4, 6, 2.5] }],
  ] as const)('%s: 축을 따라 0.5 m 끌면 그 면이 0.5 m 움직인다', (handle, axis, expected) => {
    const { camera, drag, emit } = rig();
    const along = (m: number) =>
      three(CENTER[0] + axis[0] * m, CENTER[1] + axis[1] * m, CENTER[2] + axis[2] * m);
    press(drag, camera, handle, along(1));
    moveTo(camera, along(1.5));
    expect(emit).toHaveBeenLastCalledWith(expected);
    release();
  });

  it('호스트가 새 상자를 내려 줘도 계산은 끌기 시작 때의 상자에서 한다', () => {
    const { camera, drag, emit } = rig();
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    press(drag, camera, 'x+', x(1));
    moveTo(camera, x(1.5));
    expect(emit).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [4.5, 6, 2] });
    drag.sync({ min: [2, 3, 0], max: [4.5, 6, 2] }, emit, ROOM);
    moveTo(camera, x(1.2));
    // 시작 상자(max 4) + 0.2 이지, 4.5 + 0.2 가 아니다.
    expect(emit).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [4.2, 6, 2] });
    release();
  });

  it('맞춘 결과가 지금 상자와 같으면 알리지 않는다', () => {
    const { camera, drag, emit } = rig();
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    press(drag, camera, 'x+', x(1));
    moveTo(camera, x(1.01));
    expect(emit).not.toHaveBeenCalled();
    moveTo(camera, x(1.5));
    expect(emit).toHaveBeenCalledTimes(1);
    drag.sync({ min: [2, 3, 0], max: [4.5, 6, 2] }, emit, ROOM);
    moveTo(camera, x(1.52));
    expect(emit).toHaveBeenCalledTimes(1);
    release();
  });

  it('가운데 구: 바닥에서만 옮기고 크기와 높이(Z)는 그대로다', () => {
    const { camera, drag, emit } = rig();
    press(drag, camera, 'move', three(...CENTER));
    moveTo(camera, three(CENTER[0] + 0.8, CENTER[1] - 0.6, CENTER[2]));
    const out = emit.mock.lastCall![0] as ViewerEditBox;
    expect(out.min[0]).toBeCloseTo(2.8, 6);
    expect(out.min[1]).toBeCloseTo(2.4, 6);
    expect(out.max[0]).toBeCloseTo(4.8, 6);
    expect(out.max[1]).toBeCloseTo(5.4, 6);
    expect([out.min[2], out.max[2]]).toEqual([0, 2]);
    // 화면에서 위로 끌어도 손잡이 높이의 수평 평면을 읽으므로 Z 는 바뀌지 않는다.
    moveTo(camera, three(CENTER[0], CENTER[1], CENTER[2] + 1));
    const up = emit.mock.lastCall![0] as ViewerEditBox;
    expect([up.min[2], up.max[2]]).toEqual([0, 2]);
    release();
  });

  it('가운데 구 이동은 교실 안(0~10)으로 가둔다', () => {
    const { camera, drag, emit } = rig();
    press(drag, camera, 'move', three(...CENTER));
    moveTo(camera, three(CENTER[0] - 20, CENTER[1], CENTER[2]));
    const out = emit.mock.lastCall![0] as ViewerEditBox;
    expect([out.min[0], out.max[0]]).toEqual([0, 2]);
    release();
  });

  it('넘겨 받은 교실 범위(스캔 경계 x 1~7 · y 2~9)로 가운데 구 이동을 가둔다', () => {
    const { camera, drag, emit } = rig(roomLimitFrom({ min: [1, 2, 0], max: [7, 9, 3] }));
    press(drag, camera, 'move', three(...CENTER));
    moveTo(camera, three(CENTER[0] - 20, CENTER[1], CENTER[2]));
    const out = emit.mock.lastCall![0] as ViewerEditBox;
    expect([out.min[0], out.max[0]]).toEqual([1, 3]);
    release();
  });

  it('Esc 는 끌기를 시작 전 상자로 되돌리고 Esc 이벤트를 소비한다', () => {
    const { camera, controls, drag, setDragging, emit } = rig();
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    press(drag, camera, 'x+', x(1));
    moveTo(camera, x(1.5));
    expect(emit).toHaveBeenCalledTimes(1);
    const bubbled = vi.fn();
    window.addEventListener('keydown', bubbled);
    const event = escKey();
    window.removeEventListener('keydown', bubbled);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(BOX);
    expect(controls.enabled).toBe(true);
    expect(setDragging).toHaveBeenLastCalledWith(null);
    // 끝난 뒤 움직임과 Esc 는 아무것도 하지 않는다.
    moveTo(camera, x(2));
    const after = escKey();
    expect(after.defaultPrevented).toBe(false);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('바뀐 것이 없으면 Esc 는 끌기만 끝내고 알리지 않는다', () => {
    const { camera, drag, emit } = rig();
    press(drag, camera, 'x+', three(CENTER[0] + 1, CENTER[1], CENTER[2]));
    expect(drag.escape()).toBe(true);
    expect(drag.escape()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('창 밖에서 놓아 버튼이 떨어진 움직임·내려감은 끌기를 끝내고, 끄기 전 꺼져 있던 카메라는 꺼진 채 둔다', () => {
    const { camera, controls, drag, emit } = rig();
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    press(drag, camera, 'x+', x(1));
    moveTo(camera, x(1.5), 0);
    expect(controls.enabled).toBe(true);
    expect(emit).not.toHaveBeenCalled();
    controls.enabled = false;
    press(drag, camera, 'x+', x(1));
    drag.end();
    drag.end();
    expect(controls.enabled).toBe(false);
    moveTo(camera, x(2));
    expect(emit).not.toHaveBeenCalled();
  });

  it('주 버튼이 아니거나 이미 끄는 중이거나 상자가 없으면 시작하지 않는다', () => {
    const { camera, controls, drag, setDragging } = rig();
    press(drag, camera, 'x+', three(...CENTER), 2);
    expect(controls.enabled).toBe(true);
    expect(setDragging).not.toHaveBeenCalled();
    const empty = createBoxEditDrag(() => ({ controls }) as unknown as RootState, setDragging);
    press(empty, camera, 'x+', three(...CENTER));
    expect(setDragging).not.toHaveBeenCalled();
    press(drag, camera, 'x+', three(...CENTER));
    expect(setDragging).toHaveBeenCalledTimes(1);
    press(drag, camera, 'y+', three(...CENTER));
    expect(setDragging).toHaveBeenCalledTimes(1);
    release();
  });

  it('시선이 화살표 축과 거의 나란하면 시작하지 않고 Orbit 을 유지한다', () => {
    const { camera, controls, drag, setDragging } = rig();
    camera.position.set(-6, 1, -4.5);
    camera.lookAt(LOOK_AT);
    camera.updateMatrixWorld();
    press(drag, camera, 'x+', three(CENTER[0] + 1, CENTER[1], CENTER[2]));
    expect(setDragging).not.toHaveBeenCalled();
    expect(controls.enabled).toBe(true);
  });
});

// ---- 장면: 실제 BoxEditGizmo 트리(WebGL 없이) ----

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

type Handlers = Record<string, (event: unknown) => void>;
const handlersOf = (object: Object3D) =>
  (object as unknown as { __r3f: { handlers: Handlers } }).__r3f.handlers;

let viewer: ViewerStore;
let scene: Scene | null = null;
let sceneCamera: PerspectiveCamera | null = null;
let canvas: HTMLCanvasElement | null = null;
const controls = { enabled: true };

function Probe() {
  const current = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const set = useThree((s) => s.set);
  useEffect(() => {
    scene = current;
    setupCamera(camera);
    sceneCamera = camera as PerspectiveCamera;
    set({ controls: controls as never });
  }, [current, camera, set]);
  return null;
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
async function mount(
  binding: BoxEditBinding | null,
  strict = false,
  sceneStore: SceneStore | null = null,
) {
  canvas ??= document.createElement('canvas');
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
      <SceneStoreContext value={sceneStore}>
        <BoxEditContext value={binding}>
          <Probe />
          <BoxEditGizmo />
        </BoxEditContext>
      </SceneStoreContext>
    </ViewerStoreContext>
  );
  await act(async () => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

const named = (prefix: string) => {
  const out: Object3D[] = [];
  scene?.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
};
const binding = (patch: Partial<BoxEditBinding> = {}): BoxEditBinding => ({
  boxEdit: { id: 'z-01', kind: 'zone', box: BOX },
  boxGhosts: [],
  ...patch,
});

beforeEach(() => {
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  canvas = null;
  scene = null;
  controls.enabled = true;
});

describe('BoxEditGizmo 장면', () => {
  it('상자 편집이 없고 보관 초안도 없으면 아무것도 그리지 않는다', async () => {
    await mount(binding({ boxEdit: null }));
    expect(named('box-edit')).toHaveLength(0);
    await mount(null);
    expect(named('box-edit')).toHaveLength(0);
  });

  it('zone 은 가운데 구와 여섯 화살표, surface 는 z- 를 뺀 다섯 화살표를 그린다', async () => {
    await mount(binding());
    expect(
      named('box-edit-handle:')
        .map((o) => o.name.slice('box-edit-handle:'.length))
        .sort(),
    ).toEqual(['move', 'x+', 'x-', 'y+', 'y-', 'z+', 'z-']);
    await mount(binding({ boxEdit: { id: 'surface:z-01', kind: 'surface', box: BOX } }));
    expect(
      named('box-edit-handle:')
        .map((o) => o.name.slice('box-edit-handle:'.length))
        .sort(),
    ).toEqual(['move', 'x+', 'x-', 'y+', 'y-', 'z+']);
    expect(named('box-edit-pick:z-')).toHaveLength(0);
  });

  it('가운데 구는 상자 가운데, 화살표는 각 면의 바깥 가운데에 놓인다(S15P31A101-651)', async () => {
    await mount(binding());
    const at = (handle: string) => named(`box-edit-at:${handle}`)[0]!.position.toArray();
    // World (x, y, z) → Three (x, z, −y). 상자 World x 2~4 · y 3~6 · z 0~2.
    expect(at('move')).toEqual([3, 1, -4.5]);
    expect(at('x+')).toEqual([4, 1, -4.5]);
    expect(at('x-')).toEqual([2, 1, -4.5]);
    expect(at('y+')).toEqual([3, 1, -6]);
    expect(at('y-')).toEqual([3, 1, -3]);
    expect(at('z+')).toEqual([3, 2, -4.5]);
    expect(at('z-')).toEqual([3, 0, -4.5]);
  });

  it('미리보기 상자·윤곽은 클릭을 받지 않고, 손잡이는 판정 메시만 받는다', async () => {
    await mount(binding());
    scene!.updateMatrixWorld(true);
    // 상자 한가운데를 위에서 아래로 꿰뚫는 광선.
    const ray = () => new THREE.Raycaster(new Vector3(3, 5, -4.5), new Vector3(0, -1, 0));
    const preview = named('box-edit-preview')[0]!;
    const fill = preview.getObjectByProperty('type', 'Mesh') as Mesh;
    const raw: THREE.Intersection[] = [];
    THREE.Mesh.prototype.raycast.call(fill, ray(), raw);
    expect(raw.length).toBeGreaterThan(0); // 광선이 상자를 실제로 지난다(대조).
    const hits: THREE.Intersection[] = [];
    preview.traverse((o) => o.raycast(ray(), hits));
    expect(hits).toHaveLength(0);

    const picks = named('box-edit-pick:');
    expect(picks).toHaveLength(7);
    for (const pick of picks) {
      expect(Object.keys(handlersOf(pick)).sort()).toEqual([
        'onPointerDown',
        'onPointerMove',
        'onPointerOut',
      ]);
      expect((pick as Mesh).material).toMatchObject({ visible: false });
    }
    // x+ 화살표 몸통(x+ 면 x=4 바깥)을 위에서 꿰뚫는 광선: 보이는 형상은 판정에서 빠지고 판정 메시만 맞는다.
    const arrowRay = () => new THREE.Raycaster(new Vector3(4.5, 5, -4.5), new Vector3(0, -1, 0));
    const arrow = named('box-edit-handle:x+')[0]!;
    const visible: THREE.Intersection[] = [];
    for (const child of arrow.children.slice(0, 2)) child.raycast(arrowRay(), visible);
    expect(visible).toHaveLength(0);
    const picked: THREE.Intersection[] = [];
    named('box-edit-pick:x+')[0]!.raycast(arrowRay(), picked);
    expect(picked).toHaveLength(1);
  });

  it('보관 초안은 점선 윤곽으로 그리되, 지금 편집하는 id 는 건너뛰고 클릭을 받지 않는다', async () => {
    await mount(
      binding({
        boxGhosts: [
          { id: 'z-01', box: BOX },
          { id: 'z-02', box: { min: [6, 6, 0], max: [8, 8, 1] } },
          { id: 'bad', box: { min: [1, 1, 1], max: [0, 0, 0] } },
        ],
      }),
    );
    const ghosts = named('box-edit-ghost:');
    expect(ghosts.map((o) => o.name)).toEqual(['box-edit-ghost:z-02']);
    const hits: THREE.Intersection[] = [];
    ghosts[0]!.traverse((o) =>
      o.raycast(new THREE.Raycaster(new Vector3(7, 5, -7), new Vector3(0, -1, 0)), hits),
    );
    expect(hits).toHaveLength(0);
    // 편집을 끝내면 같은 id 의 초안도 그린다.
    await mount(binding({ boxEdit: null, boxGhosts: [{ id: 'z-01', box: BOX }] }));
    expect(named('box-edit-ghost:').map((o) => o.name)).toEqual(['box-edit-ghost:z-01']);
  });

  it('테마에 따라 손잡이 색이 바뀐다', async () => {
    await mount(binding());
    const shaftColor = () =>
      ((named('box-edit-handle:x+')[0]!.children[0] as Mesh).material as THREE.MeshBasicMaterial)
        .color;
    expect(shaftColor().getHexString()).toBe('ef6f6f');
    await act(async () => void viewer.getState().setTheme('light'));
    expect(shaftColor().getHexString()).toBe('d64545');
  });

  it('호버는 키우고 밝히며 잡을 수 있는 커서를, 놓으면 되돌린다', async () => {
    await mount(binding());
    const group = () => named('box-edit-handle:y+')[0]!;
    const pick = () => named('box-edit-pick:y+')[0]!;
    const color = () => ((group().children[0] as Mesh).material as THREE.MeshBasicMaterial).color;
    expect(group().scale.x).toBe(1);
    await act(async () => handlersOf(pick()).onPointerMove!({ intersections: [] }));
    expect(group().scale.x).toBeCloseTo(1.12, 6);
    expect(color().getHexString()).not.toBe('6cc070');
    expect(canvas!.style.cursor).toBe('grab');
    await act(async () => handlersOf(pick()).onPointerOut!({}));
    expect(group().scale.x).toBe(1);
    expect(canvas!.style.cursor).toBe('');
  });

  it('겹친 판정에서는 가운데 구가 먼저 잡히고 화살표 처리기는 물러난다', async () => {
    await mount(binding());
    const arrow = named('box-edit-pick:x+')[0]!;
    const move = named('box-edit-pick:move')[0]!;
    const stopPropagation = vi.fn();
    const event = {
      stopPropagation,
      button: 0,
      nativeEvent: screen(sceneCamera!, three(...CENTER)),
      intersections: [{ object: arrow }, { object: move }],
    };
    await act(async () => handlersOf(arrow).onPointerDown!(event));
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(controls.enabled).toBe(true);
    await act(async () => handlersOf(move).onPointerDown!(event));
    expect(stopPropagation).toHaveBeenCalled();
    expect(controls.enabled).toBe(false);
    await act(async () => void window.dispatchEvent(new MouseEvent('pointerup')));
    expect(controls.enabled).toBe(true);
  });

  it('끄는 동안 다른 손잡이는 흐려지고 커서는 잡은 모양이며, 놓으면 되돌린다', async () => {
    const onBoxEditChange = vi.fn();
    await mount(binding({ onBoxEditChange }));
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    const ringOpacity = () =>
      ((named('box-edit-handle:move')[0]!.children[0] as Mesh).material as THREE.Material).opacity;
    expect(ringOpacity()).toBeCloseTo(0.85, 6);
    await act(async () =>
      handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, x(1)),
        intersections: [],
      }),
    );
    expect(ringOpacity()).toBeCloseTo(0.85 * 0.35, 6);
    expect(canvas!.style.cursor).toBe('grabbing');
    await act(async () =>
      window.dispatchEvent(
        new MouseEvent('pointermove', { ...screen(sceneCamera!, x(1.5)), buttons: 1 }),
      ),
    );
    expect(onBoxEditChange).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [4.5, 6, 2] });
    await act(async () => void window.dispatchEvent(new MouseEvent('pointerup')));
    expect(ringOpacity()).toBeCloseTo(0.85, 6);
    expect(canvas!.style.cursor).toBe('');
  });

  it('뷰어에 스캔이 보이면 끄는 범위를 스캔 경계로 가두고, 숨겨지면 목업 교실 범위로 돌아간다', async () => {
    const sceneStore = createSceneStore();
    const boundsWorld: SceneLoad['boundsWorld'] = { min: [1, 2, 0], max: [4.5, 9, 3] };
    sceneStore
      .getState()
      .setLoad({ ...IDLE_LOAD, phase: 'LOADED', sceneVersion: 's', boundsWorld });
    sceneStore.getState().setDisplay('FULL');
    const onBoxEditChange = vi.fn();
    await mount(binding({ onBoxEditChange }), false, sceneStore);
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    const dragFar = async () => {
      await act(async () =>
        handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
          stopPropagation: () => {},
          button: 0,
          nativeEvent: screen(sceneCamera!, x(1)),
          intersections: [],
        }),
      );
      await act(async () =>
        window.dispatchEvent(
          new MouseEvent('pointermove', { ...screen(sceneCamera!, x(1 + 6)), buttons: 1 }),
        ),
      );
      await act(async () => void window.dispatchEvent(new MouseEvent('pointerup')));
    };

    await dragFar();
    expect(onBoxEditChange).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [4.5, 6, 2] });

    await act(async () => sceneStore.getState().setDisplay('HIDDEN'));
    await dragFar();
    expect(onBoxEditChange).toHaveBeenLastCalledWith({ min: [2, 3, 0], max: [10, 6, 2] });
  });

  it('ID 가 바뀌면 끌던 조작이 끝나고 카메라 조작이 돌아오며, 이후 움직임은 알리지 않는다', async () => {
    const onBoxEditChange = vi.fn();
    await mount(binding({ onBoxEditChange }), true);
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    await act(async () =>
      handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, x(1)),
        intersections: [],
      }),
    );
    expect(controls.enabled).toBe(false);
    await mount(
      binding({ onBoxEditChange, boxEdit: { id: 'surface:z-01', kind: 'surface', box: BOX } }),
      true,
    );
    expect(controls.enabled).toBe(true);
    expect(canvas!.style.cursor).toBe('');
    await act(async () =>
      window.dispatchEvent(
        new MouseEvent('pointermove', { ...screen(sceneCamera!, x(2)), buttons: 1 }),
      ),
    );
    expect(onBoxEditChange).not.toHaveBeenCalled();
  });

  it('조작기가 내려가면(boxEdit null·내려감) 끌던 조작이 끝나고 카메라 조작이 돌아온다', async () => {
    const onBoxEditChange = vi.fn();
    await mount(binding({ onBoxEditChange }));
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    await act(async () =>
      handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, x(1)),
        intersections: [],
      }),
    );
    expect(controls.enabled).toBe(false);
    await mount(binding({ onBoxEditChange, boxEdit: null }));
    expect(controls.enabled).toBe(true);
    expect(canvas!.style.cursor).toBe('');
    // 끝난 조작기라 손잡이도 없다.
    expect(named('box-edit-pick:')).toHaveLength(0);
  });

  it('언마운트도 끌던 조작을 끝낸다', async () => {
    await mount(binding());
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    await act(async () =>
      handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, x(1)),
        intersections: [],
      }),
    );
    expect(controls.enabled).toBe(false);
    await act(async () => root!.unmount());
    root = null;
    expect(controls.enabled).toBe(true);
  });

  it('Esc 는 끌기 전 상자를 호스트에 올린다', async () => {
    const onBoxEditChange = vi.fn();
    await mount(binding({ onBoxEditChange }));
    const x = (m: number) => three(CENTER[0] + m, CENTER[1], CENTER[2]);
    await act(async () =>
      handlersOf(named('box-edit-pick:x+')[0]!).onPointerDown!({
        stopPropagation: () => {},
        button: 0,
        nativeEvent: screen(sceneCamera!, x(1)),
        intersections: [],
      }),
    );
    await act(async () =>
      window.dispatchEvent(
        new MouseEvent('pointermove', { ...screen(sceneCamera!, x(1.5)), buttons: 1 }),
      ),
    );
    expect(onBoxEditChange).toHaveBeenCalledTimes(1);
    await act(
      async () =>
        void window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
        ),
    );
    expect(onBoxEditChange).toHaveBeenCalledTimes(2);
    expect(onBoxEditChange).toHaveBeenLastCalledWith(BOX);
    expect(controls.enabled).toBe(true);
  });
});

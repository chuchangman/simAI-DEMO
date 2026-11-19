import {
  arrowAxis,
  AXIS_DIRECTION_THREE,
  boxCenter,
  closestAxisParam,
  copyBox,
  dragBox,
  isDrawableBox,
  sameBoxValues,
  type BoxEditHandle,
  type Vec3,
} from '@/features/viewer3d/editing/boxEdit';
import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import { createPlaneReader, dragPlane } from '@/features/viewer3d/editing/handleInput';
import { worldPoint, worldToThree } from '@/features/viewer3d/worldCoordinates';
import type { RoomLimit } from '@/lib/roomLimit';
import type { RootState, ThreeEvent } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3 } from 'three';

// 제어형 상자 편집 조작기의 끌기 하나를 맡는 React 바깥 객체. 손잡이를 잡으면 창에 포인터·키 처리기를 걸고, 끝나면 모두 뗀다.

/** 호스트에 새 상자를 올리는 함수. */
export type BoxEditEmit = (box: ViewerEditBox) => void;
type Controls = { enabled: boolean };
/** 화면 좌표(client px)에서 끌기 축·평면 위의 값(World m)을 읽는 함수. 읽을 수 없으면 null. */
type Sampler = (clientX: number, clientY: number) => Vec3 | null;

/** PointerEvent.buttons 의 왼쪽 버튼 비트. */
const PRIMARY_BUTTONS = 1;
/** 한글 등 조합 중인 키의 keyCode. */
const IME_KEY_CODE = 229;

/** 화면 좌표(client px)를 Three 장면의 광선(원점·단위 방향)으로 읽는다. */
function createRayReader(get: () => RootState) {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  return (clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } | null => {
    const { camera, gl } = get();
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  };
}

/** 화살표용: 마우스 광선과 축 직선(anchor 를 지나는 그 면의 축)의 최근접점을 축 위의 길이로 읽는다. */
function createAxisSampler(get: () => RootState, axis: 0 | 1 | 2, anchor: Vec3): Sampler {
  const direction = AXIS_DIRECTION_THREE[axis];
  const readRay = createRayReader(get);
  return (clientX, clientY) => {
    const ray = readRay(clientX, clientY);
    const length = ray && closestAxisParam(ray.origin, ray.direction, anchor, direction);
    if (length === null || length === undefined) return null;
    const along: [number, number, number] = [0, 0, 0];
    along[axis] = length;
    return along;
  };
}

/** 손잡이별 읽기 함수. 화살표는 축 직선, 가운데 구는 손잡이 높이의 수평 평면에서 읽는다. 평면을 못 만들면 null. */
function createSampler(get: () => RootState, handle: BoxEditHandle, anchor: Vec3): Sampler | null {
  if (handle !== 'move') return createAxisSampler(get, arrowAxis(handle), anchor);
  const plane = dragPlane(get, new Vector3(anchor[0], anchor[1], anchor[2]), false);
  return plane && createPlaneReader(get, plane);
}

interface WindowHandlers {
  onMove: (event: PointerEvent) => void;
  onUp: () => void;
  onEscape: () => void;
}

/** 끄는 동안 창에 처리기를 건다. 돌려주는 함수가 모두 뗀다. */
function listenWindow({ onMove, onUp, onEscape }: WindowHandlers): () => void {
  // 끄는 동안의 Esc 는 끌기만 되돌리고 다른 Esc 처리기(편집 취소 등)에 넘기지 않는다.
  const onKey = (key: KeyboardEvent) => {
    if (key.key !== 'Escape' || key.isComposing || key.keyCode === IME_KEY_CODE) return;
    key.preventDefault();
    key.stopImmediatePropagation();
    onEscape();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey, true);
  };
}

/**
 * 손잡이 끌기 하나를 맡는다. React 바깥 객체라 매 움직임에 다시 그리지 않는다.
 * sync() 로 호스트가 내려 준 최신 상자·알림 함수와 지금 교실 범위를 받고, 끌면 emit(새 상자)를 부른다. end() 는 여러 번 불러도 안전하다.
 */
export function createBoxEditDrag(
  get: () => RootState,
  setDragging: (handle: BoxEditHandle | null) => void,
) {
  let input: { box: ViewerEditBox; emit: BoxEditEmit | undefined; limit: RoomLimit } | null = null;
  let active: {
    from: ViewerEditBox;
    changed: boolean;
    controlsWereEnabled: boolean | null;
    detach: () => void;
  } | null = null;

  const end = () => {
    const current = active;
    if (!current) return;
    active = null;
    current.detach();
    const controls = get().controls as Controls | null;
    if (controls && current.controlsWereEnabled !== null) {
      controls.enabled = current.controlsWereEnabled;
    }
    setDragging(null);
  };

  /** 지금 호스트가 그리는 상자와 알림 함수, 상자를 움직일 수 있는 교실 범위. 렌더마다(커밋 뒤) 부른다. */
  const sync = (box: ViewerEditBox, emit: BoxEditEmit | undefined, limit: RoomLimit) => {
    input = { box, emit, limit };
  };

  /** Esc. 끄는 중이면 끌기를 끝내고 시작 전 상자로 되돌린다(true). 아니면 아무것도 하지 않는다(false). */
  const escape = () => {
    const current = active;
    if (!current) return false;
    const changed = current.changed || (input !== null && !sameBoxValues(input.box, current.from));
    const emit = input?.emit;
    end();
    if (changed) emit?.(copyBox(current.from));
    return true;
  };

  /** 포인터 움직임 하나: 시작점 대비 끈 길이로 새 상자를 계산해 올린다. */
  const follow = (handle: BoxEditHandle, sample: Sampler, origin: Vec3) => (move: PointerEvent) => {
    // 창 밖에서 놓아 pointerup 을 받지 못했으면 다음 움직임에서 왼쪽 버튼이 떨어져 있다.
    if ((move.buttons & PRIMARY_BUTTONS) === 0) {
      end();
      return;
    }
    const current = active;
    const now = sample(move.clientX, move.clientY);
    if (!current || !input || !now) return;
    const next = dragBox(
      current.from,
      handle,
      [now[0] - origin[0], now[1] - origin[1], now[2] - origin[2]],
      input.limit,
    );
    // 맞춘 결과가 지금 상자와 같으면 알리지 않는다.
    if (sameBoxValues(next, input.box)) return;
    current.changed = true;
    input.emit?.(next);
  };

  const start = (handle: BoxEditHandle, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button !== 0 || active || !input) return;
    const from = input.box;
    if (!isDrawableBox(from)) return;
    const center = boxCenter(from);
    const anchor: Vec3 = worldToThree(worldPoint(center[0], center[1], center[2]));
    const sample = createSampler(get, handle, anchor);
    const origin = sample?.(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!sample || !origin) return;

    const detach = listenWindow({
      onMove: follow(handle, sample, origin),
      onUp: end,
      onEscape: escape,
    });
    const controls = get().controls as Controls | null;
    active = {
      from,
      changed: false,
      controlsWereEnabled: controls ? controls.enabled : null,
      detach,
    };
    // OrbitControls 는 같은 pointerdown 을 먼저 받아 회전을 시작했을 수 있다. 끄면 이후 움직임을 무시한다.
    if (controls) controls.enabled = false;
    setDragging(handle);
  };

  return { sync, start, end, escape };
}

export type BoxEditDrag = ReturnType<typeof createBoxEditDrag>;

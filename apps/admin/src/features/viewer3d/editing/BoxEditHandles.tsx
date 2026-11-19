import {
  arrowAxis,
  arrowSign,
  BOX_EDIT_HANDLES,
  boxCenter,
  handleRank,
  type BoxEditArrow,
  type BoxEditHandle,
} from '@/features/viewer3d/editing/boxEdit';
import type { BoxEditDrag } from '@/features/viewer3d/editing/boxEditDrag';
import {
  ARROW_OPACITY,
  ARROW_ORDER,
  ARROW_QUATERNION,
  DOT,
  DOT_OPACITY,
  GIZMO_K,
  handleOpacity,
  handleTint,
  HEAD,
  HOVER_SCALE,
  MOVE_ORDER,
  noRaycast,
  PICK_AXIS,
  PICK_AXIS_OFFSET,
  PICK_DOT,
  RING,
  RING_OPACITY,
  SHAFT,
} from '@/features/viewer3d/editing/boxEditStyle';
import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import { createHandleRaycast } from '@/features/viewer3d/editing/handleInput';
import type { ViewerTheme } from '@/features/viewer3d/palette';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import {
  worldPoint,
  worldToThree,
  type ThreeBox,
  type ThreePoint,
} from '@/features/viewer3d/worldCoordinates';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { DoubleSide, Vector3, type Color, type Group, type Mesh } from 'three';
import { useStore } from 'zustand';

// 제어형 상자 편집 조작기의 손잡이: 가운데 구(바닥 이동)와 면별 화살표. 그리기와 포인터 이벤트 연결만 맡고 끌기 계산은 boxEditDrag 가 한다.
// 화살표는 그 면의 바깥 가운데에 놓아 가운데 구와 겹치지 않게 하고 어느 면이 움직이는지 보이게 한다(S15P31A101-651). 화살표가
// 놓인 곳은 끌기 축(상자 가운데를 지나는 그 축 직선) 위라 끌기 계산은 그대로다.

type HandleRaycast = ReturnType<typeof createHandleRaycast>;

/** 판정 형상의 userData. pickedHandle 이 겹친 판정 중 어느 손잡이 것인지 읽는다(렌더마다 새로 만들지 않는다). */
const PICK_DATA = Object.fromEntries(
  BOX_EDIT_HANDLES.map((handle) => [handle, { boxEditHandle: handle }]),
) as Record<BoxEditHandle, { boxEditHandle: BoxEditHandle }>;

interface HandleEvents {
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
}

/** 손잡이 하나를 그리는 데 필요한 값. */
interface HandleViewProps {
  theme: ViewerTheme;
  /** 호버 중이거나 끄는 중이다. */
  on: boolean;
  /** 다른 손잡이를 끄는 중이다. */
  faded: boolean;
  raycast: HandleRaycast;
  events: HandleEvents;
}

/** 겹친 손잡이 중 순서가 가장 앞선 것(가운데 구 → 화살표, 같으면 가까운 것). 판정 정보가 없으면 받은 손잡이 그대로다. */
function pickedHandle(event: ThreeEvent<PointerEvent>, own: BoxEditHandle): BoxEditHandle {
  let best: BoxEditHandle | null = null;
  for (const hit of event.intersections ?? []) {
    const handle = hit.object.userData['boxEditHandle'] as BoxEditHandle | undefined;
    if (handle && (best === null || handleRank(handle) < handleRank(best))) best = handle;
  }
  return best ?? own;
}

const worldPosition = new Vector3();

/** 카메라 거리에 비례해 키워 화면에서 늘 같은 크기로 보이게 하는 묶음. ring 을 주면 그 링이 카메라를 향하게 한다. */
function ScreenSized({
  name,
  position,
  ring,
  children,
}: {
  name: string;
  position: ThreePoint;
  ring?: RefObject<Mesh | null>;
  children: ReactNode;
}) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    if (!group.current) return;
    group.current.getWorldPosition(worldPosition);
    group.current.scale.setScalar(camera.position.distanceTo(worldPosition) * GIZMO_K);
    ring?.current?.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={group} name={name} position={position}>
      {children}
    </group>
  );
}

/** 화살표를 놓을 그 면의 가운데(World 상자 → Three). 상자 가운데에서 그 축만 움직이는 면(최소·최대)으로 옮긴다. */
function faceCenter(box: ViewerEditBox, arrow: BoxEditArrow): ThreePoint {
  const center = [...boxCenter(box)] as [number, number, number];
  const axis = arrowAxis(arrow);
  center[axis] = arrowSign(arrow) > 0 ? box.max[axis] : box.min[axis];
  return worldToThree(worldPoint(center[0], center[1], center[2]));
}

interface BoxHandlesProps {
  box: ThreeBox;
  /** 같은 상자의 World 값. 화살표를 놓을 면의 가운데를 여기서 잰다. */
  worldBox: ViewerEditBox;
  /** 보여 줄 손잡이(move 가 맨 앞). */
  handles: readonly BoxEditHandle[];
  hovered: BoxEditHandle | null;
  dragging: BoxEditHandle | null;
  drag: BoxEditDrag;
  onHover: Dispatch<SetStateAction<BoxEditHandle | null>>;
}

/** 손잡이 묶음: 가운데 구는 상자 가운데, 화살표는 각 면의 바깥 가운데. 호버·끌기 상태는 부모가 쥐고 여기서는 모양만 정한다. */
export function BoxHandles({
  box,
  worldBox,
  handles,
  hovered,
  dragging,
  drag,
  onHover,
}: BoxHandlesProps) {
  const get = useThree((s) => s.get);
  const theme = useStore(useViewerStore(), (s) => s.theme);
  const [raycast] = useState(() => createHandleRaycast(get));
  const ring = useRef<Mesh>(null);

  const eventsOf = (handle: BoxEditHandle): HandleEvents => ({
    onPointerDown: (event) => {
      if (pickedHandle(event, handle) === handle) drag.start(handle, event);
    },
    onPointerMove: (event) => {
      if (pickedHandle(event, handle) === handle) onHover(handle);
    },
    onPointerOut: () => onHover((current) => (current === handle ? null : current)),
  });

  return (
    <group name="box-edit-handles">
      {handles.map((handle) => {
        const on = dragging ? dragging === handle : hovered === handle;
        const view = {
          theme,
          on,
          faded: dragging !== null && !on,
          raycast,
          events: eventsOf(handle),
        };
        return handle === 'move' ? (
          <ScreenSized key={handle} name="box-edit-at:move" position={box.position} ring={ring}>
            <MoveHandle ringRef={ring} {...view} />
          </ScreenSized>
        ) : (
          <ScreenSized
            key={handle}
            name={`box-edit-at:${handle}`}
            position={faceCenter(worldBox, handle)}
          >
            <ArrowHandle handle={handle} {...view} />
          </ScreenSized>
        );
      })}
    </group>
  );
}

/** 가운데 구와 링. 바닥(수평 평면)에서만 옮기는 손잡이다. */
function MoveHandle({
  ringRef,
  theme,
  on,
  faded,
  raycast,
  events,
}: HandleViewProps & { ringRef: RefObject<Mesh | null> }) {
  return (
    <group name="box-edit-handle:move" scale={on ? HOVER_SCALE : 1}>
      <mesh ref={ringRef} geometry={RING} raycast={noRaycast} renderOrder={MOVE_ORDER}>
        <HandleMaterial
          color={handleTint(theme, 'ring', on)}
          opacity={handleOpacity(RING_OPACITY, on, faded)}
        />
      </mesh>
      <mesh geometry={DOT} raycast={noRaycast} renderOrder={MOVE_ORDER}>
        <HandleMaterial
          color={handleTint(theme, 'move', on)}
          opacity={handleOpacity(DOT_OPACITY, on, faded)}
        />
      </mesh>
      <mesh
        name="box-edit-pick:move"
        geometry={PICK_DOT}
        userData={PICK_DATA.move}
        raycast={raycast}
        {...events}
      >
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

/** 한 면만 움직이는 화살표. 몸통·화살촉과 보이지 않는 판정 형상으로 이뤄진다. */
function ArrowHandle({
  handle,
  theme,
  on,
  faded,
  raycast,
  events,
}: HandleViewProps & { handle: BoxEditArrow }) {
  const color = handleTint(theme, handle[0] as 'x' | 'y' | 'z', on);
  const opacity = handleOpacity(ARROW_OPACITY, on, faded);
  return (
    <group
      name={`box-edit-handle:${handle}`}
      quaternion={ARROW_QUATERNION[handle]}
      scale={on ? HOVER_SCALE : 1}
    >
      <mesh geometry={SHAFT} raycast={noRaycast} renderOrder={ARROW_ORDER}>
        <HandleMaterial color={color} opacity={opacity} />
      </mesh>
      <mesh geometry={HEAD} raycast={noRaycast} renderOrder={ARROW_ORDER}>
        <HandleMaterial color={color} opacity={opacity} />
      </mesh>
      <mesh
        name={`box-edit-pick:${handle}`}
        geometry={PICK_AXIS}
        position={[0, PICK_AXIS_OFFSET, 0]}
        userData={PICK_DATA[handle]}
        raycast={raycast}
        {...events}
      >
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

/** 손잡이 재질. 깊이 판정을 끄고 양면을 그려 상자·벽에 가려지지 않는다. */
function HandleMaterial({ color, opacity }: { color: Color; opacity: number }) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
      side={DoubleSide}
    />
  );
}

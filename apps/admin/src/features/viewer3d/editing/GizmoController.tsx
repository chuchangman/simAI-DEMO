import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import type { WorldBox } from '@/features/viewer3d/editing/editGeometry';
import type { EditHandle, EditStore } from '@/features/viewer3d/editing/editSession.store';
import { useEditStore } from '@/features/viewer3d/editing/EditStoreContext';
import {
  createHandleRaycast,
  MIN_PLANE_COSINE,
  useEditKeys,
} from '@/features/viewer3d/editing/handleInput';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { sameTarget } from '@/features/viewer3d/target';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import {
  threeToWorld,
  toThreePoint,
  worldBoxToThree,
  worldPoint,
  worldToThree,
  type WorldPoint,
} from '@/features/viewer3d/worldCoordinates';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import { previewLabel } from '@/features/viewer3d/zones/zonePresentation';
import { Line } from '@react-three/drei';
import { useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import {
  BoxGeometry,
  ConeGeometry,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { useStore } from 'zustand';

// 공통 3D 조작기(S15P31A101-195). 선택된 구역 하나에만 붙고, 원본 구역(ZoneLayer)은 그대로 두고 초안만 따로 그린다.
// TransformControls 의 중심 기준 Scale 은 z_min·z_max 를 따로 바꾸지 못해 쓰지 않는다. 대신 X·Y 이동 손잡이 하나와
// 면마다 경계 손잡이(반대 면 고정)를 둔다. 회전 손잡이는 만들지 않는다(AABB 는 회전·기울임 금지).
// 끄는 동안 카메라 OrbitControls 를 끄고, 놓기·Esc·버튼이 떨어진 움직임(창 밖에서 놓음)·선택 변경·취소·내려감에서
// 끄기 전 상태로 되돌린다.

const noRaycast = () => null;
/** 높이 손잡이를 상자 위·아래로 띄우는 거리(m). 이동 손잡이(윗면 가운데)와 겹치지 않게 한다. */
const Z_HANDLE_GAP = 0.35;
const PREVIEW_COLOR = '#c4a7ff';
const HANDLE_COLORS: Record<EditHandle, string> = {
  move: '#f2c14e',
  'x-': '#ef6f6f',
  'x+': '#ef6f6f',
  'y-': '#6cc070',
  'y+': '#6cc070',
  'z-': '#5b9cf0',
  'z+': '#5b9cf0',
};
const UP = new Vector3(0, 1, 0);
export const EDIT_HANDLES: readonly EditHandle[] = ['move', 'x-', 'x+', 'y-', 'y+', 'z-', 'z+'];

/** 손잡이에 마우스를 올렸거나 끄는 동안 보이는 짧은 설명. 무엇이 움직이고 무엇이 고정되는지 적는다. */
export const HANDLE_HINTS: Record<EditHandle, string> = {
  move: '구역 전체 이동 · X/Y (폭·깊이·높이 유지)',
  'x-': 'X− 경계 · 반대쪽 X+ 고정',
  'x+': 'X+ 경계 · 반대쪽 X− 고정',
  'y-': 'Y− 경계 · 반대쪽 Y+ 고정',
  'y+': 'Y+ 경계 · 반대쪽 Y− 고정',
  'z-': '하단(z_min) · 상단 고정',
  'z+': '상단(z_max) · 하단 고정',
};

// 손잡이 형상은 모듈에 하나씩만 둔다(끌 때마다 새로 만들지 않는다).
const FACE_GEOMETRY = new BoxGeometry(0.16, 0.16, 0.16);
const MOVE_GEOMETRY = new SphereGeometry(0.18, 24, 16);
const Z_GEOMETRY = new ConeGeometry(0.1, 0.22, 16);
const UNIT_EDGES = boxEdges([1, 1, 1]);

/** 손잡이의 World 위치. 이동은 상자 기하 중심, 면은 그 면 가운데, 높이는 위·아래로 조금 띄운 곳이다. */
export function handleWorld(box: WorldBox, handle: EditHandle): WorldPoint {
  const c = [0, 1, 2].map((i) => (box.min[i]! + box.max[i]!) / 2);
  const [cx, cy, cz] = [c[0]!, c[1]!, c[2]!];
  switch (handle) {
    case 'move':
      return worldPoint(cx, cy, cz);
    case 'x-':
      return worldPoint(box.min[0], cy, cz);
    case 'x+':
      return worldPoint(box.max[0], cy, cz);
    case 'y-':
      return worldPoint(cx, box.min[1], cz);
    case 'y+':
      return worldPoint(cx, box.max[1], cz);
    case 'z-':
      return worldPoint(cx, cy, box.min[2] - Z_HANDLE_GAP);
    case 'z+':
      return worldPoint(cx, cy, box.max[2] + Z_HANDLE_GAP);
  }
}

type Controls = { enabled: boolean };

/**
 * 손잡이 끌기 하나를 맡는다. React 바깥 객체라 매 움직임에 다시 그리지 않고 초안만 Store 에 넣는다.
 * end() 는 여러 번 불러도 안전하다.
 */
export function createHandleDrag(store: EditStore, get: () => RootState) {
  let active: { from: WorldBox; controlsWereEnabled: boolean | null; detach: () => void } | null =
    null;

  const end = () => {
    const current = active;
    if (!current) return;
    active = null;
    current.detach();
    const controls = get().controls as Controls | null;
    if (controls && current.controlsWereEnabled !== null) {
      controls.enabled = current.controlsWereEnabled;
    }
    store.getState().setDragging(null);
  };

  const start = (handle: EditHandle, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button !== 0 || active) return;
    const session = store.getState().session;
    if (!session) return;
    const { camera, gl } = get();
    const anchor = new Vector3(...worldToThree(handleWorld(session.draft, handle)));
    const plane = new Plane();
    if (handle === 'z-' || handle === 'z+') {
      // 높이는 카메라를 마주 보는 세로 평면 위에서 읽는다.
      const normal = camera.getWorldDirection(new Vector3()).setY(0);
      if (normal.lengthSq() < MIN_PLANE_COSINE ** 2) return;
      plane.setFromNormalAndCoplanarPoint(normal.normalize(), anchor);
    } else {
      // X·Y 는 손잡이 높이의 수평 평면 위에서 읽는다. 이 평면에서는 높이(Z)가 바뀌지 않는다.
      plane.setFromNormalAndCoplanarPoint(UP, anchor);
    }
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const worldAt = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (Math.abs(raycaster.ray.direction.dot(plane.normal)) < MIN_PLANE_COSINE) return null;
      const point = raycaster.ray.intersectPlane(plane, new Vector3());
      const three = point && toThreePoint([point.x, point.y, point.z]);
      return three ? threeToWorld(three) : null;
    };
    const origin = worldAt(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!origin) return;
    const from = session.draft;

    const onMove = (move: PointerEvent) => {
      // 창 밖에서 놓아 pointerup 을 받지 못했으면(다른 창으로 이동 등) 다음 움직임에서 왼쪽 버튼이 떨어져 있다.
      if ((move.buttons & 1) === 0) {
        end();
        return;
      }
      const now = worldAt(move.clientX, move.clientY);
      if (!now || !active) return;
      const d = [now[0] - origin[0], now[1] - origin[1], now[2] - origin[2]] as const;
      if (handle === 'move') {
        store.getState().preview(from, { type: 'translate', delta: [d[0], d[1], 0] });
        return;
      }
      const axis = { x: 0, y: 1, z: 2 }[handle[0] as 'x' | 'y' | 'z'];
      store.getState().preview(from, { type: 'face', face: handle, delta: d[axis] });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    const controls = get().controls as Controls | null;
    active = {
      from,
      controlsWereEnabled: controls ? controls.enabled : null,
      detach: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      },
    };
    // OrbitControls 는 같은 pointerdown 을 먼저 받아 회전을 시작했을 수 있다. 끄면 이후 움직임을 무시한다.
    if (controls) controls.enabled = false;
    store.getState().setDragging(handle);
  };

  /** Esc. 끄는 중이면 그 끌기만 되돌리고, 아니면 편집을 취소한다. */
  const escape = () => {
    const current = active;
    if (current) {
      end();
      store.getState().restoreDraft(current.from);
      return;
    }
    store.getState().cancel('USER');
  };

  /** Enter. 끄는 중이 아닐 때 현재 초안을 미리보기로 확정(유지)하고 손잡이를 내린다. */
  const enter = () => {
    if (active) return;
    store.getState().finish();
  };

  return { start, end, escape, enter };
}

export function GizmoController() {
  const edit = useEditStore();
  return edit ? <GizmoForStore store={edit} /> : null;
}

function GizmoForStore({ store }: { store: EditStore }) {
  const target = useStore(store, (s) => s.session?.target ?? null);
  const selected = useStore(useViewerStore(), (s) => s.selected);
  if (!target || !sameTarget(selected, target)) return null;
  return <AabbGizmo store={store} />;
}

function AabbGizmo({ store }: { store: EditStore }) {
  const get = useThree((s) => s.get);
  const [drag] = useState(() => createHandleDrag(store, get));
  const [hovered, setHovered] = useState<EditHandle | null>(null);
  const draft = useStore(store, (s) => s.session?.draft ?? null);
  const settled = useStore(store, (s) => s.session?.settled ?? null);
  const dragging = useStore(store, (s) => s.session?.dragging ?? null);
  const refused = useStore(store, (s) => s.session?.refused ?? null);
  const zoneId = useStore(store, (s) => s.session?.target.id ?? '');
  const zone = useSpatialData((s) =>
    s.zones.zones.find((candidate) => candidate.zoneId === zoneId),
  );
  const [handleRaycast] = useState(() => createHandleRaycast(get));

  // 내려가면(선택 변경·취소·완료·오류·StrictMode 재마운트) 끌기를 끝내고 카메라 조작을 되돌린다.
  useEffect(() => () => drag.end(), [drag]);
  // 손잡이 위에서는 잡을 수 있다는 커서, 끄는 동안은 잡은 커서를 보인다. 내려가면 되돌린다.
  const cursor = dragging ? 'grabbing' : hovered ? 'grab' : '';
  useEffect(() => {
    const canvas = get().gl.domElement;
    canvas.style.cursor = cursor;
    return () => {
      canvas.style.cursor = '';
    };
  }, [get, cursor]);
  useEditKeys(drag.escape, drag.enter);

  const box = draft && worldBoxToThree(draft.min, draft.max);
  if (!draft || !settled || !box || !zone) return null;
  const [sx, sy, sz] = box.size;
  const hint = dragging ?? hovered;
  return (
    <group name="edit-gizmo">
      {/* 초안(미리보기). 원본 구역과 따로 그리며 클릭을 받지 않는다(사람·원본 구역 선택을 가리지 않는다). */}
      <group name="edit-preview" position={box.position}>
        <group scale={[sx, sy, sz]}>
          <mesh raycast={noRaycast} renderOrder={5}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial
              color={PREVIEW_COLOR}
              transparent
              opacity={0.12}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={UNIT_EDGES}
            segments
            color={PREVIEW_COLOR}
            lineWidth={2}
            raycast={noRaycast}
          />
        </group>
        {/* 좌표는 편집 패널에서 읽는다. 끄는 동안 텍스처를 새로 만들지 않는다. */}
        <LabelSprite
          text={
            refused ? `${previewLabel(zone)} · 편집 거부 · ${refused.detail}` : previewLabel(zone)
          }
          y={sy / 2 + Z_HANDLE_GAP + 0.3}
          height={0.22}
          color={refused ? '#ffb4b4' : PREVIEW_COLOR}
        />
      </group>
      {EDIT_HANDLES.map((handle) => {
        const active = hint === handle;
        return (
          <mesh
            key={handle}
            name={`edit-handle:${handle}`}
            position={worldToThree(handleWorld(draft, handle))}
            scale={active ? 1.2 : 1}
            geometry={geometryOf(handle)}
            raycast={handleRaycast}
            rotation={handle === 'z-' ? [Math.PI, 0, 0] : undefined}
            renderOrder={20}
            onPointerDown={(event) => drag.start(handle, event)}
            onPointerOver={(event) => {
              event.stopPropagation();
              setHovered(handle);
            }}
            onPointerOut={() => setHovered((current) => (current === handle ? null : current))}
          >
            <meshBasicMaterial
              color={HANDLE_COLORS[handle]}
              transparent
              opacity={active ? 1 : dragging ? 0.35 : 0.82}
              depthTest={false}
            />
          </mesh>
        );
      })}
      {hint && (
        <group position={worldToThree(handleWorld(settled, hint))}>
          <LabelSprite text={HANDLE_HINTS[hint]} y={0.32} height={0.2} color="#f5f5f5" />
        </group>
      )}
    </group>
  );
}

function geometryOf(handle: EditHandle): BufferGeometry {
  if (handle === 'move') return MOVE_GEOMETRY;
  return handle[0] === 'z' ? Z_GEOMETRY : FACE_GEOMETRY;
}

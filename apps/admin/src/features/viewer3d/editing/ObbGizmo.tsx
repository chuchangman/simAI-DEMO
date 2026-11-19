import type { WorldObb } from '@/features/viewer3d/editing/editGeometry';
import {
  objectEditHandles,
  type EditObjectKind,
  type EditStore,
  type ObjectEditHandle,
  type WorkSurfaceEditHandle,
} from '@/features/viewer3d/editing/editSession.store';
import { useEditStore } from '@/features/viewer3d/editing/EditStoreContext';
import {
  createHandleRaycast,
  createPlaneReader,
  dragPlane,
  useEditKeys,
} from '@/features/viewer3d/editing/handleInput';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { obbWorkSurface, surfaceCorners } from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { sameTarget } from '@/features/viewer3d/target';
import { useViewerStore } from '@/features/viewer3d/ViewerStoreContext';
import { worldPoint, worldToThree, type WorldPoint } from '@/features/viewer3d/worldCoordinates';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import { Line } from '@react-three/drei';
import { useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  BoxGeometry,
  ConeGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { useStore } from 'zustand';

// 작업면 OBB 조작기(S15P31A101-188). -195 공통 편집 Store·엔진(applyEditOperation)·손잡이 입력을 그대로 쓰고,
// OBB 에 필요한 손잡이만 더한다: X·Y 이동, 지역 축 4개 면(반대 면 고정), 상판(바닥 고정), World +Z 축 수평 회전.
// 원본 작업면(WorkSurfaceLayer)은 그대로 두고 초안만 따로 그린다. 기울임·Z 이동·하단 손잡이는 없다.
// 등록 정적 객체(OBSTACLE, -274)는 같은 조작기에 아랫면(z-)·Z 이동(lift) 손잡이를 더하고, 상판 가장자리 선은 그리지 않는다.

const noRaycast = () => null;
const Z_HANDLE_GAP = 0.35;
/** 회전 손잡이를 윗면 +X'·+Y' 모서리 바깥으로 띄우는 거리(m). 면 손잡이와 겹치지 않게 한다. */
const YAW_HANDLE_GAP = 0.3;
const PREVIEW_COLOR = '#c4a7ff';
const HANDLE_COLORS: Record<ObjectEditHandle, string> = {
  move: '#f2c14e',
  'x-': '#ef6f6f',
  'x+': '#ef6f6f',
  'y-': '#6cc070',
  'y+': '#6cc070',
  'z+': '#5b9cf0',
  'z-': '#5b9cf0',
  yaw: '#ff9f43',
  lift: '#9ad0ff',
};

export const OBJECT_HANDLE_HINTS: Record<WorkSurfaceEditHandle, string> = {
  move: '작업면 전체 이동 · X/Y (크기·상판 높이·회전 유지)',
  'x-': "X' − 면 · 반대쪽 X' + 고정(작업면 축)",
  'x+': "X' + 면 · 반대쪽 X' − 고정(작업면 축)",
  'y-': "Y' − 면 · 반대쪽 Y' + 고정(작업면 축)",
  'y+': "Y' + 면 · 반대쪽 Y' − 고정(작업면 축)",
  'z+': '상판 높이 · 바닥 고정',
  yaw: '수평 회전(World Z 축) · 기울임 없음',
};

/** 정적 객체(-274) 손잡이 설명. */
export const OBSTACLE_HANDLE_HINTS: Record<ObjectEditHandle, string> = {
  move: '정적 객체 전체 이동 · X/Y (크기·높이·회전 유지)',
  'x-': "X' − 면 · 반대쪽 X' + 고정(객체 축)",
  'x+': "X' + 면 · 반대쪽 X' − 고정(객체 축)",
  'y-': "Y' − 면 · 반대쪽 Y' + 고정(객체 축)",
  'y+': "Y' + 면 · 반대쪽 Y' − 고정(객체 축)",
  'z+': '윗면 높이 · 아랫면 고정',
  'z-': '아랫면 높이 · 윗면 고정',
  yaw: '수평 회전(World Z 축) · 기울임 없음',
  lift: '전체 위아래 이동 · Z (크기·회전 유지)',
};

/** 대상 종류에 맞는 손잡이 설명. 작업면에는 z-·lift 손잡이가 없다(바닥에 놓인 형상). */
function handleHint(kind: EditObjectKind, handle: ObjectEditHandle): string {
  if (kind !== 'WORK_SURFACE') return OBSTACLE_HANDLE_HINTS[handle];
  return handle === 'z-' || handle === 'lift' ? '' : OBJECT_HANDLE_HINTS[handle];
}

const FACE_GEOMETRY = new BoxGeometry(0.16, 0.16, 0.16);
const MOVE_GEOMETRY = new SphereGeometry(0.18, 24, 16);
const Z_GEOMETRY = new ConeGeometry(0.1, 0.22, 16);
const YAW_GEOMETRY = new TorusGeometry(0.13, 0.04, 8, 24);
const LIFT_GEOMETRY = new OctahedronGeometry(0.14);
const UNIT_EDGES = boxEdges([1, 1, 1]);

const topOf = (obb: WorldObb) => obb.center[2] + obb.size[2] / 2;
const bottomOf = (obb: WorldObb) => obb.center[2] - obb.size[2] / 2;
const degrees = (radians: number) => (radians * 180) / Math.PI;
const zRangeText = (obb: WorldObb) => `Z ${bottomOf(obb).toFixed(2)}~${topOf(obb).toFixed(2)}m`;
const yawText = (obb: WorldObb) => `${degrees(obb.yaw).toFixed(1)}°`;

/** 작업면 축(yaw 회전)의 지역 좌표 (u, v) 를 World 점으로 옮긴다. */
function localToWorld(obb: WorldObb, u: number, v: number, z: number): WorldPoint {
  const [c, s] = [Math.cos(obb.yaw), Math.sin(obb.yaw)];
  return worldPoint(obb.center[0] + u * c - v * s, obb.center[1] + u * s + v * c, z);
}

/**
 * 손잡이의 World 위치. 이동·회전은 윗면, 면은 그 면 가운데(높이 절반), 상판은 윗면 위로 띄운 곳이다.
 * 정적 객체의 아랫면(z-)은 아랫면 아래로 띄운 곳, Z 이동(lift)은 회전 손잡이 반대쪽 윗면 모서리 바깥이다.
 */
export function objectHandleWorld(obb: WorldObb, handle: ObjectEditHandle): WorldPoint {
  const [hx, hy] = [obb.size[0] / 2, obb.size[1] / 2];
  const [cz, top] = [obb.center[2], topOf(obb)];
  switch (handle) {
    case 'move':
      return localToWorld(obb, 0, 0, top);
    case 'x-':
      return localToWorld(obb, -hx, 0, cz);
    case 'x+':
      return localToWorld(obb, hx, 0, cz);
    case 'y-':
      return localToWorld(obb, 0, -hy, cz);
    case 'y+':
      return localToWorld(obb, 0, hy, cz);
    case 'z+':
      return localToWorld(obb, 0, 0, top + Z_HANDLE_GAP);
    case 'z-':
      return localToWorld(obb, 0, 0, bottomOf(obb) - Z_HANDLE_GAP);
    case 'yaw':
      return localToWorld(obb, hx + YAW_HANDLE_GAP, hy + YAW_HANDLE_GAP, top);
    case 'lift':
      return localToWorld(obb, -hx - YAW_HANDLE_GAP, -hy - YAW_HANDLE_GAP, top);
  }
}

type Controls = { enabled: boolean };

/** 작업면 손잡이 끌기 하나. 구역 끌기(createHandleDrag)와 같은 수명 규칙(카메라 조작 끄기·되돌리기·Esc)을 따른다. */
export function createObjectHandleDrag(store: EditStore, get: () => RootState) {
  let active: { from: WorldObb; controlsWereEnabled: boolean | null; detach: () => void } | null =
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
    store.getState().setObjectDragging(null);
  };

  const start = (handle: ObjectEditHandle, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button !== 0 || active) return;
    const session = store.getState().objectSession;
    if (!session) return;
    const anchor = new Vector3(...worldToThree(objectHandleWorld(session.draft, handle)));
    const plane = dragPlane(get, anchor, handle === 'z+' || handle === 'z-' || handle === 'lift');
    if (!plane) return;
    const worldAt = createPlaneReader(get, plane);
    const origin = worldAt(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!origin) return;
    const from = session.draft;
    // 지역 축(끌기 시작 때 yaw 기준). 면 손잡이는 World 이동량을 이 축에 투영해 그 면만 옮긴다.
    const [c, s] = [Math.cos(from.yaw), Math.sin(from.yaw)];
    const angleAt = (p: WorldPoint) => Math.atan2(p[1] - from.center[1], p[0] - from.center[0]);
    const startAngle = angleAt(origin);

    const onMove = (move: PointerEvent) => {
      if ((move.buttons & 1) === 0) {
        end();
        return;
      }
      const now = worldAt(move.clientX, move.clientY);
      if (!now || !active) return;
      const [dx, dy, dz] = [now[0] - origin[0], now[1] - origin[1], now[2] - origin[2]];
      const edit = store.getState();
      switch (handle) {
        case 'move':
          edit.previewObject(from, { type: 'translate', delta: [dx, dy, 0] });
          return;
        case 'z+':
        case 'z-':
          edit.previewObject(from, { type: 'face', face: handle, delta: dz });
          return;
        case 'lift':
          edit.previewObject(from, { type: 'translate', delta: [0, 0, dz] });
          return;
        case 'yaw': {
          const turn = angleAt(now) - startAngle;
          edit.previewObject(from, {
            type: 'rotate',
            axis: 'yaw',
            radians: Math.atan2(Math.sin(turn), Math.cos(turn)),
          });
          return;
        }
        default: {
          const delta = handle[0] === 'x' ? dx * c + dy * s : -dx * s + dy * c;
          edit.previewObject(from, { type: 'face', face: handle, delta });
        }
      }
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
    if (controls) controls.enabled = false;
    store.getState().setObjectDragging(handle);
  };

  /** Esc. 끄는 중이면 그 끌기만 되돌리고, 아니면 편집을 취소한다. */
  const escape = () => {
    const current = active;
    if (current) {
      end();
      store.getState().restoreObjectDraft(current.from);
      return;
    }
    store.getState().cancelObject('USER');
  };

  /** Enter. 끄는 중이 아닐 때 초안을 World 결과로 돌려주고 손잡이를 내린다(저장 아님). */
  const enter = () => {
    if (active) return;
    store.getState().finishObject();
  };

  return { start, end, escape, enter };
}

export function ObbGizmoController() {
  const edit = useEditStore();
  return edit ? <ObbGizmoForStore store={edit} /> : null;
}

function ObbGizmoForStore({ store }: { store: EditStore }) {
  const target = useStore(store, (s) => s.objectSession?.target ?? null);
  const selected = useStore(useViewerStore(), (s) => s.selected);
  if (!target || !sameTarget(selected, target)) return null;
  return <ObbGizmo store={store} />;
}

/**
 * 초안 이름표. 저장되지 않은 미리보기임을 함께 적는다. 정적 객체는 아랫면~윗면 높이를 적는다.
 * 작업면·정적 객체는 ID 를 적지 않고, 계획(PLANNED) 가상 객체만 ID 를 적는다.
 */
export function objectPreviewLabel(
  id: string,
  obb: WorldObb,
  created = false,
  kind: EditObjectKind = 'WORK_SURFACE',
) {
  if (kind === 'PLANNED') {
    return `${id} · 계획(PLANNED) 가상 객체 · 미저장 · ${zRangeText(obb)} · ${yawText(obb)}`;
  }
  if (kind === 'OBSTACLE') {
    return `정적 객체 · 미저장 · ${zRangeText(obb)} · ${yawText(obb)}`;
  }
  const state = created ? '새 작업면 · 미등록' : '미저장';
  return `${state} · 상판 ${topOf(obb).toFixed(2)}m · ${yawText(obb)}`;
}

function ObbGizmo({ store }: { store: EditStore }) {
  const get = useThree((s) => s.get);
  const [drag] = useState(() => createObjectHandleDrag(store, get));
  const [hovered, setHovered] = useState<ObjectEditHandle | null>(null);
  const [handleRaycast] = useState(() => createHandleRaycast(get));
  const draft = useStore(store, (s) => s.objectSession?.draft ?? null);
  const settled = useStore(store, (s) => s.objectSession?.settled ?? null);
  const dragging = useStore(store, (s) => s.objectSession?.dragging ?? null);
  const refused = useStore(store, (s) => s.objectSession?.refused ?? null);
  const id = useStore(store, (s) => s.objectSession?.target.id ?? '');
  const targetType = useStore(store, (s) => s.objectSession?.target.type ?? 'object');
  const created = useStore(store, (s) => s.objectSession?.origin === 'NEW');
  const kind = useStore(store, (s) => s.objectSession?.objectKind ?? 'WORK_SURFACE');
  const handles = objectEditHandles(kind);

  useEffect(() => () => drag.end(), [drag]);
  const cursor = dragging ? 'grabbing' : hovered ? 'grab' : '';
  useEffect(() => {
    const canvas = get().gl.domElement;
    canvas.style.cursor = cursor;
    return () => {
      canvas.style.cursor = '';
    };
  }, [get, cursor]);
  useEditKeys(drag.escape, drag.enter);

  const hint = dragging ?? hovered;
  // 윗면 둘레는 World 꼭짓점을 그대로 옮겨 그린다(회전 행렬을 따로 거치지 않는다). 정적 객체에는 상판 가장자리가 없다.
  const topEdge = useMemo(() => {
    if (!draft || kind !== 'WORK_SURFACE') return null;
    const corners = surfaceCorners(obbWorkSurface(draft), topOf(draft)).map(worldToThree);
    return [...corners, corners[0]!];
  }, [draft, kind]);
  const yawRing = useMemo(() => {
    if (!draft || hint !== 'yaw') return null;
    const handle = objectHandleWorld(draft, 'yaw');
    const radius = Math.hypot(handle[0] - draft.center[0], handle[1] - draft.center[1]);
    const top = topOf(draft);
    return Array.from({ length: 49 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return worldToThree(
        worldPoint(
          draft.center[0] + radius * Math.cos(a),
          draft.center[1] + radius * Math.sin(a),
          top,
        ),
      );
    });
  }, [draft, hint]);

  if (!draft || !settled) return null;
  const [w, d, h] = draft.size;
  return (
    <group name="object-edit-gizmo">
      {/* 새 작업면·가상 객체는 장면에 원본 상자가 없어 이 빈 그룹이 초점 대상(object:ID·planned:ID) 이름을 대신 쓴다. */}
      {created && <group name={`${targetType}:${id}`} position={worldToThree(draft.center)} />}
      {/* 초안(미리보기). 원본 작업면과 따로 그리며 클릭을 받지 않는다. */}
      <group
        name="object-edit-preview"
        position={worldToThree(draft.center)}
        rotation-y={draft.yaw}
      >
        <group scale={[w, h, d]}>
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
            lineWidth={1.5}
            raycast={noRaycast}
          />
        </group>
        <LabelSprite
          text={
            refused
              ? `${objectPreviewLabel(id, settled, created, kind)} · 편집 거부 · ${refused.detail}`
              : objectPreviewLabel(id, settled, created, kind)
          }
          y={h / 2 + Z_HANDLE_GAP + 0.3}
          height={0.22}
          color={refused ? '#ffb4b4' : PREVIEW_COLOR}
        />
      </group>
      {topEdge && (
        <Line
          name="object-edit-top-edge"
          points={topEdge}
          color={PREVIEW_COLOR}
          lineWidth={3}
          raycast={noRaycast}
        />
      )}
      {yawRing && (
        <Line
          points={yawRing}
          color={HANDLE_COLORS.yaw}
          lineWidth={1}
          dashed
          dashSize={0.08}
          gapSize={0.06}
          raycast={noRaycast}
        />
      )}
      {handles.map((handle) => {
        const active = hint === handle;
        return (
          <mesh
            key={handle}
            name={`object-edit-handle:${handle}`}
            position={worldToThree(objectHandleWorld(draft, handle))}
            scale={active ? 1.2 : 1}
            geometry={geometryOf(handle)}
            raycast={handleRaycast}
            rotation={
              handle === 'yaw' ? [Math.PI / 2, 0, 0] : handle === 'z-' ? [Math.PI, 0, 0] : undefined
            }
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
        <group position={worldToThree(objectHandleWorld(settled, hint))}>
          <LabelSprite
            // 회전 중에는 1° 단위로만 글자를 바꿔 끄는 동안 이름표 텍스처를 덜 만든다.
            text={
              hint === 'yaw'
                ? `${handleHint(kind, 'yaw')} · ${Math.round(degrees(draft.yaw))}°`
                : handleHint(kind, hint)
            }
            y={0.32}
            height={0.2}
            color="#f5f5f5"
          />
        </group>
      )}
    </group>
  );
}

function geometryOf(handle: ObjectEditHandle): BufferGeometry {
  if (handle === 'move') return MOVE_GEOMETRY;
  if (handle === 'yaw') return YAW_GEOMETRY;
  if (handle === 'lift') return LIFT_GEOMETRY;
  return handle === 'z+' || handle === 'z-' ? Z_GEOMETRY : FACE_GEOMETRY;
}

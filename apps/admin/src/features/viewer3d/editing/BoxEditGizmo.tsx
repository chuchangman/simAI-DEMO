import { handlesFor, isDrawableBox, type BoxEditHandle } from '@/features/viewer3d/editing/boxEdit';
import { createBoxEditDrag, type BoxEditEmit } from '@/features/viewer3d/editing/boxEditDrag';
import { BoxHandles } from '@/features/viewer3d/editing/BoxEditHandles';
import {
  GHOST_LINE,
  HIGHLIGHT_FILL_OPACITY,
  HIGHLIGHT_LINE_WIDTH,
  noRaycast,
  PREVIEW_FILL_OPACITY,
  PREVIEW_LINE_WIDTH,
  PREVIEW_ORDER,
  UNIT_EDGES,
} from '@/features/viewer3d/editing/boxEditStyle';
import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import type { RiskColorLevel } from '@/features/viewer3d/palette';
import { useShownRoomLimit } from '@/features/viewer3d/scene/useShownRoom';
import { useScenePalette } from '@/features/viewer3d/sceneTheme';
import type { ViewerBoxEdit, ViewerBoxGhost } from '@/features/viewer3d/types';
import { toWorldPoint, worldBoxToThree, type ThreeBox } from '@/features/viewer3d/worldCoordinates';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

// 호스트(FE)가 상자를 쥐고 있는 제어형 상자 편집 조작기. 뷰어 안 편집 세션(GizmoController·ObbGizmo)과 따로 쓰며 그 코드를 건드리지 않는다.
// 받은 box 가 늘 정본이다. 끌면 onBoxEditChange 로 새 상자를 올리고, 호스트가 다시 내려 준 box 로 그린다.
// 끄는 동안은 끌기를 시작할 때의 상자(from)에 전체 이동량을 더해 계산한다(데모 dragBox 와 같다). 끌기 계산은 boxEditDrag, 손잡이 그림은 BoxEditHandles.
// 화살표: 그 면의 바깥 가운데에 놓이고 그 면만 움직인다. 값은 마우스 광선과 축 직선(상자 가운데를 지나는 그 축)의 최근접점을 따른다.
// 가운데 구: 바닥(수평 평면)에서만 옮긴다. 끄는 동안 카메라 OrbitControls 를 끄고, 놓기·취소·버튼이 떨어진 움직임·
// ID 바뀜·내려감에서 끄기 전 상태로 되돌린다. Esc 는 끌기를 시작 전 상자로 되돌린다.

/** 그릴 때 한 변의 최소 길이(m). 0 이면 행렬이 무너진다. */
const MIN_DRAW_SIZE = 0.01;

/** Canvas 안 조작기가 읽는 호스트 입력. ViewerShell 이 props 에서 만든다. */
export interface BoxEditBinding {
  boxEdit: ViewerBoxEdit | null;
  onBoxEditChange?: BoxEditEmit;
  boxGhosts: readonly ViewerBoxGhost[];
}
export const BoxEditContext = createContext<BoxEditBinding | null>(null);

function threeBox(box: ViewerEditBox): ThreeBox | null {
  if (!isDrawableBox(box)) return null;
  const min = toWorldPoint(box.min);
  const max = toWorldPoint(box.max);
  return min && max ? worldBoxToThree(min, max) : null;
}

/** 상자 중심 기준 Three 크기(그릴 수 있는 최소 길이로 자른다). */
const drawSize = (box: ThreeBox): [number, number, number] => [
  Math.max(MIN_DRAW_SIZE, box.size[0]),
  Math.max(MIN_DRAW_SIZE, box.size[1]),
  Math.max(MIN_DRAW_SIZE, box.size[2]),
];

export function BoxEditGizmo() {
  const binding = useContext(BoxEditContext);
  if (!binding) return null;
  const { boxEdit, onBoxEditChange, boxGhosts } = binding;
  if (!boxEdit && boxGhosts.length === 0) return null;
  return (
    <group name="box-edit">
      {boxGhosts
        .filter((ghost) => ghost.id !== boxEdit?.id)
        .map((ghost) => (
          <GhostBox key={ghost.id} id={ghost.id} box={ghost.box} highlight={ghost.highlight} />
        ))}
      {/* ID 가 바뀌면 새로 올려 끌던 조작을 끝낸다. */}
      {boxEdit && <ActiveBoxEdit key={boxEdit.id} edit={boxEdit} onChange={onBoxEditChange} />}
    </group>
  );
}

/** 보관된 미저장 초안. 읽기 전용 점선 윤곽이며 클릭을 받지 않는다. highlight 면 그 위험 등급색 실선 윤곽과 반투명 면으로 그린다. */
function GhostBox({
  id,
  box,
  highlight,
}: {
  id: string;
  box: ViewerEditBox;
  highlight?: RiskColorLevel;
}) {
  const palette = useScenePalette();
  const three = threeBox(box);
  const [sx, sy, sz] = three ? drawSize(three) : [0, 0, 0];
  const edges = useMemo(() => boxEdges([sx, sy, sz]), [sx, sy, sz]);
  if (!three) return null;
  const riskColor = highlight ? palette.risk[highlight].color : null;
  return (
    <group name={`box-edit-ghost:${id}`} position={three.position}>
      {riskColor === null ? (
        <Line
          points={edges}
          segments
          color={palette.zone.preview}
          dashed
          transparent
          raycast={noRaycast}
          {...GHOST_LINE}
        />
      ) : (
        <>
          <mesh raycast={noRaycast} renderOrder={PREVIEW_ORDER}>
            <boxGeometry args={[sx, sy, sz]} />
            <meshBasicMaterial
              color={riskColor}
              transparent
              opacity={HIGHLIGHT_FILL_OPACITY}
              depthWrite={false}
            />
          </mesh>
          <Line
            points={edges}
            segments
            color={riskColor}
            lineWidth={HIGHLIGHT_LINE_WIDTH}
            raycast={noRaycast}
          />
        </>
      )}
    </group>
  );
}

/** 끌기 객체를 하나 만들고 호스트가 내려 준 최신 상자·알림 함수, 뷰어의 교실 범위와 맞춘다. 내려가면 끌기를 끝내고 카메라 조작을 되돌린다. */
function useBoxEditDrag(box: ViewerEditBox, onChange: BoxEditEmit | undefined) {
  const get = useThree((s) => s.get);
  const limit = useShownRoomLimit();
  const [dragging, setDragging] = useState<BoxEditHandle | null>(null);
  const [drag] = useState(() => createBoxEditDrag(get, setDragging));
  // 끄는 동안 이벤트가 낡은 값을 읽지 않게 커밋 직후에 넘긴다.
  useLayoutEffect(() => drag.sync(box, onChange, limit));
  // 내려가면(ID 바뀜·편집 끝·StrictMode 재마운트) 끝낸다.
  useEffect(() => () => drag.end(), [drag]);
  return { drag, dragging };
}

/** 손잡이 위에서는 잡을 수 있다는 커서, 끄는 동안은 잡은 커서를 보인다. */
function cursorOf(hovered: BoxEditHandle | null, dragging: BoxEditHandle | null) {
  if (dragging) return 'grabbing';
  return hovered ? 'grab' : '';
}

/** 캔버스 커서를 정한다. 내려가면 되돌린다. */
function useHandleCursor(hovered: BoxEditHandle | null, dragging: BoxEditHandle | null) {
  const get = useThree((s) => s.get);
  const cursor = cursorOf(hovered, dragging);
  useEffect(() => {
    const canvas = get().gl.domElement;
    canvas.style.cursor = cursor;
    return () => {
      canvas.style.cursor = '';
    };
  }, [get, cursor]);
}

function ActiveBoxEdit({ edit, onChange }: { edit: ViewerBoxEdit; onChange?: BoxEditEmit }) {
  const [hovered, setHovered] = useState<BoxEditHandle | null>(null);
  const { drag, dragging } = useBoxEditDrag(edit.box, onChange);
  useHandleCursor(hovered, dragging);

  const box = threeBox(edit.box);
  if (!box) return null;
  return (
    <group name="box-edit-active">
      <BoxPreview box={box} />
      <BoxHandles
        box={box}
        worldBox={edit.box}
        handles={handlesFor(edit.kind)}
        hovered={hovered}
        dragging={dragging}
        drag={drag}
        onHover={setHovered}
      />
    </group>
  );
}

/** 미리보기. 클릭을 받지 않아 사람·구역 선택을 가리지 않는다. */
function BoxPreview({ box }: { box: ThreeBox }) {
  const palette = useScenePalette();
  return (
    <group name="box-edit-preview" position={box.position}>
      <group scale={drawSize(box)}>
        <mesh raycast={noRaycast} renderOrder={PREVIEW_ORDER}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={palette.zone.preview}
            transparent
            opacity={PREVIEW_FILL_OPACITY}
            depthWrite={false}
          />
        </mesh>
        <Line
          points={UNIT_EDGES}
          segments
          color={palette.zone.preview}
          lineWidth={PREVIEW_LINE_WIDTH}
          raycast={noRaycast}
        />
      </group>
    </group>
  );
}

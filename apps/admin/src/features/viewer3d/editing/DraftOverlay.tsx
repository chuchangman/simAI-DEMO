import { useSpatialData } from '@/features/viewer3d/data/SpatialDataProvider';
import type { EditStore } from '@/features/viewer3d/editing/editSession.store';
import { EditOverlayContext, useEditStore } from '@/features/viewer3d/editing/EditStoreContext';
import type { ViewerEditOverlay } from '@/features/viewer3d/editing/editTypes';
import { LabelSprite } from '@/features/viewer3d/LabelSprite';
import { sameTarget } from '@/features/viewer3d/target';
import { toWorldPoint, worldBoxToThree } from '@/features/viewer3d/worldCoordinates';
import { boxEdges } from '@/features/viewer3d/zones/zoneGeometry';
import { previewLabel } from '@/features/viewer3d/zones/zonePresentation';
import { Line } from '@react-three/drei';
import { useContext } from 'react';
import { useStore } from 'zustand';

// 보관된 미저장 미리보기는 읽기 전용 Ghost로 표시한다. 선택은 원본 구역과 목록이 맡는다.
const noRaycast = () => null;
const OVERLAY_COLOR = '#c4a7ff';
const UNIT_EDGES = boxEdges([1, 1, 1]);

function normalizeOverlays(
  input: ViewerEditOverlay | readonly ViewerEditOverlay[] | null,
): readonly ViewerEditOverlay[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input as ViewerEditOverlay];
}

export function DraftOverlay() {
  const overlay = useContext(EditOverlayContext);
  const edit = useEditStore();
  const list = normalizeOverlays(overlay);
  if (!edit || list.length === 0) return null;
  return (
    <>
      {list.map((item) => (
        <Overlay key={`${item.target.type}:${item.target.id}`} overlay={item} store={edit} />
      ))}
    </>
  );
}

function Overlay({ overlay, store }: { overlay: ViewerEditOverlay; store: EditStore }) {
  const editing = useStore(store, (s) => s.session?.target ?? null);
  const zones = useSpatialData((s) => s.zones.zones);
  if (overlay.target.type !== 'zone') return null;
  // 같은 구역을 다시 편집하는 동안에는 편집 미리보기가 대신한다.
  if (sameTarget(editing, overlay.target)) return null;
  // 원본 구역이 장면에 없으면(다른 Source·삭제) 그리지 않는다.
  const zone = zones.find((candidate) => candidate.zoneId === overlay.target.id);
  if (!zone) return null;
  const min = toWorldPoint(overlay.box.min);
  const max = toWorldPoint(overlay.box.max);
  const box = min && max ? worldBoxToThree(min, max) : null;
  if (!box || !box.size.every((v) => v > 0)) return null;
  const [sx, sy, sz] = box.size;

  return (
    <group name={`edit-draft-overlay:${overlay.target.id}`} position={box.position}>
      <group scale={[sx, sy, sz]}>
        <Line
          points={UNIT_EDGES}
          segments
          color={OVERLAY_COLOR}
          lineWidth={1.5}
          transparent
          opacity={0.8}
          raycast={noRaycast}
        />
      </group>
      <LabelSprite text={previewLabel(zone)} y={sy / 2 + 0.25} height={0.2} color={OVERLAY_COLOR} />
    </group>
  );
}

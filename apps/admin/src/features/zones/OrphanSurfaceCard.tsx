import type { WorkSurface } from '@/features/surfaces/types';
import { formatMeters } from '@/features/zones/SurfaceHeightField';
import type { ZoneEditing } from '@/features/zones/useZoneEditing';
import {
  ARMED_DELETE_CLASS,
  CARD_CLASS,
  DANGER_BUTTON_CLASS,
  FIELD_LABEL_CLASS,
} from '@/features/zones/zonePanelStyle';
import { Button } from '@simai/ui/components/button';

/**
 * 3D 에서 고른, 화면에서 닿을 수 없는 작업면(구역에 이어지지 않았거나 한 구역의 둘째 이후 작업면): 상판 높이를 보이고
 * 삭제한다(두 번 눌러 확인).
 */
export function OrphanSurfaceCard({ edit, surface }: { edit: ZoneEditing; surface: WorkSurface }) {
  const deleteLabel = edit.orphanArmed ? '삭제 확인' : '삭제';
  return (
    <section aria-label="작업면" className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <b className={FIELD_LABEL_CLASS}>작업면</b>
        <span className={FIELD_LABEL_CLASS}>상판 {formatMeters(surface.geometry.topHeightM)}m</span>
      </div>
      <Button
        variant="secondary"
        disabled={edit.busy}
        aria-label={deleteLabel}
        onClick={() => void edit.removeOrphan()}
        className={edit.orphanArmed ? ARMED_DELETE_CLASS : DANGER_BUTTON_CLASS}
      >
        {deleteLabel}
      </Button>
    </section>
  );
}

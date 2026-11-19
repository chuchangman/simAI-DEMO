import { SurfaceHeightField } from '@/features/zones/SurfaceHeightField';
import type { ZoneEditing } from '@/features/zones/useZoneEditing';
import { CARD_CLASS, FIELD_LABEL_CLASS } from '@/features/zones/zonePanelStyle';

/**
 * 고소 작업면(구역에 하나): 상판 높이. 구역은 작업면에서 계산하므로 3D 손잡이는 작업면을 고친다. 새 구역은 「고소 작업면」을
 * 체크해야 작업면이 붙고(높이 칸은 체크했을 때만 보인다), 기존 구역의 작업면은 지우거나 따로 더하지 않는다. 작업면 없이
 * 만든 기존 구역은 카드를 보이지 않는다.
 */
export function SurfaceCard({ edit }: { edit: ZoneEditing }) {
  const { surface, busy } = edit;
  if (!surface && !edit.canToggleNewSurface) return null;
  return (
    <section aria-label="고소 작업면" className={CARD_CLASS}>
      {edit.canToggleNewSurface ? (
        <label className="flex cursor-pointer items-center gap-2.5 select-none">
          <input
            type="checkbox"
            checked={surface !== null}
            disabled={busy}
            onChange={edit.toggleNewSurface}
            className="size-[18px] cursor-pointer accent-primary"
          />
          <span className={FIELD_LABEL_CLASS}>고소 작업면</span>
        </label>
      ) : (
        <b className={FIELD_LABEL_CLASS}>고소 작업면</b>
      )}
      {surface && (
        <SurfaceHeightField
          key={`${edit.zoneKey}:${surface.id ?? 'new'}`}
          value={surface.geometry.topHeightM}
          bad={edit.surfaceErrors !== null}
          disabled={busy}
          onCommit={edit.setSurfaceTop}
        />
      )}
    </section>
  );
}

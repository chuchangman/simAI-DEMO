import { SurfaceHeightField } from '@/features/zones/SurfaceHeightField';
import type { ZoneEditing } from '@/features/zones/useZoneEditing';
import { CARD_CLASS, FIELD_LABEL_CLASS } from '@/features/zones/zonePanelStyle';

/** 가로·세로·높이 칸(축 번호와 이름). 작업면의 높이는 작업면 카드의 상판 높이 칸이 맡는다. */
const SIZE_FIELDS = [
  { axis: 0, label: '가로 (m)', ariaLabel: '가로(m)' },
  { axis: 1, label: '세로 (m)', ariaLabel: '세로(m)' },
  // 작업면 상판 높이 칸(높이(m))과 가리도록 이름을 따로 둔다.
  { axis: 2, label: '높이 (m)', ariaLabel: '구역 높이(m)' },
] as const;

/**
 * 고른 구역(작업면이 붙었으면 작업면)의 크기를 숫자로 고친다(S15P31A101-651). 3D 손잡이와 같은 상자를 고치며, 가로는 World X,
 * 세로는 World Y 길이다. 손잡이를 못 쓰는 대상(회전한 작업면·형상을 못 고치는 구역)이면 보이지 않는다.
 */
export function ZoneSizeCard({ edit }: { edit: ZoneEditing }) {
  const { sizeBox } = edit;
  if (!sizeBox) return null;
  const fields = sizeBox.kind === 'surface' ? SIZE_FIELDS.slice(0, 2) : SIZE_FIELDS;
  return (
    <section aria-label="크기" className={CARD_CLASS}>
      <b className={FIELD_LABEL_CLASS}>크기</b>
      <div className="grid grid-cols-3 gap-2">
        {fields.map(({ axis, label, ariaLabel }) => (
          <SurfaceHeightField
            key={`${edit.zoneKey}:${sizeBox.kind}:${axis}`}
            value={sizeBox.box.max[axis] - sizeBox.box.min[axis]}
            bad={false}
            disabled={edit.busy}
            onCommit={(size) => edit.setBoxSize(axis, size)}
            label={label}
            ariaLabel={ariaLabel}
          />
        ))}
      </div>
    </section>
  );
}

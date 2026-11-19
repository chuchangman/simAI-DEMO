import type { ZoneEditing } from '@/features/zones/useZoneEditing';
import { NEW_KEY } from '@/features/zones/zoneEditModel';
import { zoneDisplayName } from '@/features/zones/zoneName';
import { PICK_CLASS } from '@/features/zones/zonePanelStyle';

/** 드롭다운 항목 뒤에 붙는 상태. 저장 전이 발행 전보다 먼저다. */
const CHANGED_SUFFIX = ' · 저장 전';
const PENDING_SUFFIX = ' · 발행 전';
/** 어느 항목도 고르지 않았을 때의 값. */
const NO_PICK = '';

function stateSuffix(edit: ZoneEditing, zoneId: string): string {
  if (edit.changedIds.has(zoneId)) return CHANGED_SUFFIX;
  if (edit.pendingIds.has(zoneId)) return PENDING_SUFFIX;
  return '';
}

/**
 * 구역 드롭다운: 새 구역 추가, 기존 구역은 이름만(구역 번호는 보이지 않는다). 구역 대신 작업면 카드가 떠 있으면 어느
 * 항목도 고르지 않은 상태로 보여, 직전 구역을 다시 골라 카드에서 빠져나올 수 있게 한다.
 */
export function ZoneSelect({ edit }: { edit: ZoneEditing }) {
  const { zone } = edit;
  const value = edit.orphan ? NO_PICK : zone ? zone.zoneId : NEW_KEY;
  return (
    <select
      aria-label="구역 선택"
      value={value}
      onChange={(event) => edit.pick(event.target.value)}
      className={PICK_CLASS}
    >
      {edit.orphan && <option value={NO_PICK} disabled hidden />}
      <option value={NEW_KEY}>새 구역 추가</option>
      {edit.zones.map((z) => (
        <option key={z.zoneId} value={z.zoneId}>
          {zoneDisplayName(z.name)}
          {stateSuffix(edit, z.zoneId)}
        </option>
      ))}
    </select>
  );
}

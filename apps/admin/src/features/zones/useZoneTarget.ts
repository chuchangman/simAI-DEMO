import type { SpatialViewportValue } from '@/features/layout/SpatialViewportHost';
import type { Zone } from '@/features/zones/types';
import { NEW_KEY } from '@/features/zones/zoneEditModel';
import { useState } from 'react';

export interface ZoneTarget {
  /** 고른 구역. 새 구역 양식이면 null. */
  zone: Zone | null;
  /** 고른 대상의 초안 키(구역 ID 나 NEW_KEY). */
  key: string;
  openZone: (zoneId: string) => void;
  openNew: () => void;
  /** 드롭다운에서 고른 값. */
  pick: (value: string) => void;
}

const findZone = (zones: readonly Zone[], id: string): Zone | null =>
  zones.find((z) => z.zoneId === id) ?? null;

/**
 * 고른 대상: 구역 ID 나 새 구역(NEW_KEY). 3D 에서 구역을 누르면 호스트의 선택이 바뀌어 따라간다. 3D 에서 구역에 이어진 작업면을
 * 누르면(pickedSurfaceZone) 그 구역을 연다. 시작할 때 이미 구역이나 이어진 작업면이 선택돼 있으면 처음부터 그
 * 구역을 연다. 빈 곳을 눌러 선택이 풀려도 대상은 그대로다(드롭다운과 3D 선택만 대상을 바꾼다).
 */
export function useZoneTarget(
  viewport: SpatialViewportValue,
  pickedSurfaceZone: string | null,
): ZoneTarget {
  const { zones, selectedZoneId, selectTarget, clearSelection } = viewport;
  const [target, setTarget] = useState<string>(selectedZoneId ?? pickedSurfaceZone ?? NEW_KEY);
  const [seenSelected, setSeenSelected] = useState(selectedZoneId);
  if (seenSelected !== selectedZoneId) {
    setSeenSelected(selectedZoneId);
    if (selectedZoneId) setTarget(selectedZoneId);
  }
  const [seenPicked, setSeenPicked] = useState(pickedSurfaceZone);
  if (seenPicked !== pickedSurfaceZone) {
    setSeenPicked(pickedSurfaceZone);
    if (pickedSurfaceZone) setTarget(pickedSurfaceZone);
  }
  const zone = findZone(zones, target);
  const key = zone ? zone.zoneId : NEW_KEY;

  const openZone = (zoneId: string) => {
    setTarget(zoneId);
    selectTarget({ type: 'zone', id: zoneId }, { focus: true });
  };
  const openNew = () => {
    setTarget(NEW_KEY);
    clearSelection();
  };
  const pick = (value: string) => {
    if (value === NEW_KEY || !findZone(zones, value)) openNew();
    else openZone(value);
  };

  return {
    zone,
    key,
    openZone,
    openNew,
    pick,
  };
}

import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import {
  requestLayout,
  TBM_LAYOUTS_KEY,
  tbmLayoutDetailKey,
  updateLayout,
} from '@/features/tbm/api';
import type { LayoutObbItem } from '@/features/tbm/types';
import { BUNDLES_KEY, requestZones, ZONES_KEY } from '@/features/zones/api';
import { zoneItemSchema } from '@/features/zones/types';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

/** 최신 revision을 읽고 항목을 바꾼다. 서버가 구역과 구성 묶음을 함께 갱신한다. */
export function useLayoutZoneCommit() {
  const client = useQueryClient();
  return async (
    layoutId: number,
    edit: (items: LayoutObbItem[]) => { items: LayoutObbItem[]; itemId?: string },
  ) => {
    const layout = await requestLayout(api, layoutId);
    const result = edit(layout.items);
    await updateLayout(api, layoutId, {
      name: layout.name,
      items: result.items,
      revision: layout.revision,
    });
    await Promise.all(
      [
        ZONES_KEY,
        STATIC_OBJECTS_KEY,
        BUNDLES_KEY,
        TBM_LAYOUTS_KEY,
        tbmLayoutDetailKey(layoutId),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
    if (!result.itemId) return undefined;
    const zones = await requestZones(api);
    const zone = zones
      .map((value) => zoneItemSchema.safeParse(value))
      .find(
        (value) =>
          value.success &&
          value.data.layout_id === layoutId &&
          value.data.layout_item_id === result.itemId,
      );
    return zone?.success ? zone.data.zone_id : undefined;
  };
}

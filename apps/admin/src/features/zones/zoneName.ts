import type { ZoneBox } from '@/features/zones/types';
import { UNNAMED_ZONE_NAME } from '@/lib/zoneName';

// 화면에는 구역 번호(z-…)를 보이지 않고 이름만 보인다. 구역 ID 로 이름을 찾는 순수 함수.

export { UNNAMED_ZONE_NAME, zoneDisplayName } from '@/lib/zoneName';

/** 구역 ID 의 이름. 구역 ID 가 없거나, 목록에 없거나, 이름이 비었으면 null 이다. */
export type ZoneNameOf = (zoneId: string | null | undefined) => string | null;

/** 구역 목록으로 ID → 이름 조회 함수를 만든다. 이름은 앞뒤 공백을 뗀 것이다. */
export function zoneNameOf(zones: readonly Pick<ZoneBox, 'zoneId' | 'name'>[]): ZoneNameOf {
  const names = new Map(zones.map((zone) => [zone.zoneId, zone.name.trim()]));
  return (zoneId) => (zoneId ? names.get(zoneId) || null : null);
}

/** 구역이 주어인 자리의 이름. 이름을 모르면 `구역` 이다(덧붙이는 자리는 zoneName 을 그대로 써서 빼는다). */
export const zoneNameOrDefault = (zoneId: string, zoneName: ZoneNameOf) =>
  zoneName(zoneId) ?? UNNAMED_ZONE_NAME;

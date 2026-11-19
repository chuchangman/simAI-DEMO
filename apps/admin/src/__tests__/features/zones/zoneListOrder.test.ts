import { zoneOf } from '@/__tests__/features/zones/zoneFixture';
import type { Severity } from '@/features/zones/types';
import { zonesForList } from '@/features/zones/zoneListOrder';
import { describe, expect, it } from 'vitest';

const BOX = { min: [0, 0, 0], max: [1, 1, 1] } as const;
const zone = (zoneId: string, name: string, severity: Severity) =>
  zoneOf({ zoneId, name, ...BOX }, { severity });
const ids = (zones: readonly { zoneId: string }[]) => zones.map((z) => z.zoneId);

describe('zonesForList', () => {
  it('위험한 등급이 먼저이고 같은 등급은 이름 가나다순이다', () => {
    const zones = [
      zone('a', '다 구역', 'HIGH'),
      zone('b', '나 구역', 'CRITICAL'),
      zone('c', '가 구역', 'HIGH'),
      zone('d', '라 구역', 'CAUTION'),
      zone('e', '마 구역', 'INFO'),
    ];
    expect(ids(zonesForList(zones))).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('이름이 비어도 보이는 이름(`구역`)으로 줄을 세우고, 받은 배열은 바꾸지 않는다', () => {
    const zones = [zone('a', '하 구역', 'HIGH'), zone('b', '  ', 'HIGH')];
    expect(ids(zonesForList(zones))).toEqual(['b', 'a']);
    expect(ids(zones)).toEqual(['a', 'b']);
  });
});

import { ZONES_KEY } from '@/features/zones/api';
import type { ZonesResponse } from '@/features/zones/types';
import { zoneNameOf, type ZoneNameOf } from '@/features/zones/zoneName';
import { readZones } from '@/features/zones/zones';
import { skipToken, useQuery } from '@tanstack/react-query';

const NO_NAMES: ZoneNameOf = () => null;

// 같은 응답은 이름 표를 한 번만 만든다. 카드·줄마다 이 훅을 불러도 구역을 읽는 일은 응답마다 한 번이다.
const namesOf = new WeakMap<ZonesResponse, ZoneNameOf>();

function selectZoneName(response: ZonesResponse): ZoneNameOf {
  let names = namesOf.get(response);
  if (!names) {
    names = zoneNameOf(readZones(response));
    namesOf.set(response, names);
  }
  return names;
}

/**
 * 구역 ID 로 이름을 찾는 함수. 구역을 받기 전에는 모든 ID 가 null 이다.
 * 구역은 앱 틀(SpatialViewportHost)의 useZones 가 받고 못 받으면 다시 시도한다. 이 훅은 그 캐시를 읽기만 해서, 많이
 * 불러도 요청이나 타이머가 늘지 않는다.
 */
export function useZoneName(): ZoneNameOf {
  const { data } = useQuery<ZonesResponse, Error, ZoneNameOf>({
    queryKey: ZONES_KEY,
    queryFn: skipToken,
    select: selectZoneName,
  });
  return data ?? NO_NAMES;
}

import {
  eventTargetsTrack,
  trackPlacement,
  type RiskEventView,
  type TrackView,
  type ZoneView,
} from '@/features/viewer3d/data/spatialFrame';

// 개발 진단·시험 전용 검증 함수. 이벤트의 대상이 그 순간 구역 상자(AABB, Z 범위 포함) 안에 있는지 본다.
// 위험 판정이 아니다. 3D 강조는 이 결과를 쓰지 않는다(이벤트 원본을 그대로 따른다). 시연 Fixture 와 화면이 맞는지 확인하는 용도다.

export interface ZoneContainment {
  eventId: string;
  zoneId: string;
  /** 접지점이 확인된 3D 위치가 구역 상자 안. */
  inside: string[];
  /** 접지점이 확인된 3D 위치가 구역 상자 밖. 구역 밖 관계자가 이벤트에 들어 있다는 뜻이다. */
  outside: string[];
  /** 지금 World 에 없거나 접지가 확인되지 않아 3D 포함 여부를 말할 수 없다. */
  unknown: string[];
}

const contains = (zone: ZoneView, point: readonly number[]) =>
  zone.min.every((min, i) => point[i]! >= min && point[i]! <= zone.max[i]!);

/** 구역이 있는 활성 이벤트마다 대상의 구역 포함 여부. 구역을 받지 못한 이벤트는 빼고, 판정 기준은 접지 확인 위치뿐이다. */
export function zoneContainment(
  events: readonly RiskEventView[],
  tracks: readonly TrackView[],
  zones: readonly ZoneView[],
): ZoneContainment[] {
  return events.flatMap((event) => {
    const zone = zones.find((z) => z.zoneId === event.zoneId);
    if (!zone) return [];
    const result: ZoneContainment = {
      eventId: event.eventId,
      zoneId: zone.zoneId,
      inside: [],
      outside: [],
      unknown: [],
    };
    for (const worldId of event.worldIds) {
      const track = tracks.find((t) => eventTargetsTrack({ worldIds: [worldId] }, t));
      const placement = track ? trackPlacement(track) : null;
      if (!placement || placement.basis !== 'GROUND_ANCHOR') result.unknown.push(worldId);
      else (contains(zone, placement.world) ? result.inside : result.outside).push(worldId);
    }
    return [result];
  });
}

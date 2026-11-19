import type { WorkSurface } from '@/features/surfaces/types';
import type { Zone } from '@/features/zones/types';

// 구역↔작업면 연결은 서버가 작업면에 저장한 zone_id 가 기준이다(GET /api/static-objects). 화면은 그 값을 읽기만 하고 기하로 다시
// 계산하지 않는다.

type LinkableSurface = Pick<WorkSurface, 'objectId' | 'zoneId'>;

/**
 * 구역마다 이은 작업면(하나). 서버가 저장한 작업면의 zone_id 를 읽는다. 지금 구역에 걸린 것만 잇는다(보관한 구역에 걸린 것은
 * 뺀다). 한 구역에 작업면이 둘 이상이면 작업면 ID 순 첫 번째만 잇는다(서버 V22 가 기존 작업면을 채운 규칙과 같다).
 */
export function linkSurfaces<S extends LinkableSurface>(
  zones: readonly Pick<Zone, 'zoneId'>[],
  surfaces: readonly S[],
): Map<string, S> {
  const current = new Set(zones.map((zone) => zone.zoneId));
  const links = new Map<string, S>();
  const byId = [...surfaces].sort((a, b) => a.objectId.localeCompare(b.objectId));
  for (const surface of byId) {
    const { zoneId } = surface;
    if (zoneId !== null && current.has(zoneId) && !links.has(zoneId)) links.set(zoneId, surface);
  }
  return links;
}

/**
 * 3D 에서 고른 작업면(objectId)이 이어진 구역이면 그 구역 ID(zoneId), 화면에서 닿을 수 없는 작업면이면 그 작업면(orphan)이다.
 * 닿을 수 없는 작업면은 구역에 이어지지 않았거나 보관한 구역에 걸린 것, 한 구역에 걸린 둘째 이후 작업면이다(구역에는 첫째만
 * 이어진다). 작업면이 아닌 대상(장애물)이거나 고른 것이 없으면(null) 둘 다 비어 있다.
 */
export function pickedSurface<S extends LinkableSurface>(
  objectId: string | null,
  surfaces: readonly S[],
  links: ReadonlyMap<string, LinkableSurface>,
): { zoneId: string | null; orphan: S | null } {
  const surface = objectId === null ? undefined : surfaces.find((s) => s.objectId === objectId);
  if (!surface) return { zoneId: null, orphan: null };
  const { zoneId } = surface;
  const linkedHere = zoneId !== null && links.get(zoneId)?.objectId === surface.objectId;
  return linkedHere ? { zoneId, orphan: null } : { zoneId: null, orphan: surface };
}

import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { BUNDLES_KEY, ZONES_KEY } from '@/features/zones/api';
import type { ConfigBundle, ZoneCommitRequest, ZoneCommitResult } from '@/features/zones/types';
import { fieldOf } from '@/lib/writeFailure';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

// 저장·발행 응답을 목록 캐시(구역·작업면·구성 묶음)에 넣는 도우미. 낙관적 갱신을 하지 않고 응답(새 버전)으로만 바꾼다(CONVENTION).

/** 목록 항목에서 ID 를 읽는 칸. */
export const ZONE_ID_FIELD = 'zone_id';
export const SURFACE_ID_FIELD = 'object_id';

/** 같은 ID 항목은 바꾸고, 없으면 끝에 더한다. */
const putItem = (list: unknown[], item: unknown, idField: string, id: string): unknown[] =>
  list.some((entry) => fieldOf(entry, idField) === id)
    ? list.map((entry) => (fieldOf(entry, idField) === id ? item : entry))
    : [...list, item];

const removeItem = (list: unknown[], idField: string, id: string): unknown[] =>
  list.filter((entry) => fieldOf(entry, idField) !== id);

/**
 * 받은 목록을 바꾼다. 진행 중인 목록 다시 받기(409 뒤 등)는 이 응답보다 옛 목록을 줄 수 있어 취소하고 응답을 넣은 뒤 다시 받는다.
 * 아직 목록을 받지 않았으면 넣을 곳이 없어 그대로 둔다.
 */
async function writeList(
  queryClient: QueryClient,
  key: QueryKey,
  update: (list: unknown[]) => unknown[],
) {
  const refetching = queryClient.isFetching({ queryKey: key }) > 0;
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<unknown[]>(key, (prev) => prev && update(prev));
  if (refetching) void queryClient.invalidateQueries({ queryKey: key });
}

const versionOf = (item: unknown) => fieldOf(item, 'config_version');

/** 발행 응답(새 묶음, 적용 대기)을 묶음 목록 맨 앞에 넣는다. 같은 버전이 이미 있으면 그것을 대신한다. */
export async function putBundle(queryClient: QueryClient, bundle: ConfigBundle) {
  // 발행 전에 시작한 목록 받기는 새 묶음이 없는 옛 목록을 줄 수 있어 취소한다(적용 대기라 곧 다시 받는다).
  await queryClient.cancelQueries({ queryKey: BUNDLES_KEY });
  queryClient.setQueryData<unknown[]>(BUNDLES_KEY, (prev) => [
    bundle,
    ...(prev ?? []).filter((item) => versionOf(item) !== bundle.config_version),
  ]);
}

/**
 * 한 번 저장(POST /api/zones/commit) 응답을 세 목록에 넣는다. 구역 보관이면 목록에서 빼고, 새 버전이면 넣는다. 작업면은
 * 응답의 새 버전을 넣고 보관한 작업면(archived_surface_id)을 뺀다. 묶음은 맨 앞에 넣는다.
 */
export async function applyCommitted(
  queryClient: QueryClient,
  request: ZoneCommitRequest,
  result: ZoneCommitResult,
) {
  const { zone_id: zoneId, zone, surface, archived_surface_id: archivedSurfaceId, bundle } = result;
  const writes: Promise<void>[] = [];
  if (request.zone.op === 'ARCHIVE') {
    writes.push(
      writeList(queryClient, ZONES_KEY, (list) => removeItem(list, ZONE_ID_FIELD, zoneId)),
    );
  } else if (zone) {
    writes.push(
      writeList(queryClient, ZONES_KEY, (list) => putItem(list, zone, ZONE_ID_FIELD, zoneId)),
    );
  }
  if (surface || archivedSurfaceId) {
    writes.push(
      writeList(queryClient, STATIC_OBJECTS_KEY, (list) => {
        const kept = archivedSurfaceId
          ? removeItem(list, SURFACE_ID_FIELD, archivedSurfaceId)
          : list;
        return surface ? putItem(kept, surface, SURFACE_ID_FIELD, surface.object_id) : kept;
      }),
    );
  }
  if (bundle) writes.push(putBundle(queryClient, bundle));
  await Promise.all(writes);
}

/** 보관(삭제)한 작업면을 작업면 목록에서 뺀다. */
export const removeSurfaceCached = (queryClient: QueryClient, objectId: string) =>
  writeList(queryClient, STATIC_OBJECTS_KEY, (list) =>
    removeItem(list, SURFACE_ID_FIELD, objectId),
  );

/** 서버가 저장했는지 알 수 없는 실패 뒤: 세 목록을 모두 다시 받는다(저장했다면 구역·작업면·묶음이 모두 바뀌었다). */
export function invalidateCommitted(queryClient: QueryClient) {
  for (const queryKey of [ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

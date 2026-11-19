import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { BUNDLES_KEY, ZONES_KEY } from '@/features/zones/api';
import { useRealtimeStore } from '@/store/realtime.store';
import { hasZoneDrafts, useZoneEditStore } from '@/store/zoneEdit.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

type Config = ViewerHealthPayload['config'];

/**
 * 구역 편집이 기준으로 삼는 목록. 고치는 동안 바뀌면 저장 직전의 버전 검사(useZoneCommitMutation)가 새 버전끼리 비교해
 * 다른 관리자의 변경을 경고 없이 덮을 수 있어, 편집 초안이 비기 전에는 다시 받지 않는다.
 */
const EDIT_LISTS: readonly QueryKey[] = [ZONES_KEY, STATIC_OBJECTS_KEY];

/**
 * health 의 구성(config)이 바뀌었을 때 다시 받을 목록. 발행 버전이 바뀌면 구역·작업면·묶음 모두, 적용 버전·동기 상태만 바뀌면
 * 묶음 상태만이다. 이 브라우저가 방금 저장·발행한 버전도 다시 받는다. 묶음 목록의 맨 앞 버전만 보고 건너뛰면, 다른 화면이 묶음만
 * 먼저 받아 간 사이 구역·작업면이 낡은 채 남을 수 있어서다(한 번 더 받는 비용은 작다).
 */
function listsToReload(prev: Config, next: Config): QueryKey[] {
  if (prev.published_version !== next.published_version) {
    return [ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY];
  }
  if (prev.applied_version !== next.applied_version || prev.sync !== next.sync) {
    return [BUNDLES_KEY];
  }
  return [];
}

/**
 * 구성 묶음 발행(구역·작업면 저장 포함)을 다른 브라우저에도 새로고침 없이 반영한다. 서버는 구역을 알리는 STOMP 토픽이 없는 대신
 * /topic/health 의 config(발행·적용 버전, 동기 상태)를 바뀌면 바로 싣는다(viewer_health 1.4.0). 이 값이 바뀌면 구역·작업면·
 * 묶음 목록을 다시 받는다. 처음 받은 값은 기준으로만 삼는다(bindEventsCache 의 held_events_revision 과 같다).
 * 구역 편집 초안이 있는 동안에는 구역·작업면을 미뤘다가 초안이 비면 한 번 받는다. 해제 함수를 돌려준다.
 */
export function bindConfigCache(queryClient: QueryClient) {
  let known: Config | undefined = useRealtimeStore.getState().health?.payload.config;
  const deferred = new Set<QueryKey>();

  const reload = (keys: readonly QueryKey[]) => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  };
  const reloadOrDefer = (keys: readonly QueryKey[]) => {
    const held = hasZoneDrafts() ? keys.filter((key) => EDIT_LISTS.includes(key)) : [];
    for (const key of held) deferred.add(key);
    reload(keys.filter((key) => !held.includes(key)));
  };

  // health 가 비는 때(끊김·로그아웃)는 기준을 지우지 않는다. 다시 받은 값이 다르면 그 사이 놓친 변경이다.
  const offHealth = useRealtimeStore.subscribe((state) => {
    const next = state.health?.payload.config;
    if (!next || next === known) return;
    const prev = known;
    known = next;
    if (prev) reloadOrDefer(listsToReload(prev, next));
  });

  const offDrafts = useZoneEditStore.subscribe(() => {
    if (deferred.size === 0 || hasZoneDrafts()) return;
    const keys = [...deferred];
    deferred.clear();
    reload(keys);
  });

  return () => {
    offHealth();
    offDrafts();
  };
}

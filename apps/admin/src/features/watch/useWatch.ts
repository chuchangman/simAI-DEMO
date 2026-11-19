import {
  resolvePersonDisplay,
  resolvePersonDisplayMap,
  worldIdsKeyOf,
  worldIdsOfKey,
} from '@/features/people/personDisplay';
import {
  overridesOf,
  usePersonNameOverrideStore,
} from '@/features/people/personNameOverride.store';
import { requestWatchBindings, WATCH_BINDINGS_KEY, type WatchBinding } from '@/features/watch/api';
import { useWatchBindEffectStore } from '@/features/watch/watchBindEffect.store';
import {
  bindKeyOf,
  linkKeyOf,
  newBinds,
  watchBadges,
  watchesOfLinkKey,
  watchRows,
} from '@/features/watch/watchStatus';
import { api } from '@/lib/api';
import { useRealtimeStore } from '@/store/realtime.store';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

const NONE: WatchBinding[] = [];

/** 배정을 다시 받는 간격(ms). 움직임 대조(-340)가 2초마다 배정을 바꿀 수 있어 짧게 둔다 */
const REFRESH_MS = 3_000;

/** 지금 배정(열람 이상). 받지 못하면 빈 목록. loaded 는 한 번이라도 받았는지 */
export function useWatchBindingsList(): { bindings: WatchBinding[]; loaded: boolean } {
  const query = useQuery({
    queryKey: WATCH_BINDINGS_KEY,
    queryFn: ({ signal }) => requestWatchBindings(api, signal),
    refetchInterval: REFRESH_MS,
    // 뒤에 있는 탭은 묻지 않는다(관제 탭이 여럿이어도 보이는 탭만)
    refetchIntervalInBackground: false,
  });
  return { bindings: query.data ?? NONE, loaded: query.isSuccess };
}

/**
 * 캐시에 들어온 워치 배정만 읽는다(useZoneName 과 같은 수동 구독).
 * SpatialViewportHost 의 useWatchBindDetector 가 주기 조회를 맡으므로, 카드·배너·상세 패널이 여럿 불러도 요청이나 타이머가 늘지 않는다.
 */
export function useCachedWatchBindings(): WatchBinding[] {
  const { data } = useQuery<WatchBinding[]>({
    queryKey: WATCH_BINDINGS_KEY,
    queryFn: skipToken,
  });
  return data ?? NONE;
}

/**
 * 새로 이어진 (워치, World ID) 를 감지해 3D 강조·알림을 띄운다(관제 화면 한 곳에서만 부른다, S15P31A101-509·-658).
 * 처음 불러온 배정·재로드(다시 마운트)·같은 배정 유지는 효과가 없고, 이전 조회에 없던 배정만 센다.
 */
export function useWatchBindDetector() {
  const { bindings, loaded } = useWatchBindingsList();
  const prev = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const added = newBinds(prev.current, bindings);
    if (added.length > 0) {
      const realtimeState = useRealtimeStore.getState();
      const overrideState = usePersonNameOverrideStore.getState();
      const rows = watchRows(
        watchesOfLinkKey(linkKeyOf(realtimeState.health?.payload.watches)),
        bindings,
      );
      const displayMap = resolvePersonDisplayMap({
        activeWorldIds: worldIdsOfKey(worldIdsKeyOf(realtimeState.world?.payload.tracks)),
        personNames: realtimeState.health?.payload.person_names,
        watchNames: realtimeState.health?.payload.watch_names,
        watchRows: rows,
        watchOverrides: overridesOf(overrideState.watchEntries),
        worldOverrides: overridesOf(overrideState.worldEntries),
      });
      for (const bind of added) {
        const person = resolvePersonDisplay(bind.worldId, displayMap);
        useWatchBindEffectStore.getState().announce({ ...bind, person });
      }
    }
    prev.current = new Set(bindings.map(bindKeyOf));
  }, [bindings, loaded]);
  useEffect(() => () => useWatchBindEffectStore.getState().clear(), []);
}

/**
 * 레거시 문자열 배지(World ID → 글). 새 3D 이름표(A안)는 usePersonDisplayMap + personLabels 를 쓴다.
 */
export function useWatchBadges() {
  const { bindings } = useWatchBindingsList();
  const links = useRealtimeStore((s) => linkKeyOf(s.health?.payload.watches));
  return useMemo(
    () => watchBadges(watchRows(watchesOfLinkKey(links), bindings)),
    [links, bindings],
  );
}

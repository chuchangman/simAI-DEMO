import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { DEMO_PPE_LABEL } from '@/features/demo/demoPpe';
import { useNow } from '@/features/layout/useNow';
import { requestPpeCurrent } from '@/features/ppe/api';
import {
  itemStates,
  personPpe,
  ppeLabels,
  type PersonPpe,
  type PpeState,
} from '@/features/ppe/ppeView';
import { api } from '@/lib/api';
import { isLinkAlive, useRealtimeStore } from '@/store/realtime.store';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

/**
 * 연결이 (다시) 열릴 때마다 지금 PPE 상태를 한 번 받아 채운다(GET /api/ppe/current, 명세 12.4).
 * 그 사이 /topic/ppe 로 더 새 스냅샷을 받았으면 덮지 않는다(receivePpe). 실패하면 /topic/ppe 를 기다린다(알리지 않는다).
 */
export function usePpeSnapshot() {
  const openedAt = useRealtimeStore((s) => (s.phase === 'OPEN' ? s.openedAt : null));
  const { data } = useQuery({
    queryKey: ['ppe', 'current', openedAt],
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      return { payloads: await requestPpeCurrent(api, signal), startedAt };
    },
    enabled: openedAt !== null,
    // 연결마다 한 번만 받는다. 그 뒤는 /topic/ppe 가 갱신한다.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!data) return;
    // 받은 시각은 요청을 보낸 때로 둔다. 응답이 늦어도 만료를 늦게 보지 않는다.
    for (const payload of data.payloads) {
      useRealtimeStore.getState().receivePpe({ payload, receivedAt: data.startedAt });
    }
  }, [data]);
}

/** 지금 그리는 트랙(놓친 트랙 제외)의 World ID·차수. 사람·차수가 바뀔 때만 새 문자열이라 10 Hz world 에 다시 그리지 않는다. */
function useTrackKey(): string {
  return useRealtimeStore(
    (s) =>
      s.world?.payload.tracks
        .filter((t) => t.track_lifecycle !== 'LOST')
        .map((t) => `${t.world_id}\u0000${t.identity_revision}`)
        .join('\u0001') ?? '',
  );
}

function tracksOf(key: string) {
  if (!key) return [];
  return key.split('\u0001').map((part) => {
    const [worldId = '', revision = '0'] = part.split('\u0000');
    return { worldId, identityRevision: Number(revision) };
  });
}

/** 내용이 같으면 이전 객체를 그대로 돌려준다(이름표·3D 가 1초마다 다시 그리지 않게). */
function useSameRecord<T>(next: Record<string, T>): Readonly<Record<string, T>> {
  const key = JSON.stringify(next);
  return useMemo(() => JSON.parse(key) as Record<string, T>, [key]);
}

/** 1초마다 다시 보는 PPE 입력(만료·연결 끊김을 다음 스냅샷 전에도 반영). */
function usePpeInputs() {
  const now = useNow(1000);
  const snapshots = useRealtimeStore((s) => s.ppe);
  const linkAlive = useRealtimeStore((s) => isLinkAlive(s, now));
  const trackKey = useTrackKey();
  return { now, snapshots, linkAlive, trackKey };
}

const NO_STATES: Record<string, PpeState> = {};

/**
 * 3D 에 넘길 사람별 안전모·조끼 상태(뷰어 `personHelmets`·`personVests`). 각각 상태가 바뀔 때만 새 객체다.
 * 입력(1초 시계·스냅샷·트랙)은 한 번만 읽는다. 시연 계정은 조끼 상태를 넘기지 않는다(features/demo/demoPpe).
 */
export function usePpeGearStates(): {
  helmets: Readonly<Record<string, PpeState>>;
  vests: Readonly<Record<string, PpeState>>;
} {
  const { now, snapshots, linkAlive, trackKey } = usePpeInputs();
  const demo = useIsDemoAccount();
  const tracks = tracksOf(trackKey);
  return {
    helmets: useSameRecord(itemStates(snapshots, tracks, now, linkAlive, 'helmet')),
    vests: useSameRecord(demo ? NO_STATES : itemStates(snapshots, tracks, now, linkAlive, 'vest')),
  };
}

/**
 * 3D 이름표 뒤에 붙일 사람별 PPE 글(뷰어 `personBadges` 에 워치 글과 함께 넘긴다, S15P31A101-656).
 * 착용이 아닌 사람만 담는다. 글이 바뀔 때만 새 객체다(근거 경과 시각은 10초 단위라 1초마다 바뀌지 않는다).
 * 시연 계정은 안전모 미착용만 쓴다(조끼·모름 없음, features/demo/demoPpe).
 */
export function usePpeLabels(): Readonly<Record<string, string>> {
  const { now, snapshots, linkAlive, trackKey } = usePpeInputs();
  const scope = useIsDemoAccount() ? DEMO_PPE_LABEL : undefined;
  return useSameRecord(ppeLabels(snapshots, tracksOf(trackKey), now, linkAlive, scope));
}

/**
 * 사람 하나의 PPE 상태(안전모·조끼·사유·마지막 근거 시각). 지금 트랙이 없거나 붙일 상태가 없으면 null.
 * 이름표 글·보호구 카드 같은 화면 표시는 프론트 디자인이 이 훅으로 그린다(3D 에는 미착용 경고 표식만 그린다, -531·-552·-783).
 */
export function usePersonPpe(worldId: string | null): PersonPpe | null {
  const { now, snapshots, linkAlive, trackKey } = usePpeInputs();
  if (!worldId) return null;
  const track = tracksOf(trackKey).find((t) => t.worldId === worldId);
  if (!track) return null;
  return personPpe(snapshots, worldId, track.identityRevision, now, linkAlive);
}

import { requestHealth } from '@/features/layout/api';
import {
  deletePersonWorldDisplayName,
  deleteWatchDisplayName,
  putPersonWorldDisplayName,
  putWatchDisplayName,
} from '@/features/people/api';
import {
  normalizeDisplayName,
  personNamesKeyOf,
  personNamesOfKey,
  resolvePersonDisplay,
  resolvePersonDisplayMap,
  watchNamesKeyOf,
  watchNamesOfKey,
  worldIdsKeyOf,
  worldIdsOfKey,
  type PersonDisplayInfo,
  type PersonDisplayMap,
} from '@/features/people/personDisplay';
import {
  overridesOf,
  usePersonNameOverrideStore,
} from '@/features/people/personNameOverride.store';
import { useCachedWatchBindings } from '@/features/watch/useWatch';
import { linkKeyOf, watchesOfLinkKey, watchRows } from '@/features/watch/watchStatus';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useRealtimeStore } from '@/store/realtime.store';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 실시간 관제 전체가 공유하는 단일 사람 표시 어댑터 훅(World ID → {이름, 출처, 중복 여부, 워치 상태}).
 * 10 Hz 좌표·1 Hz 시계/배터리 변화로는 다시 계산하지 않고, 트랙 ID 집합·이름 목록·워치 연결·배정·낙관적 변경이 바뀔 때만 새 맵을 만든다.
 */
export function usePersonDisplayMap(): PersonDisplayMap {
  const bindings = useCachedWatchBindings();
  const worldKey = useRealtimeStore((s) => worldIdsKeyOf(s.world?.payload.tracks));
  const personKey = useRealtimeStore((s) => personNamesKeyOf(s.health?.payload.person_names));
  const watchKey = useRealtimeStore((s) => watchNamesKeyOf(s.health?.payload.watch_names));
  const linksKey = useRealtimeStore((s) => linkKeyOf(s.health?.payload.watches));
  const watchEntries = usePersonNameOverrideStore((s) => s.watchEntries);
  const worldEntries = usePersonNameOverrideStore((s) => s.worldEntries);

  const personNames = useMemo(() => personNamesOfKey(personKey), [personKey]);
  const watchNames = useMemo(() => watchNamesOfKey(watchKey), [watchKey]);

  useEffect(() => {
    usePersonNameOverrideStore.getState().reconcile(watchNames, personNames);
  }, [watchNames, personNames]);

  return useMemo(() => {
    const rows = watchRows(watchesOfLinkKey(linksKey), bindings);
    return resolvePersonDisplayMap({
      activeWorldIds: worldIdsOfKey(worldKey),
      personNames,
      watchNames,
      watchRows: rows,
      watchOverrides: overridesOf(watchEntries),
      worldOverrides: overridesOf(worldEntries),
    });
  }, [worldKey, personNames, watchNames, linksKey, bindings, watchEntries, worldEntries]);
}

/** 선택된 한 사람의 표시 정보. worldId 가 null 이면 null. */
export function usePersonDisplay(worldId: string | null): PersonDisplayInfo | null {
  const map = usePersonDisplayMap();
  return useMemo(() => (worldId ? resolvePersonDisplay(worldId, map) : null), [worldId, map]);
}

async function refreshHealthSnapshot() {
  try {
    const startedAt = Date.now();
    const message = await requestHealth(api);
    useRealtimeStore.getState().receiveHealth({
      payload: message.payload,
      receivedAt: startedAt,
      clockOffsetMs: message.sent_at - startedAt,
    });
  } catch {
    // STOMP /topic/health 가 곧바로 새 스냅샷을 밀어주므로 스냅샷 보강 실패는 무시한다
  }
}

function errorMessageOf(err: unknown): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.serverMessage) {
    return err.serverMessage;
  }
  return '표시 이름을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

/**
 * 사람 상세 패널의 이름 변경·초기화 동작(낙관적 즉시 반영 + 서버 응답 확인 + 실패 시 롤백).
 * 워치가 배정된 사람은 권장 경로인 워치 기기 표시 이름(a)을 고치고, 기존 당일 World ID 수동 이름이 가리고 있으면 함께 비운다.
 * 워치가 없는 사람은 현재 World ID 당일 표시 이름(b)을 고친다.
 */
export function usePersonRename() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback(async (person: PersonDisplayInfo, rawName: string): Promise<boolean> => {
    const checked = normalizeDisplayName(rawName);
    if (!checked.ok) {
      setError(checked.message);
      return false;
    }
    const nextName = checked.value;
    const store = usePersonNameOverrideStore.getState();
    setError(null);
    setBusy(true);

    const deviceId = person.watch.deviceId;
    if (deviceId !== null) {
      // 워치 배정 작업자: (a) 워치 기기 표시 이름에 저장. 당일 World 수동 이름이 남아 있으면 함께 비워 워치 이름이 바로 보이게 한다.
      const hadWorldManual = person.nameSource === 'WORLD_MANUAL';
      const rollbackWatch = store.beginWatchOverride(deviceId, {
        kind: 'SET',
        displayName: nextName,
      });
      const rollbackWorld = hadWorldManual
        ? store.beginWorldOverride(person.worldId, { kind: 'CLEAR' })
        : null;
      try {
        const saved = await putWatchDisplayName(api, deviceId, nextName);
        if (hadWorldManual) {
          await deletePersonWorldDisplayName(api, person.worldId);
          store.confirmWorldOverride(person.worldId, { kind: 'CLEAR' });
        }
        store.confirmWatchOverride(deviceId, { kind: 'SET', displayName: saved.display_name });
        void refreshHealthSnapshot();
        return true;
      } catch (err) {
        rollbackWatch();
        rollbackWorld?.();
        setError(errorMessageOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    }

    // 워치 미배정 작업자: (b) 현재 World ID 에 당일 한정 이름 저장
    const rollbackWorld = store.beginWorldOverride(person.worldId, {
      kind: 'SET',
      displayName: nextName,
    });
    try {
      const saved = await putPersonWorldDisplayName(api, person.worldId, nextName);
      store.confirmWorldOverride(person.worldId, {
        kind: 'SET',
        displayName: saved.display_name,
      });
      void refreshHealthSnapshot();
      return true;
    } catch (err) {
      rollbackWorld();
      setError(errorMessageOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const resetName = useCallback(async (person: PersonDisplayInfo): Promise<boolean> => {
    const store = usePersonNameOverrideStore.getState();
    setError(null);
    setBusy(true);

    if (person.nameSource === 'WORLD_MANUAL') {
      const rollback = store.beginWorldOverride(person.worldId, { kind: 'CLEAR' });
      try {
        await deletePersonWorldDisplayName(api, person.worldId);
        store.confirmWorldOverride(person.worldId, { kind: 'CLEAR' });
        void refreshHealthSnapshot();
        return true;
      } catch (err) {
        rollback();
        setError(errorMessageOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    }

    if (person.nameSource === 'WATCH_DEVICE' && person.watch.deviceId !== null) {
      const deviceId = person.watch.deviceId;
      const rollback = store.beginWatchOverride(deviceId, { kind: 'CLEAR' });
      try {
        await deleteWatchDisplayName(api, deviceId);
        store.confirmWatchOverride(deviceId, { kind: 'CLEAR' });
        void refreshHealthSnapshot();
        return true;
      } catch (err) {
        rollback();
        setError(errorMessageOf(err));
        return false;
      } finally {
        setBusy(false);
      }
    }

    setBusy(false);
    return true;
  }, []);

  return { save, resetName, busy, error, clearError };
}

import type {
  NameOverride,
  ViewerHealthPersonName,
  ViewerHealthWatchName,
} from '@/features/people/personDisplay';
import { create } from 'zustand';

// 이름 변경 직후 서버 health 스냅샷·STOMP 를 기다리지 않고 즉시 화면에 반영하기 위한 낙관적 덮어쓰기 저장소(S15P31A101-658).
// 서버 응답 실패 시 이전 상태로 되돌리고, 서버 health 가 같은 값을 싣기 시작하면 덮어쓰기를 정리한다.

interface OverrideEntry {
  seq: number;
  override: NameOverride;
  confirmed: boolean;
}

interface State {
  watchEntries: Readonly<Record<string, OverrideEntry>>;
  worldEntries: Readonly<Record<string, OverrideEntry>>;
  beginWatchOverride: (deviceId: string, override: NameOverride) => () => void;
  confirmWatchOverride: (deviceId: string, override: NameOverride) => void;
  beginWorldOverride: (worldId: string, override: NameOverride) => () => void;
  confirmWorldOverride: (worldId: string, override: NameOverride) => void;
  reconcile: (
    watchNames: readonly ViewerHealthWatchName[] | undefined,
    personNames: readonly ViewerHealthPersonName[] | undefined,
  ) => void;
  reset: () => void;
}

let nextSeq = 0;

export function overridesOf(
  entries: Readonly<Record<string, OverrideEntry>>,
): Readonly<Record<string, NameOverride>> {
  const out: Record<string, NameOverride> = {};
  for (const [key, entry] of Object.entries(entries)) {
    out[key] = entry.override;
  }
  return out;
}

export const usePersonNameOverrideStore = create<State>()((set, get) => ({
  watchEntries: {},
  worldEntries: {},

  beginWatchOverride: (deviceId, override) => {
    const seq = ++nextSeq;
    const prev = get().watchEntries[deviceId];
    set({
      watchEntries: {
        ...get().watchEntries,
        [deviceId]: { seq, override, confirmed: false },
      },
    });
    return () => {
      const current = get().watchEntries[deviceId];
      if (!current || current.seq !== seq) return;
      const copy = { ...get().watchEntries };
      if (prev) copy[deviceId] = prev;
      else delete copy[deviceId];
      set({ watchEntries: copy });
    };
  },

  confirmWatchOverride: (deviceId, override) => {
    const current = get().watchEntries[deviceId];
    const seq = current?.seq ?? ++nextSeq;
    set({
      watchEntries: {
        ...get().watchEntries,
        [deviceId]: { seq, override, confirmed: true },
      },
    });
  },

  beginWorldOverride: (worldId, override) => {
    const seq = ++nextSeq;
    const prev = get().worldEntries[worldId];
    set({
      worldEntries: {
        ...get().worldEntries,
        [worldId]: { seq, override, confirmed: false },
      },
    });
    return () => {
      const current = get().worldEntries[worldId];
      if (!current || current.seq !== seq) return;
      const copy = { ...get().worldEntries };
      if (prev) copy[worldId] = prev;
      else delete copy[worldId];
      set({ worldEntries: copy });
    };
  },

  confirmWorldOverride: (worldId, override) => {
    const current = get().worldEntries[worldId];
    const seq = current?.seq ?? ++nextSeq;
    set({
      worldEntries: {
        ...get().worldEntries,
        [worldId]: { seq, override, confirmed: true },
      },
    });
  },

  reconcile: (watchNames, personNames) => {
    const { watchEntries, worldEntries } = get();
    const watchMap = new Map((watchNames ?? []).map((w) => [w.device_id, w.display_name] as const));
    const personMap = new Map((personNames ?? []).map((p) => [p.world_id, p] as const));

    let watchChanged = false;
    const nextWatch: Record<string, OverrideEntry> = {};
    for (const [deviceId, entry] of Object.entries(watchEntries)) {
      if (!entry.confirmed) {
        nextWatch[deviceId] = entry;
        continue;
      }
      const serverVal = watchMap.get(deviceId);
      const synced =
        entry.override.kind === 'SET'
          ? serverVal === entry.override.displayName
          : serverVal === undefined;
      if (synced) watchChanged = true;
      else nextWatch[deviceId] = entry;
    }

    let worldChanged = false;
    const nextWorld: Record<string, OverrideEntry> = {};
    for (const [worldId, entry] of Object.entries(worldEntries)) {
      if (!entry.confirmed) {
        nextWorld[worldId] = entry;
        continue;
      }
      const serverPerson = personMap.get(worldId);
      const synced =
        entry.override.kind === 'SET'
          ? serverPerson?.name_source === 'WORLD_MANUAL' &&
            serverPerson.display_name === entry.override.displayName
          : serverPerson?.name_source !== 'WORLD_MANUAL';
      if (synced) worldChanged = true;
      else nextWorld[worldId] = entry;
    }

    if (watchChanged || worldChanged) {
      set({
        watchEntries: watchChanged ? nextWatch : watchEntries,
        worldEntries: worldChanged ? nextWorld : worldEntries,
      });
    }
  },

  reset: () => set({ watchEntries: {}, worldEntries: {} }),
}));

import { createSafeStorage } from '@/lib/safeStorage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 「세팅 취소」로 버린 세팅 세션(작업별). 서버는 작업에 세팅 세션 기록이 하나라도 있으면 그 날을 세팅 단계(progress SETUP)로 두고
// 작업의 세션(work_unit.active_setup_session_id)도 그대로 남기므로, 이 브라우저는 버린 세션을 이어받지 않고 날짜 화면을 TBM 보고서로
// 되돌린다. 새 세팅을 시작하면 작업의 세션이 바뀌어 저절로 풀린다. 새로고침해도 이어지게 브라우저에 남긴다.

export const ABANDONED_SETUP_KEY = 'simai.setup.abandoned';

/** 남겨 둘 작업 수(오래된 것부터 버린다). */
const KEEP_WORKS = 20;

/** [작업 ID, 버린 세팅 세션 ID]. */
type AbandonedEntry = readonly [workId: string, setupSessionId: string];

interface AbandonedSetupState {
  /** 버린 순서(오래된 것 먼저). 작업마다 마지막으로 버린 세션 하나만 둔다. */
  entries: readonly AbandonedEntry[];
  /** 작업의 세팅 세션을 버린다. */
  abandon: (workId: string | number, setupSessionId: string) => void;
}

type Saved = Pick<AbandonedSetupState, 'entries'>;

const isEntry = (value: unknown): value is AbandonedEntry =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string';

/** 남은 값이 깨졌으면 버린 세션이 없는 것으로 본다. */
const savedEntries = (saved: unknown): readonly AbandonedEntry[] => {
  if (typeof saved !== 'object' || saved === null) return [];
  const { entries } = saved as { entries?: unknown };
  return Array.isArray(entries) ? entries.filter(isEntry) : [];
};

export const useAbandonedSetupStore = create<AbandonedSetupState>()(
  persist(
    (set) => ({
      entries: [],
      abandon: (workId, setupSessionId) =>
        set((state) => {
          const key = String(workId);
          const kept = state.entries.filter(([id]) => id !== key);
          return { entries: [...kept, [key, setupSessionId] as const].slice(-KEEP_WORKS) };
        }),
    }),
    {
      name: ABANDONED_SETUP_KEY,
      storage: createSafeStorage<Saved>(),
      partialize: (state) => ({ entries: state.entries }),
      merge: (saved, current) => ({ ...current, entries: savedEntries(saved) }),
    },
  ),
);

/** 작업의 이 세팅 세션을 「세팅 취소」로 버렸는가. 세션이 없으면 false. */
export function useIsAbandonedSetupSession(
  workId: string | number,
  setupSessionId: string | null | undefined,
): boolean {
  const key = String(workId);
  return useAbandonedSetupStore(
    (state) =>
      Boolean(setupSessionId) &&
      state.entries.some(([id, sessionId]) => id === key && sessionId === setupSessionId),
  );
}

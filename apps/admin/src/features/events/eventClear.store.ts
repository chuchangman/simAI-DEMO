import { createSafeStorage } from '@/lib/safeStorage';
import { useSessionStore } from '@/store/session.store';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 이벤트 목록에서 「모두 지우기」를 누른 기준. 화면에서만 숨기고 서버와 이벤트 캐시는 그대로다.
// 새로고침해도 이어지게 브라우저에 남기되, 지운 사용자에게만 적용한다.

export const EVENT_CLEAR_KEY = 'simai.events.cleared';

interface EventClearState {
  /** 지운 기준 시각(이벤트의 EC2 ms, 브라우저 시계가 아니다). 이 시각까지 시작된 경보를 숨긴다. 지운 적이 없으면 null. */
  clearedAt: number | null;
  /** 지운 사용자 ID. 다른 사용자로 로그인하면 이 기록을 적용하지 않는다. 지운 적이 없으면 null. */
  clearedBy: string | null;
  /** 지금 로그인한 사용자가 eventAt 까지 시작된 경보를 모두 숨긴다. 로그인한 사용자가 없으면 아무것도 하지 않는다. */
  clearAll: (eventAt: number) => void;
  /** 지운 기록을 버린다(로그아웃·다른 계정). */
  reset: () => void;
}

type Saved = Pick<EventClearState, 'clearedAt' | 'clearedBy'>;

const NEVER_CLEARED: Saved = { clearedAt: null, clearedBy: null };

/**
 * 지운 기준은 지금을 넘지 않게 한다. 장비 시계 오류로 발생 시각이 미래인 이벤트 하나가 기준을 그 시각까지 밀면
 * 그 사이 새로 온 경보가 모두 숨고, 목록이 비어 「모두 지우기」 버튼도 사라져 되돌릴 방법이 없다.
 */
const notAfterNow = (at: number) => Math.min(at, Date.now());

/** 남은 값이 (유한한 시각, 사용자 ID) 한 쌍이 아니면 지운 적 없는 것으로 본다. 미래 시각이 남아 있으면 지금으로 낮춘다. */
const savedClear = (saved: unknown): Saved => {
  if (typeof saved !== 'object' || saved === null) return NEVER_CLEARED;
  const { clearedAt, clearedBy } = saved as Partial<Record<keyof Saved, unknown>>;
  return typeof clearedAt === 'number' &&
    Number.isFinite(clearedAt) &&
    typeof clearedBy === 'string' &&
    clearedBy !== ''
    ? { clearedAt: notAfterNow(clearedAt), clearedBy }
    : NEVER_CLEARED;
};

export const useEventClearStore = create<EventClearState>()(
  persist(
    (set) => ({
      ...NEVER_CLEARED,
      clearAll: (eventAt) => {
        const userId = useSessionStore.getState().session?.user.id;
        if (userId !== undefined) set({ clearedAt: notAfterNow(eventAt), clearedBy: userId });
      },
      reset: () => set(NEVER_CLEARED),
    }),
    {
      name: EVENT_CLEAR_KEY,
      storage: createSafeStorage<Saved>(),
      partialize: (s) => ({ clearedAt: s.clearedAt, clearedBy: s.clearedBy }),
      merge: (saved, current) => ({ ...current, ...savedClear(saved) }),
    },
  ),
);

/** 지금 로그인한 사용자가 지운 기준 시각. 지운 적이 없거나 다른 사용자가 지운 기록이면 null. */
export function useClearedAt(): number | null {
  const userId = useSessionStore((s) => s.session?.user.id);
  return useEventClearStore((s) =>
    userId !== undefined && s.clearedBy === userId ? s.clearedAt : null,
  );
}

/** 사용자가 끝날 때(bindSession) 지운 기록을 비운다. */
export const resetEventClear = () => useEventClearStore.getState().reset();

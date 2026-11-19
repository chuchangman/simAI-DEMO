import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// 작업 관리에서 마지막으로 연 날짜 화면. 다른 화면에 갔다가 하단 메뉴로 돌아올 때 그 날짜 화면으로 되돌리는 데 쓴다.
// 달력으로 나가면 비운다. 새로고침해도 이어지게 sessionStorage 에 남기되, 창을 닫으면 사라진다.

const WORK_NAV_KEY = 'simai.work.nav';

interface WorkNavState {
  /** 열려 있던 날짜 화면의 날짜 키(YYYY-MM-DD). 달력 화면이면 null. */
  lastDayDate: string | null;
  setLastDayDate: (date: string | null) => void;
}

type Saved = Pick<WorkNavState, 'lastDayDate'>;

export const useWorkNavStore = create<WorkNavState>()(
  persist(
    (set) => ({
      lastDayDate: null,
      setLastDayDate: (lastDayDate) => set({ lastDayDate }),
    }),
    {
      name: WORK_NAV_KEY,
      storage: createJSONStorage<Saved>(() => sessionStorage),
      partialize: (s) => ({ lastDayDate: s.lastDayDate }),
    },
  ),
);

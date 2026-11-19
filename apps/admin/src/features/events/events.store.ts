import { create } from 'zustand';

interface EventsState {
  /** 이벤트 패널에서 상세로 연 이벤트. 경보 배너(모든 화면)의 「상세」와 실시간 관제 패널이 같이 쓴다. */
  openEventId: string | null;
  openEvent: (eventId: string | null) => void;
}

export const useEventsStore = create<EventsState>()((set) => ({
  openEventId: null,
  openEvent: (openEventId) => set({ openEventId }),
}));

import { create } from 'zustand';

interface ZoneEditModeState {
  /** 실시간 관제 화면이 관리자 구역 편집 모드인지. */
  editing: boolean;
  start: () => void;
  stop: () => void;
}

// 실시간 관제 화면의 관리자 편집 모드. 화면(도구 모음·관제 틀·구역 편집)이 함께 보는 값이라 스토어에 둔다. 메모리에만 두어
// 새로고침하면 꺼진다. 고치던 초안은 zoneEdit.store 가 따로 남긴다.
export const useZoneEditModeStore = create<ZoneEditModeState>()((set) => ({
  editing: false,
  start: () => set({ editing: true }),
  stop: () => set({ editing: false }),
}));

/** 컴포넌트 밖(이벤트 처리기·세션 정리)에서 편집 모드를 켠다. */
export const startZoneEdit = () => useZoneEditModeStore.getState().start();

/** 컴포넌트 밖에서 편집 모드를 끈다. 고치던 초안은 지우지 않는다. */
export const stopZoneEdit = () => useZoneEditModeStore.getState().stop();

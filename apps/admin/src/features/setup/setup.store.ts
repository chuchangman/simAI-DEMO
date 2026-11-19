import { create } from 'zustand';

// 현장 세팅 2단계 이후(세션 추적·AI 초안 수락/버리기·구역 발행 뒤 TBM 이동 연결, S15P31A101-453) 클라이언트 상태.
// AI 초안 수락은 useAcceptZoneDraft 가 구역 저장(POST /api/zones/commit)으로 바로 구역을 만들고, 여기에는 수락한 초안 ID 만 남긴다.

interface SetupFlowState {
  activeSessionId: string | null;
  /**
   * 작업의 서버 세션(work_unit.active_setup_session_id)을 따라 옮긴 세션(S15P31A101-689: 새로고침·다른 탭). 세팅 화면은 이 값이 바뀌면
   * 그 세션의 단계를 서버 상태에서 다시 정한다. 화면에서 직접 시작·다시 시도한 세션은 여기에 넣지 않는다.
   */
  restoreSessionId: string | null;
  acceptedDraftIds: string[];
  discardedDraftIds: string[];
  zonesCommitted: boolean;
}

const INITIAL_STATE: SetupFlowState = {
  activeSessionId: null,
  restoreSessionId: null,
  acceptedDraftIds: [],
  discardedDraftIds: [],
  zonesCommitted: false,
};

export const useSetupFlowStore = create<SetupFlowState>(() => ({
  ...INITIAL_STATE,
}));

/** 세팅 세션을 고른다. 다른 세션으로 바뀌면 지난 세션의 초안 수락·버리기와 구역 발행 표시를 잊는다. */
export function setActiveSetupSessionId(sessionId: string | null) {
  useSetupFlowStore.setState((state) => {
    if (sessionId === state.activeSessionId) return state;
    return {
      ...state,
      activeSessionId: sessionId,
      acceptedDraftIds: [],
      discardedDraftIds: [],
      zonesCommitted: false,
    };
  });
}

/** 작업의 서버 세션으로 옮긴다(새로고침·다른 탭에서 바뀐 시도, S15P31A101-689). 세션 고르기와 같고 다시 정할 세션으로 표시한다. */
export function followServerSetupSession(sessionId: string) {
  setActiveSetupSessionId(sessionId);
  useSetupFlowStore.setState({ restoreSessionId: sessionId });
}

/** AI 구역 초안 하나로 구역을 만들었다(수락)고 기록한다. */
export function markSetupZoneDraftAccepted(candidateId: string) {
  useSetupFlowStore.setState((state) => ({
    ...state,
    acceptedDraftIds: state.acceptedDraftIds.includes(candidateId)
      ? state.acceptedDraftIds
      : [...state.acceptedDraftIds, candidateId],
    discardedDraftIds: state.discardedDraftIds.filter((id) => id !== candidateId),
  }));
}

/** AI 구역 초안 하나를 버린다. */
export function discardSetupZoneDraft(candidateId: string) {
  useSetupFlowStore.setState((state) => ({
    ...state,
    discardedDraftIds: state.discardedDraftIds.includes(candidateId)
      ? state.discardedDraftIds
      : [...state.discardedDraftIds, candidateId],
    acceptedDraftIds: state.acceptedDraftIds.filter((id) => id !== candidateId),
  }));
}

/** 구역 발행(POST /api/zones/commit 또는 POST /api/config-bundles)이 완료되었음을 표시한다. */
export function markSetupZonesCommitted() {
  useSetupFlowStore.setState({ zonesCommitted: true });
}

/** 세팅 흐름 스토어를 초기화한다(시험·세션 초기화용). */
export function resetSetupFlowStore() {
  useSetupFlowStore.setState({ ...INITIAL_STATE });
}

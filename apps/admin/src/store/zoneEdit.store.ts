import { isEmptyDraft, withoutName, type TargetDraft } from '@/features/zones/zoneEditModel';
import { create } from 'zustand';

type Drafts = Readonly<Record<string, TargetDraft>>;

/**
 * 되돌릴 한 단계: 고치기 직전의 초안(undefined 는 초안이 없던 때)과, 이어서 고치면 이 단계에 묶을 묶음 이름.
 * 초안은 고칠 때마다 새로 만들어지므로 참조를 그대로 둔다.
 */
export interface HistoryStep {
  draft: TargetDraft | undefined;
  group: string | undefined;
}
type Histories = Readonly<Record<string, readonly HistoryStep[]>>;

/** 구역(키)마다 남기는 되돌리기 단계의 상한. 넘으면 가장 오래된 것부터 버린다. */
export const HISTORY_LIMIT = 100;

interface ZoneEditState {
  /** 구역 ID(또는 새 구역 키)마다 저장 전 초안. 서버에 저장한 값이 아니다. */
  drafts: Drafts;
  /** 구역 ID(또는 새 구역 키)마다 되돌릴 단계(오래된 것이 앞). */
  history: Histories;
  /** 초안 하나를 고친다. 고친 것이 하나도 없는 초안은 지운다. */
  update: (key: string, next: (prev: TargetDraft | undefined) => TargetDraft) => void;
  /** 초안 하나와 그 되돌리기 기록을 함께 버린다. */
  remove: (key: string) => void;
  /** 고치기 직전에 부른다. 지금 초안을 되돌릴 단계로 쌓되, 직전 단계와 group 이 같으면 새로 쌓지 않고 그 단계에 묶는다. */
  record: (key: string, group?: string) => void;
  /** 마지막 단계의 초안으로 되돌린다. 되돌릴 단계가 없으면 false. */
  undo: (key: string) => boolean;
  /** 마지막 단계를 되돌리지 않고 버린다(고친 것이 없었던 단계). */
  discardRecord: (key: string) => void;
  /** 한 구역의 되돌리기 기록을 비운다(저장해서 되돌릴 기준이 바뀐 때). */
  resetHistory: (key: string) => void;
  clear: () => void;
}

const omit = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));

/** 한 구역의 단계 목록을 바꾼다. 비면 그 구역 칸을 지운다. */
const withSteps = (history: Histories, key: string, steps: readonly HistoryStep[]): Histories =>
  steps.length > 0 ? { ...history, [key]: steps } : omit(history, key);

// 편집 모드를 끌 때는 고치던 초안을 확인한 뒤 버린다. 초안이 남는 경우는 관제 화면을 떠났다 올 때뿐이다(떠날 때는 편집 모드만
// 끄고 초안은 남겨, 돌아와 이어 고친다). 그래서 앱 세션 동안 여기에 둔다(메모리에만 둔다).
// 되돌리기 기록도 초안과 같이 둔다. 로그아웃·다른 계정·권한 변경은 bindSession 이 clearZoneDrafts 로 비운다.
export const useZoneEditStore = create<ZoneEditState>()((set, get) => ({
  drafts: {},
  history: {},
  update: (key, next) =>
    set((state) => {
      const value = next(state.drafts[key]);
      if (!isEmptyDraft(value)) return { drafts: { ...state.drafts, [key]: value } };
      return key in state.drafts ? { drafts: omit(state.drafts, key) } : state;
    }),
  remove: (key) => {
    get().resetHistory(key);
    set((state) => (key in state.drafts ? { drafts: omit(state.drafts, key) } : state));
  },
  record: (key, group) =>
    set((state) => {
      const steps = state.history[key] ?? [];
      if (group !== undefined && steps.at(-1)?.group === group) return state;
      const next = [...steps, { draft: state.drafts[key], group }].slice(-HISTORY_LIMIT);
      return { history: withSteps(state.history, key, next) };
    }),
  undo: (key) => {
    const { drafts, history } = get();
    const steps = history[key] ?? [];
    const last = steps.at(-1);
    if (!last) return false;
    set({
      drafts: last.draft ? { ...drafts, [key]: last.draft } : omit(drafts, key),
      history: withSteps(history, key, steps.slice(0, -1)),
    });
    return true;
  },
  discardRecord: (key) =>
    set((state) => {
      const steps = state.history[key];
      return steps ? { history: withSteps(state.history, key, steps.slice(0, -1)) } : state;
    }),
  resetHistory: (key) =>
    set((state) => (key in state.history ? { history: omit(state.history, key) } : state)),
  clear: () => set({ drafts: {}, history: {} }),
}));

const anyDrafts = (state: ZoneEditState) => Object.keys(state.drafts).length > 0;

/** 저장하지 않은 초안이 하나라도 있는지. 편집 모드를 끌 때 버릴 것이 있는지 묻는 데 쓴다. */
export const useHasZoneDrafts = () => useZoneEditStore(anyDrafts);

/** 컴포넌트 밖에서 보는 같은 값(화면에 그리지 않는 구독이 쓴다). */
export const hasZoneDrafts = () => anyDrafts(useZoneEditStore.getState());

/** 사용자가 끝나거나 바뀌면(bindSession onUserChange) 보관한 초안과 되돌리기 기록을 모두 지운다. */
export const clearZoneDrafts = () => useZoneEditStore.getState().clear();

/** 컴포넌트 밖(이벤트 처리기·비동기 뒤)에서 초안 하나를 고친다. */
export const updateZoneDraft = (
  key: string,
  next: (prev: TargetDraft | undefined) => TargetDraft,
) => useZoneEditStore.getState().update(key, next);

/** 컴포넌트 밖에서 초안 하나와 그 되돌리기 기록을 버린다. */
export const removeZoneDraft = (key: string) => useZoneEditStore.getState().remove(key);

/**
 * 컴포넌트 밖에서 한 구역 초안의 이름 고침만 버린다(다른 곳에서 이름을 저장해 새 이름이 기준이 된 때). 이름이 섞인
 * 되돌리기 기록은 비운다. 이름 고침이 없는 초안은 건드리지 않는다.
 */
export function dropZoneDraftName(key: string) {
  const { drafts, update, resetHistory } = useZoneEditStore.getState();
  const draft = drafts[key];
  if (draft?.patch.name === undefined) return;
  update(key, () => withoutName(draft));
  resetHistory(key);
}

/** 컴포넌트 밖에서, 고치기 직전의 초안을 되돌릴 단계로 남긴다. */
export const recordZoneDraft = (key: string, group?: string) =>
  useZoneEditStore.getState().record(key, group);

/** 컴포넌트 밖에서 초안 하나를 한 단계 되돌린다. 되돌릴 단계가 없으면 false. */
export const undoZoneDraft = (key: string) => useZoneEditStore.getState().undo(key);

/** 컴포넌트 밖에서 마지막 되돌리기 단계를 되돌리지 않고 버린다. */
export const discardZoneRecord = (key: string) => useZoneEditStore.getState().discardRecord(key);

/**
 * 컴포넌트 밖에서 마지막 되돌리기 단계(없으면 undefined). 단계 객체는 쌓은 뒤 바뀌지 않아서 참조로 비교하면 "내가 남긴
 * 단계가 아직 마지막인가"를 안다(개수는 상한에 닿으면 새로 쌓아도 그대로라 쓰지 않는다).
 */
export const lastZoneRecord = (key: string): HistoryStep | undefined =>
  useZoneEditStore.getState().history[key]?.at(-1);

/** 컴포넌트 밖에서 한 구역의 되돌리기 기록을 비운다. */
export const resetZoneHistory = (key: string) => useZoneEditStore.getState().resetHistory(key);

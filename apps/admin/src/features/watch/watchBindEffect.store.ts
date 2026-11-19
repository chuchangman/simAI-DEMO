import {
  formatWatchBindHighlight,
  formatWatchBindNotice,
  type PersonDisplayInfo,
} from '@/features/people/personDisplay';
import type { NewBind } from '@/features/watch/watchStatus';
import { BIND_METHOD_TEXT } from '@/features/watch/watchStatus';
import { create } from 'zustand';

/** 3D 강조 시간(ms). 관객이 손 흔든 사람을 눈으로 찾아가기에 충분한 4초(이름표 한 번 읽고 시선이 가는 시간) */
export const HIGHLIGHT_MS = 4_000;
/** 패널 알림 시간(ms). 3D 강조보다 조금 더 길게 둔다 */
export const NOTICE_MS = 6_000;

export interface BindNotice {
  id: number;
  text: string;
}

export interface AnnounceBind extends NewBind {
  person?: Pick<PersonDisplayInfo, 'displayName' | 'isDuplicateName' | 'watch'>;
}

interface State {
  /** World ID → 3D 큰 이름표 글. 강조 시간 동안만 있다 */
  highlights: Readonly<Record<string, string>>;
  notice: BindNotice | null;
  announce: (bind: AnnounceBind) => void;
  clear: () => void;
}

let seq = 0;
// 사람마다 가장 최근 알림 번호. 같은 사람에게 다시 이어지면 앞선 타이머가 새 강조를 일찍 지우지 못하게 한다
const latest = new Map<string, number>();
const timers = new Set<ReturnType<typeof setTimeout>>();

/** 새로 이어진 워치의 3D 강조·패널 알림. 단일 사람 표시 어댑터의 이름 문구("⌚ 김철수 연결됨")를 쓴다(S15P31A101-509·-658). */
export const useWatchBindEffectStore = create<State>()((set, get) => ({
  highlights: {},
  notice: null,
  announce: ({ deviceId, worldId, method, person }) => {
    const id = ++seq;
    const resolved = person ?? {
      displayName: '미확인',
      isDuplicateName: false,
      watch: { status: 'connected' as const, deviceId },
    };
    const text = formatWatchBindHighlight(resolved.displayName);
    const noticeText = formatWatchBindNotice(resolved, BIND_METHOD_TEXT[method]);
    latest.set(worldId, id);
    set({
      highlights: { ...get().highlights, [worldId]: text },
      notice: {
        id,
        text: noticeText,
      },
    });
    const drop = setTimeout(() => {
      timers.delete(drop);
      if (latest.get(worldId) === id) {
        latest.delete(worldId);
        const rest = { ...get().highlights };
        delete rest[worldId];
        set({ highlights: rest });
      }
    }, HIGHLIGHT_MS);
    const hide = setTimeout(() => {
      timers.delete(hide);
      if (get().notice?.id === id) set({ notice: null });
    }, NOTICE_MS);
    timers.add(drop);
    timers.add(hide);
  },
  clear: () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    latest.clear();
    set({ highlights: {}, notice: null });
  },
}));

import { isDemoUser } from '@/features/demo/demoAccount';
import type { EventEntry } from '@/features/events/entries';
import type { PpeItemKind } from '@/features/ppe/ppeView';
import { EVENTS_TOPIC } from '@/lib/stomp';

// 시연 계정(features/demo/demoAccount)의 보호구 표시. 시연은 안전모만 보이므로 조끼 이벤트(R11)·조끼 상태는 어디에도 그리지 않고,
// 안전모는 미착용만 보인다(「모름」 글·확인 필요 이유는 지운다). 서버 기록·이벤트 캐시는 그대로다.

/** 조끼 미착용 규칙. */
const VEST_RULE = 'R11';
/** 보호구 상태를 모른다는 확인 필요 이유. */
const PPE_UNKNOWN = 'PPE_UNKNOWN';

/** 시연 계정이 이름표에 보이는 보호구: 안전모 미착용만. */
export const DEMO_PPE_LABEL = {
  items: ['helmet'] as readonly PpeItemKind[],
  unknown: false,
} as const;

const NO_PPE_UNKNOWN = (reason: string) => reason !== PPE_UNKNOWN;

/** 화면에 보일 실시간 이벤트: 조끼 이벤트를 빼고, 남은 이벤트의 보호구 「모름」 이유를 지운다. */
export function demoLiveEntries(entries: readonly EventEntry[]): EventEntry[] {
  return entries
    .filter((entry) => entry.event.rule_id !== VEST_RULE)
    .map((entry) => {
      const reasons = entry.event.confidence_reasons;
      if (!reasons?.includes(PPE_UNKNOWN)) return entry;
      return {
        ...entry,
        event: { ...entry.event, confidence_reasons: reasons.filter(NO_PPE_UNKNOWN) },
      };
    });
}

/** 받은 본문의 규칙 id(계약 검사 전이라 모양을 믿지 않는다). */
function ruleIdOf(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('payload' in raw)) return undefined;
  const { payload } = raw;
  return typeof payload === 'object' && payload !== null && 'rule_id' in payload
    ? payload.rule_id
    : undefined;
}

/** 3D 뷰어에 넘기지 않을 STOMP 본문: 시연 계정의 조끼 이벤트(사람이 빨갛게 강조되지 않게). */
export function demoHidesFromViewer(topic: string, raw: unknown, userId: string): boolean {
  return isDemoUser(userId) && topic === EVENTS_TOPIC && ruleIdOf(raw) === VEST_RULE;
}

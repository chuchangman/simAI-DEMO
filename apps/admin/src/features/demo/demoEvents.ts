import { SEVERITY_RANK } from '@/features/events/constants';
import { isAlarming, type EventEntry } from '@/features/events/entries';
import type { CardGroup, Incident } from '@/features/events/incidents';

// 시연 계정(features/demo/demoAccount)의 관제 이벤트 카드. 시연 계정은 경보 배너·경보음이 없어(S15P31A101-786) 카드가 새 경보를 바로 알려야 한다.
// 카드는 같은 사람·같은 위험을 한 장으로 묶고(S15P31A101-731) 경과를 묶음의 첫 발생부터 세서, 새로 울린 경보도 아래쪽 기존 카드에
// 「10초 전」처럼 보였다. 시연 계정은 확인 대기 경보가 있는 카드를 맨 위에 두고(배너와 같은 순서) 경과를 그 경보가 울린 때부터 센다.

/** 지금 경보 단계가 열린 시각(발생·재개·등급 상향 중 마지막). 기록이 없으면 발생 시각, 그것도 없으면 null. */
const alarmStartOf = (entry: EventEntry): number | null =>
  entry.stageStartedAt ?? entry.event.raised_at ?? null;

/** 카드 안 확인 대기 경보 중 가장 최근에 울린 시각. 확인 대기 경보가 없으면 null. */
export function latestAlarmStartAt(incident: Incident): number | null {
  const times = incident.entries
    .filter(isAlarming)
    .map(alarmStartOf)
    .filter((t): t is number => t !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

/** 배너와 같은 순서: 높은 등급, 같으면 최근에 울린 것 먼저. */
const byAlarmPriority = (a: CardGroup, b: CardGroup) =>
  SEVERITY_RANK[b.incident.severity] - SEVERITY_RANK[a.incident.severity] ||
  (latestAlarmStartAt(b.incident) ?? 0) - (latestAlarmStartAt(a.incident) ?? 0);

/** 확인 대기 경보가 있는 카드를 앞에 두고, 나머지 카드는 받은 순서 그대로 뒤에 둔다. */
export function alarmingCardsFirst(cards: readonly CardGroup[]): CardGroup[] {
  const alarming = cards.filter((card) => card.incident.alarming).sort(byAlarmPriority);
  return [...alarming, ...cards.filter((card) => !card.incident.alarming)];
}

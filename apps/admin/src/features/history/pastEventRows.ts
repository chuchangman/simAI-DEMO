import { SEVERITY_RANK } from '@/features/events/constants';
import { chainItems, occurrencesOf, riskKeyOf } from '@/features/events/incidents';
import type { Severity } from '@/features/events/types';
import { isActiveAt, type EventRow } from '@/features/history/replayIndex';

// 지난 날·다시 보기 이벤트 로그의 줄 묶음(S15P31A101-751). 관제 카드(S15P31A101-731)와 같은 묶음 함수(chainItems)를 쓴다:
// 같은 위험(규칙·구역)을 시각 순으로 잇고, 같은 사람이거나 앞 줄 끝에서 CARD_MERGE_GAP_MS 안에 시작했으면 한 줄이다.
// 지난 기록이라 지금 살아 있는 사람은 없다(alive 가 빈 집합). 트랙 번호가 바뀌며 같은 초에 난 경보가 한 줄 「×n」 이 된다.
// 이벤트·기록은 그대로이고 화면만 묶는다. 같은 줄에 든 사람 수는 줄에 보이고(`people`), 줄은 그 사람들을 hover 로 알린다.

/** 로그 줄 하나. */
export interface PastEventRow {
  key: string;
  /** 줄에서 가장 이른 이벤트(누르면 그 시각으로 옮긴다, 대표 규칙·구역). */
  first: EventRow;
  /** 줄에 든 이벤트(발생순). */
  members: EventRow[];
  /** 줄에서 가장 높은 등급. */
  severity: Severity;
  /** 발생 횟수(해소 뒤 재개 포함). 2 이상이면 「×n」을 보인다. */
  occurrences: number;
  /** 줄에 든 사람(World ID, 처음 나온 순). 사람이 없으면(구역 대상) 빈 배열. */
  people: string[];
}

const NO_ONE_ALIVE: ReadonlySet<string> = new Set();

export function pastEventRows(events: readonly EventRow[]): PastEventRow[] {
  const byRisk = new Map<string, EventRow[]>();
  for (const event of events) {
    const key = riskKeyOf(event.ruleId, event.zoneId);
    const group = byRisk.get(key);
    if (group) group.push(event);
    else byRisk.set(key, [event]);
  }
  const rows: PastEventRow[] = [];
  for (const [risk, group] of byRisk) {
    const items = group.map((event) => ({
      value: event,
      start: event.raisedAt,
      end: event.resolvedAt ?? event.raisedAt,
      person: event.worldIds[0] ?? null,
    }));
    for (const members of chainItems(items, NO_ONE_ALIVE)) {
      const sorted = [...members].sort((a, b) => a.raisedAt - b.raisedAt);
      const first = sorted[0]!;
      rows.push({
        key: `${risk}|${first.eventId}`,
        first,
        members: sorted,
        severity: sorted.reduce(
          (top, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[top] ? e.severity : top),
          first.severity,
        ),
        occurrences: sorted.reduce(
          (sum, e) => sum + occurrencesOf({ resume_count: e.resumeCount }),
          0,
        ),
        people: [...new Set(sorted.flatMap((e) => e.worldIds))],
      });
    }
  }
  return rows.sort((a, b) => a.first.raisedAt - b.first.raisedAt);
}

/** 재생 시각에 줄의 이벤트 중 하나라도 활성이면 활성 줄이다. */
export const isRowActiveAt = (row: PastEventRow, t: number) =>
  row.members.some((event) => isActiveAt(event, t));

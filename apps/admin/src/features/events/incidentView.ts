import { ACK_CHANNEL_LABEL, SERVER_CLOSE_LABEL } from '@/features/events/constants';
import {
  acknowledgedAt,
  entryStatus,
  eventTime,
  isActive,
  isAlarmSeverity,
  isAlarming,
  serverCloseKind,
} from '@/features/events/entries';
import { eventRuleName, formatTime } from '@/features/events/format';
import { topEntry, type Incident } from '@/features/events/incidents';
import { PPE_RELEASE_LABEL, ppeReleaseOf } from '@/features/events/ppePolicy';
import type { EventItem } from '@/features/events/types';
import {
  formatPersonFull,
  formatPersonShort,
  type PersonDisplayMap,
} from '@/features/people/personDisplay';
import type { ConfigBundle } from '@/features/zones/types';
import { zoneNameOrDefault, type ZoneNameOf } from '@/features/zones/zoneName';

// 묶음(Incident)을 카드·상세에 보이는 값으로 바꾸는 계산. 화면 없이 시험한다.

/** 대상 문구: 사람은 `표시 이름 (World ID)`(이름 수신 전이면 World ID), 구역이면 구역 이름(모르면 `구역`). */
export const targetLabel = (
  target: Incident['target'],
  zoneName: ZoneNameOf,
  personNames?: PersonDisplayMap,
) =>
  !target
    ? '대상 없음'
    : target.type === 'person'
      ? formatPersonFull(target.id, personNames)
      : zoneNameOrDefault(target.id, zoneName);

/** 카드·배너의 짧은 대상 문구: 사람은 표시 이름(동명이인이면 끝번호 병기, 수신 전이면 끝번호), 구역은 이름 그대로. */
export const targetShortLabel = (
  target: Incident['target'],
  zoneName: ZoneNameOf,
  personNames?: PersonDisplayMap,
) =>
  target?.type === 'person'
    ? formatPersonShort(target.id, personNames)
    : targetLabel(target, zoneName, personNames);

/** 대상 글꼴: 생 World ID 로 폴백할 때만 고정폭이고, 해석된 사람 이름이나 구역 이름은 본문 글꼴이다. */
export const targetFont = (target: Incident['target'], personNames?: PersonDisplayMap) => {
  if (target?.type !== 'person') return undefined;
  const resolved = personNames?.[target.id];
  return resolved && resolved.nameSource !== 'FALLBACK' ? undefined : 'font-mono';
};

/**
 * 카드 제목: 대표 규칙 이름 · 구역 이름. 대상이 구역이면 카드 둘째 줄에 그 구역이 있어 제목에서는 되풀이하지 않는다.
 * 이름을 모르는 구역은 뺀다.
 */
export function cardTitle(incident: Incident, zoneName: ZoneNameOf): string {
  const event = topEntry(incident).event;
  const own = incident.target?.type === 'zone' ? incident.target.id : null;
  const name = event.zone_id === own ? null : zoneName(event.zone_id);
  return `${eventRuleName(event)}${name ? ` · ${name}` : ''}`;
}

/** 모두 해소된 묶음의 마지막 해소 시각 문구: "해소 12:03:41". */
export function resolvedLabel(incident: Incident): string {
  const times = incident.entries.map((e) => {
    const status = entryStatus(e);
    return status.kind === 'resolved' ? (status.at ?? 0) : 0;
  });
  return `해소 ${formatTime(Math.max(...times))}`;
}

/** 카드 머리줄 오른쪽의 처리 상태 칩 하나. */
export interface CardChip {
  kind: 'ticket' | 'ack' | 'unacked' | 'resolved' | 'stale';
  label: string;
}

/**
 * 처리 상태는 가장 최근 단계 하나만 보인다: 조치 단계 > 확인 시각 > 미확인. 모두 해소되면 해소 시각.
 * 조치 단계(요청됨·반장 확인·조치 중·완료 보고)는 조치 티켓 API(M2)가 생기면 ticketStage 로 넘긴다.
 * 안내·주의만 있는 묶음은 확인할 경보가 없어 칩이 없다.
 */
export function cardChip(
  incident: Incident,
  options: { ticketStage?: string } = {},
): CardChip | null {
  if (!incident.active) return { kind: 'resolved', label: resolvedLabel(incident) };
  // 지난 관제(지금 Tier 0 가 들고 있지 않음)는 경보가 아니다. 미확인·확인 칩 대신 조용한 칩 하나만 둔다(S15P31A101-595).
  if (incident.stale) return { kind: 'stale', label: '지난 관제' };
  const live = incident.entries.filter((e) => isActive(e.event));
  if (options.ticketStage) return { kind: 'ticket', label: options.ticketStage };
  const alarmLevel = live.filter((e) => isAlarmSeverity(e.event.severity));
  if (alarmLevel.length === 0) return null;
  if (alarmLevel.some(isAlarming)) return { kind: 'unacked', label: '미확인' };
  const at = Math.max(...alarmLevel.map((e) => acknowledgedAt(e) ?? 0));
  return { kind: 'ack', label: at > 0 ? `확인 ${formatTime(at)}` : '확인' };
}

export interface TimelineItem {
  at: number;
  who: string;
  text: string;
}

/** 규칙 하나의 타임라인 항목: 발생, 확인들, 해소(운영자 종료). 해소된 R9·R11 는 묶음으로 가린 해소 원인을 쓴다. */
function ruleTimeline(
  event: EventItem,
  bundles: readonly ConfigBundle[] | undefined,
): TimelineItem[] {
  const rule = eventRuleName(event);
  const items: TimelineItem[] = [];
  if (event.raised_at !== undefined) {
    items.push({ at: event.raised_at, who: '시스템', text: `${rule} 발생` });
  }
  for (const ack of event.acks ?? []) {
    items.push({
      at: ack.acked_at,
      who: ACK_CHANNEL_LABEL[ack.channel] ?? ack.channel,
      text: `${rule} 확인 · ${ack.actor_id}`,
    });
  }
  const resolvedAt = isActive(event) ? null : (event.resolved_at ?? eventTime(event));
  if (resolvedAt !== null) {
    const closed = event.resolution?.kind === 'OPERATOR_CLOSED';
    // 병합 흡수 마감(S15P31A101-657)은 위험이 사라진 게 아니라 같은 사람의 남는 이벤트로 이어진 것이다. '해소'라 적지 않는다.
    const merged = event.resolution?.kind === 'IDENTITY_MERGED';
    // EC2 마감(S15P31A101-722)은 Tier 0 가 사라져 닫은 것이다. 위험이 사라졌다는 뜻이 아니라 '해소'라 적지 않는다.
    const serverClosed = serverCloseKind(event);
    const release = closed || merged || serverClosed ? null : ppeReleaseOf(event, bundles);
    const word = closed
      ? '종료'
      : merged
        ? '같은 사람 ID 병합으로 이어짐'
        : serverClosed
          ? SERVER_CLOSE_LABEL[serverClosed]
          : release
            ? PPE_RELEASE_LABEL[release]
            : '해소';
    items.push({ at: resolvedAt, who: closed ? '운영자' : '시스템', text: `${rule} ${word}` });
  }
  return items;
}

/**
 * 사건 상세 타임라인: 규칙마다 발생·확인·해소(운영자 종료)를 시각 순으로. 받은 이벤트 값만으로 만든다. bundles(최근 구성 묶음)를
 * 주면 해소된 R9·R11 의 해소 원인(작업 종료·착용 확인)을 가린다.
 */
export const incidentTimeline = (
  incident: Incident,
  bundles?: readonly ConfigBundle[],
): TimelineItem[] =>
  incident.entries.flatMap((e) => ruleTimeline(e.event, bundles)).sort((a, b) => a.at - b.at);

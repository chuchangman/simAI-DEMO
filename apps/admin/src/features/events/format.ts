import { CONFIDENCE_REASON, METRIC_LABEL, SERVER_CLOSE_LABEL } from '@/features/events/constants';
import { isActive, type EntryStatus } from '@/features/events/entries';
import { PPE_RELEASE_LABEL, type PpeRelease } from '@/features/events/ppePolicy';
import type { EventItem } from '@/features/events/types';
import {
  formatPersonFull,
  formatPersonShort,
  shortPersonId,
  type PersonDisplayMap,
} from '@/features/people/personDisplay';
import { zoneNameOrDefault, type ZoneNameOf } from '@/features/zones/zoneName';
import { ruleName } from '@/lib/ruleNames';
export { ruleName } from '@/lib/ruleNames';

export { shortPersonId };

// 이벤트 값을 화면 문구로 바꾸는 계산. 화면 없이 시험한다.

const TIME = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 이벤트 시각(EC2 ms)을 시:분:초로. */
export const formatTime = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '—' : TIME.format(ms);

/** 이벤트 규칙 이름은 등급과 무관하게 같은 사전을 쓴다. */
export const eventRuleName = (event: Pick<EventItem, 'rule_id' | 'severity'>) =>
  ruleName(event.rule_id);

/** 이벤트 대상 문구: 해석된 사람 이름(없으면 World ID), 사람이 없으면 구역 이름(모르면 `구역`). */
export const eventSubject = (
  event: EventItem,
  zoneName: ZoneNameOf,
  personNames?: PersonDisplayMap,
) => {
  const person = event.world_ids[0];
  if (person !== undefined) return formatPersonFull(person, personNames);
  return event.zone_id ? zoneNameOrDefault(event.zone_id, zoneName) : '';
};

/** 이벤트 대상 문구의 짧은 모양(카드·배너): 사람은 표시 이름(없으면 끝번호), 사람이 없으면 구역 이름. */
export const eventShortSubject = (
  event: EventItem,
  zoneName: ZoneNameOf,
  personNames?: PersonDisplayMap,
) => {
  const person = event.world_ids[0];
  return person === undefined
    ? eventSubject(event, zoneName, personNames)
    : formatPersonShort(person, personNames);
};

/** 규칙 하나의 처리 상태 문구. release 가 있으면(해소된 R9·R11) "해소" 대신 해소 원인을 보인다. */
export function statusText(status: EntryStatus, release: PpeRelease | null = null) {
  switch (status.kind) {
    case 'alarm':
      return '확인 대기';
    case 'acked':
      return `확인 ${formatTime(status.at)}`;
    case 'notice':
      return '안내';
    case 'resolved': {
      const word = status.closed
        ? '운영자 종료'
        : status.serverClosed
          ? SERVER_CLOSE_LABEL[status.serverClosed]
          : release
            ? PPE_RELEASE_LABEL[release]
            : '해소';
      return `${word} ${formatTime(status.at)}`;
    }
  }
}

/** 지표 문구. _m 은 미터, _s 는 초로 보인다. */
export function metricLabels(metrics: EventItem['metrics']): string[] {
  return Object.entries(metrics).map(([key, value]) => {
    const unit = key.endsWith('_m')
      ? 'm'
      : key.endsWith('_s')
        ? '초'
        : key.endsWith('_mps')
          ? 'm/초'
          : '';
    const label = METRIC_LABEL[key] ?? key.replace(/_(m|s)$/, '');
    return `${label} ${value.toFixed(unit === 'm' ? 2 : 1)}${unit}`;
  });
}

/** PPE 불확실성은 이벤트 규칙의 장비 이름을 쓴다. 다른 이유는 공통 문구로 보인다. */
export function confidenceReasonText(reason: string, ruleId: string): string {
  if (reason === 'PPE_UNKNOWN') {
    if (ruleId === 'R9') return '안전모 상태 모름';
    if (ruleId === 'R11') return '조끼 상태 모름';
  }
  return CONFIDENCE_REASON[reason] ?? reason;
}

/** 확인 요청에 붙일 첫 이유 문구. 이유가 없으면 null. */
function firstReasonText(event: EventItem): string | null {
  const first = event.confidence_reasons?.[0];
  return first ? confidenceReasonText(first, event.rule_id) : null;
}

/** 확인 요청 문구: "확인 필요" 에 첫 이유를 붙인다. */
export const confirmationText = (event: EventItem) => {
  const reason = firstReasonText(event);
  return reason ? `확인 필요 · ${reason}` : '확인 필요';
};

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/** 큰 단위와 그 아래 단위를 함께: 아래 단위가 0 이면 큰 단위만 적는다. */
const twoUnits = (big: number, bigUnit: string, small: number, smallUnit: string) =>
  `${big}${bigUnit}${small ? ` ${small}${smallUnit}` : ''}`;

/**
 * 발생 뒤 경과(ms)를 "12초" · "3분 20초" · "2시간 5분"(1시간부터) · "1일 16시간"(하루부터)로.
 * 시계가 어긋나 음수면 0초.
 */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < SECONDS_PER_MINUTE) return `${s}초`;
  if (s < SECONDS_PER_HOUR) {
    return twoUnits(Math.floor(s / SECONDS_PER_MINUTE), '분', s % SECONDS_PER_MINUTE, '초');
  }
  if (s < SECONDS_PER_DAY) {
    const minutes = Math.floor((s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return twoUnits(Math.floor(s / SECONDS_PER_HOUR), '시간', minutes, '분');
  }
  const hours = Math.floor((s % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  return twoUnits(Math.floor(s / SECONDS_PER_DAY), '일', hours, '시간');
}

/** EC2 시계 기준 지금(ms). 이 브라우저 시계에 EC2 와의 차이(health 의 clockOffsetMs)를 더한다. */
export const ec2Now = (now: number, clockOffsetMs: number | undefined) =>
  now + (clockOffsetMs ?? 0);

/** 진입 예측(R5)의 근거 한 줄. 개구부 수치·구역 진입 거리는 사건 상세에만 있다. */
export function entryEtaLine(event: EventItem): string | null {
  if (event.rule_id !== 'R5' || !isActive(event)) return null;
  const eta = event.metrics['time_to_entry_s'];
  return eta !== undefined && Number.isFinite(eta) ? `${eta.toFixed(1)}초 뒤 진입 예상` : null;
}

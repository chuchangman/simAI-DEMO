import { SEVERITY_RANK } from '@/features/events/constants';
import {
  acknowledgedAt,
  isActive,
  isAlarmSeverity,
  type EventEntry,
} from '@/features/events/entries';
import type { EventItem, Severity } from '@/features/events/types';
import type { MonitoringPhase } from '@/features/monitor/monitoringPhase';
import { REPLAY_TEST_ALERTS_LABEL, TEST_INPUT_LABEL } from '@/features/monitor/useTestInput';
import type { WorkReport } from '@/features/work/types';
import { isEndingGenerating } from '@/features/work/workDay';

// 작업 종료 단계의 순수 계산: 걸린 시간, 경보 기록 목록, 관제 적용 상태 줄. 시계는 인자로 받는다.

/** 작업을 시작한 때부터 끝난 때(끝나지 않았으면 now)까지 걸린 시간(ms). 시계가 어긋나 음수면 0. */
export function workDurationMs(startedAt: number, endedAt: number | null, now: number): number {
  return Math.max(0, (endedAt ?? now) - startedAt);
}

/**
 * 작업 시간대의 경보 기록(최근 것이 먼저). 실제 이벤트(LIVE) 중 위험·경고만 센다(작업 목록·달력의 event_counts, 종료 미팅의
 * 위험·경고 수와 같은 정의, S15P31A101-731). 구역 작업(zoneId)이면 그 구역 이벤트만 센다(종료 미팅·작업 목록과 같다).
 * 시작 기록이 없으면 비고, 끝난 시각이 있으면 그때까지만 본다.
 */
export function workEventsOf(
  entries: readonly EventEntry[],
  startedAt: number | null,
  endedAt: number | null = null,
  zoneId: string | null = null,
): EventItem[] {
  if (startedAt === null) return [];
  return entries
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.source === 'LIVE' &&
        isAlarmSeverity(event.severity) &&
        event.raised_at !== undefined &&
        event.raised_at >= startedAt &&
        (endedAt === null || event.raised_at <= endedAt) &&
        (zoneId === null || event.zone_id === zoneId),
    )
    .sort((a, b) => (b.raised_at ?? 0) - (a.raised_at ?? 0));
}

/** 위험 경보 수: 전체, 확인하지 않은 것, 그중 아직 열려 있는 것. */
export interface AlarmCounts {
  total: number;
  /** 아무도 확인하지 않은 것(해소돼 끝난 것도 포함). 종료 뒤 요약이 쓴다. */
  unconfirmed: number;
  /** 아직 열려 있고 지금 경보 단계에서 확인하지 않은 것. 종료하면 확인하지 못한 채 닫히므로 종료 확인창이 쓴다. */
  open: number;
}

/**
 * 한 실행 동안 난 위험 경보(실제 LIVE 의 HIGH 이상, 감사 전용 제외)와 그중 확인하지 않은 수(종료 확인창·종료 뒤 요약, -734).
 * 서버가 준 이벤트 목록과 확인 기록(acks)으로만 센다. 확인 여부는 진행 중이면 지금 경보 단계 기준(등급이 오르거나 재개되면 다시 미확인),
 * 이미 해소됐으면 확인한 적이 있는지다(해소된 이벤트는 확인을 받지 않는다). 시작 기록이 없으면 0건, endedAt 이 있으면 그때까지만 본다.
 */
export function alarmCountsOf(
  entries: readonly EventEntry[],
  startedAt: number | null,
  endedAt: number | null = null,
): AlarmCounts {
  if (startedAt === null) return { total: 0, unconfirmed: 0, open: 0 };
  const alarms = entries.filter(({ event }) => {
    const at = event.raised_at;
    return (
      event.source === 'LIVE' &&
      event.delivery !== 'AUDIT_ONLY' &&
      isAlarmSeverity(event.severity) &&
      at !== undefined &&
      at >= startedAt &&
      (endedAt === null || at <= endedAt)
    );
  });
  const unconfirmed = alarms.filter((entry) =>
    isActive(entry.event) ? acknowledgedAt(entry) === null : (entry.event.acks?.length ?? 0) === 0,
  );
  return {
    total: alarms.length,
    unconfirmed: unconfirmed.length,
    open: unconfirmed.filter((entry) => isActive(entry.event)).length,
  };
}
/**
 * 종료 뒤 `보고서 제출` 이 꺼진 이유(단추 옆에 늘 보인다, -734). 켜져도 되면 null.
 * 서버는 종료 미팅이나 AI 초안을 쓰는 중이면 제출을 받지 않으므로(409 REPORT_NOT_READY) 그 이유를 가른다.
 * report 는 `useWorkReport` 의 값(undefined 받는 중·실패, null 보고서 없음)이고 failed 는 받기가 실패했는지다.
 */
export function submitBlockReason(
  report: WorkReport | null | undefined,
  failed: boolean,
): string | null {
  if (report === undefined) {
    return failed ? '보고서를 불러오지 못했어요. 새로고침해 주세요' : '보고서를 불러오는 중이에요';
  }
  if (report === null) return '보고서가 없어요';
  if (isEndingGenerating(report)) return '종료 미팅 작성 중이에요';
  if (report.status === 'GENERATING') return 'AI 초안 작성 중이에요';
  return null;
}

/** 경보 기록 목록의 한 줄: 같은 초에 같은 대상에게 난 경보(예: 추락 위험 위험 + 고소 작업면 위 경고)는 한 줄이다. */
export interface WorkEventRow {
  key: string;
  /** 발생 시각(줄에서 가장 이른 것, EC2 ms). */
  at: number;
  /** 줄에서 가장 높은 등급. */
  severity: Severity;
  /** 줄에 든 규칙(등급 높은 순, 같은 규칙은 한 번). */
  ruleIds: string[];
  /** 대표(가장 높은 등급) 경보의 구역. 모르면 null. */
  zoneId: string | null;
  /** 줄에 든 경보 수. */
  count: number;
}

/** 줄 묶음 대상: 사람이 있으면 사람, 없으면 구역, 둘 다 없으면 그 이벤트 하나. */
const rowTarget = (event: EventItem) =>
  event.world_ids[0]
    ? `p:${event.world_ids[0]}`
    : event.zone_id
      ? `z:${event.zone_id}`
      : `e:${event.event_id}`;

/**
 * 경보 기록을 화면 줄로(S15P31A101-731): 같은 초·같은 대상의 경보를 한 줄로 합친다. 수(count)는 그대로 두어 머리줄 건수와 맞는다.
 * events 는 workEventsOf 결과(최근 것이 먼저)이고 줄도 최근 것이 먼저다.
 */
export function workEventRows(events: readonly EventItem[]): WorkEventRow[] {
  const rows = new Map<string, EventItem[]>();
  for (const event of events) {
    const key = `${Math.floor((event.raised_at ?? 0) / 1000)}|${rowTarget(event)}`;
    const row = rows.get(key);
    if (row) row.push(event);
    else rows.set(key, [event]);
  }
  return [...rows].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const top = sorted[0]!;
    return {
      key,
      at: Math.min(...group.map((e) => e.raised_at ?? 0)),
      severity: top.severity,
      ruleIds: [...new Set(sorted.map((e) => e.rule_id))],
      zoneId: top.zone_id,
      count: group.length,
    };
  });
}

/** 등급별 경보 수(위험·경고). */
export function severityCounts(events: readonly EventItem[]): { critical: number; high: number } {
  return {
    critical: events.filter((e) => e.severity === 'CRITICAL').length,
    high: events.filter((e) => e.severity === 'HIGH').length,
  };
}

/** 관제 적용 상태 줄 하나. ok: 확인됨(초록 체크), wait: 기다리는 중, bad: 문제(경고). */
export interface AppliedLine {
  text: string;
  tone: 'ok' | 'wait' | 'bad';
}

/** 관제 적용 상태 카드의 입력. 아직 모르는 값은 줄을 만들지 않는다. */
export interface AppliedStatus {
  /** 이번 작업의 관제 단계(이번 작업 묶음의 현장 적용, S15P31A101-692). 묶음을 모르면 unknown. */
  phase: Pick<MonitoringPhase, 'stage' | 'problem'>;
  /** 3D 모델(현재 Scene)을 받았는지. */
  sceneReady: boolean;
  /** 현장이 쓰는 묶음에 실린 구역 수. 묶음을 모르면 null. 이번 작업 묶음이 적용됐을 때만 줄을 만든다. */
  appliedZoneCount: number | null;
  /** 카메라: 전체 수와 실시간으로 이어진 수. 전체를 모르면(health 없음) total 이 0 이다. */
  cameras: { total: number; live: number };
  /**
   * 녹화 파일·합성 영상 재생(시험 입력) 중인지(viewer_health 1.6.0 laptop.test_input, S15P31A101-731). 재생 중이면 실제 알림(현장 경보 소리·
   * 워치 진동)이 꺼져 있으므로 「경보 켜짐」이라 하지 않는다. 모르면(이전 EC2) false.
   */
  testInput?: boolean;
  /**
   * EC2 재생 시험 알림 스위치(viewer_health 1.7.0 laptop.replay_test_alerts, S15P31A101-736). 재생 중에 켜져 있으면 실제 알림이 나가므로
   * 재생 줄을 「재생 시험 · 실제 알림 켜짐」(경고)으로 바꾼다. 모르면 false.
   */
  replayTestAlerts?: boolean;
}

/** 관제 단계 줄. 모르면 null. */
function phaseLine({ stage, problem }: AppliedStatus['phase']): AppliedLine | null {
  if (problem === 'link_lost') return { text: '현장 연결 끊김 · 경보 확인 불가', tone: 'bad' };
  if (stage === 'on') return { text: '이번 작업 설정 현장 적용됨 · 경보 켜짐', tone: 'ok' };
  if (stage !== 'starting') return null;
  if (problem === 'rejected') return { text: '현장 적용 거부 · 경보 꺼짐', tone: 'bad' };
  if (problem === 'delayed') return { text: '현장 적용 지연 · 경보 꺼짐', tone: 'bad' };
  return { text: '현장 적용 대기 · 경보 꺼짐', tone: 'wait' };
}

/**
 * 관제 적용 상태 줄들: 이번 작업 설정의 현장 적용(경보 켜짐 여부) · '3D 모델 적용됨' · '구역 N개 적용됨' · '카메라 a/b 연결'.
 * 초록 체크(ok)는 확인된 것에만 준다: 구역 수는 이번 작업 묶음이 적용됐을 때 그 묶음의 구역 수, 카메라는 모두 이어졌을 때만이다
 * (S15P31A101-692, 카메라 0/4 에 체크하지 않는다).
 */
export function appliedStatusLines({
  phase,
  sceneReady,
  appliedZoneCount,
  cameras,
  testInput = false,
  replayTestAlerts = false,
}: AppliedStatus): AppliedLine[] {
  const lines: AppliedLine[] = [];
  const monitoring = phaseLine(phase);
  // 재생 중이면 「현장 적용됨 · 경보 켜짐」 대신 재생 중임을 알린다(적용 대기·거부·끊김 줄은 그대로 두고 재생 줄을 앞에 더한다)
  if (testInput)
    lines.push(
      replayTestAlerts
        ? { text: REPLAY_TEST_ALERTS_LABEL, tone: 'bad' }
        : { text: TEST_INPUT_LABEL, tone: 'wait' },
    );
  if (monitoring && !(testInput && phase.stage === 'on')) lines.push(monitoring);
  if (sceneReady) lines.push({ text: '3D 모델 적용됨', tone: 'ok' });
  if (phase.stage === 'on' && appliedZoneCount !== null) {
    lines.push({ text: `구역 ${appliedZoneCount}개 적용됨`, tone: 'ok' });
  }
  if (cameras.total > 0) {
    lines.push({
      text: `카메라 ${cameras.live}/${cameras.total} 연결`,
      tone: cameras.live === cameras.total ? 'ok' : 'bad',
    });
  }
  return lines;
}

import { appliedBundle } from '@/features/events/ppePolicy';
import { activeWork, workEndedAt, workStartedAt } from '@/features/monitor/workSession';
import type { TbmWorkUnit } from '@/features/tbm/types';
import type { ConfigBundle } from '@/features/zones/types';
import type { ViewerHealthPayload } from '@simai/contracts';

// 작업 시작 = 관제 시작(-679)의 화면 판정(S15P31A101-692). 작업 시작 API 가 성공해도 Tier 0 가 이번 작업 묶음(ppe_policy.work_id)을
// 판정 경계에서 적용해야(config_ack APPLIED) 경보가 켜진다. 서버가 이미 주는 값만 쓴다(계약·서버 변경 없음):
// - 최근 구성 묶음(GET /api/config-bundles): 묶음마다 마지막 config_ack 상태(PENDING·APPLIED·REJECTED·MISMATCH)와 ppe_policy.work_id
// - /topic/health(viewer_health): Tier 0 I1 연결(tier0_link)·관제 정지(remote_state)
// Tier 0 는 판정 tick 경계(begin_tick)에서 묶음을 바꾸고 그때 APPLIED 를 보낸다. 그래서 '이번 작업 묶음 APPLIED'는 판정이 그 묶음으로
// 돌기 시작했다는 근거다. 화면 없이 시험한다.

/** 작업 시작·종료 뒤 이만큼(ms, EC2 시계) 지나도 적용 확인이 없으면 '지연'으로 알린다. 보통은 내려받기·검증·다음 tick 으로 수 초다. */
export const MONITORING_APPLY_DELAY_MS = 10_000;

/**
 * 지금 실행의 묶음으로 볼 발행 시각 여유(ms). 시작 묶음은 실행 시작과 같은 트랜잭션에서 시작 뒤에 만들지만(EC2 시계), 시각 자름 차이를 넉넉히 둔다.
 * 실행 사이는 화면 조작(종료 → 한 번 더 실행 → 작업 전 확인)이라 이보다 훨씬 길다.
 */
export const RUN_BUNDLE_SLACK_MS = 2_000;

/** EC2 ↔ Tier 0 연결. down: 끊김 또는 관제 정지(CONTROL_HALTED). unknown: health 를 모른다(EC2 와 끊김 등). */
export type Tier0Link = 'up' | 'down' | 'unknown';

export function tier0LinkOf(health: ViewerHealthPayload | null | undefined): Tier0Link {
  if (!health) return 'unknown';
  if (health.tier0_link !== 'CONNECTED' || health.remote_state === 'CONTROL_HALTED') return 'down';
  return 'up';
}

/**
 * 관제 단계.
 * - unknown: 작업 목록·묶음 목록을 모른다
 * - idle: 진행 중 작업이 없고 현장도 작업 묶음을 쓰지 않는다(경보 꺼짐)
 * - starting: 작업이 진행 중인데 현장이 아직 이번 작업 묶음을 적용하지 않았다(경보 아직 꺼짐)
 * - on: 현장이 이번 작업 묶음을 적용했다(경보 켜짐)
 * - ending: 진행 중 작업이 없는데 현장이 아직 끝난 작업의 묶음을 쓴다(경보가 아직 켜져 있을 수 있다)
 */
export type MonitoringStage = 'unknown' | 'idle' | 'starting' | 'on' | 'ending';

/** 단계에 붙는 문제. delayed: 10 s 넘게 적용 확인 없음. rejected: 현장이 묶음을 거부. link_lost: Tier 0 와 끊겨 확인할 수 없음. */
export type MonitoringProblem = 'delayed' | 'rejected' | 'link_lost' | null;

export interface MonitoringPhase {
  stage: MonitoringStage;
  problem: MonitoringProblem;
  /** 단계의 작업(starting·on: 진행 중 작업, ending: 현장이 아직 쓰는 작업). 없으면 null. */
  workId: string | null;
  /** 이 시각(EC2 ms)에 다시 판정해야 단계가 바뀔 수 있다(지연 경계). 없으면 null. */
  recheckAt: number | null;
}

const UNKNOWN: MonitoringPhase = { stage: 'unknown', problem: null, workId: null, recheckAt: null };
const IDLE: MonitoringPhase = { stage: 'idle', problem: null, workId: null, recheckAt: null };

const sameWork = (workId: number | null | undefined, id: string) =>
  workId !== null && workId !== undefined && String(workId) === id;

const failed = (bundle: ConfigBundle | undefined) =>
  bundle?.status === 'REJECTED' || bundle?.status === 'MISMATCH';

/** 기준 시각에서 지연 경계가 지났는지와 다음 판정 시각. 기준을 모르면 지연을 말하지 않는다. */
function delayOf(
  since: number | null,
  now: number,
): { delayed: boolean; recheckAt: number | null } {
  if (since === null) return { delayed: false, recheckAt: null };
  const deadline = since + MONITORING_APPLY_DELAY_MS;
  return now > deadline
    ? { delayed: true, recheckAt: null }
    : { delayed: false, recheckAt: deadline };
}

/**
 * 진행 중 작업 하나의 시작 단계(starting·on). 현장이 쓰는 묶음(appliedBundle: 가장 새로 적용된 묶음)의 ppe_policy.work_id 가 이 작업이면 on.
 * ppe_policy 가 없는 묶음(-518 이전)을 쓰면 Tier 0 는 작업과 상관없이 판정하므로(-679 1.1) on 으로 본다.
 * on 이 아니면: Tier 0 와 끊김 → link_lost, 이번 작업의 가장 새 묶음이 거부·불일치 → rejected, 그 묶음 발행 뒤 10 s 넘음 → delayed.
 * 지연 기준은 이 작업의 가장 새 묶음 발행 시각(시작 묶음이면 시작 시각, 「현장에 다시 보내기」면 그때)이고, 목록에 아직 없으면 작업 시작 시각이다.
 * 「이 작업의 묶음」은 지금 실행이 시작된 뒤(startedAt − RUN_BUNDLE_SLACK_MS) 발행한 것만이다(S15P31A101-696): 한 번 더 실행하면
 * 같은 작업의 실행 1 묶음이 목록에 남아 있어, 그것을 보면 실행 2 시작 직후부터 '지연'·'거부'로 잘못 본다.
 */
export function startPhase(
  work: { work_id: string; startedAt: number | null },
  bundles: readonly ConfigBundle[],
  link: Tier0Link,
  now: number,
): MonitoringPhase {
  const id = work.work_id;
  const applied = appliedBundle(bundles);
  const on =
    applied !== null && (applied.ppe_policy == null || sameWork(applied.ppe_policy.work_id, id));
  if (on) {
    return {
      stage: 'on',
      problem: link === 'down' ? 'link_lost' : null,
      workId: id,
      recheckAt: null,
    };
  }
  if (link === 'down')
    return { stage: 'starting', problem: 'link_lost', workId: id, recheckAt: null };
  const since = work.startedAt === null ? null : work.startedAt - RUN_BUNDLE_SLACK_MS;
  const own = bundles.find(
    (b) => sameWork(b.ppe_policy?.work_id, id) && (since === null || b.issued_at >= since),
  );
  if (failed(own)) return { stage: 'starting', problem: 'rejected', workId: id, recheckAt: null };
  const { delayed, recheckAt } = delayOf(own?.issued_at ?? work.startedAt, now);
  return { stage: 'starting', problem: delayed ? 'delayed' : null, workId: id, recheckAt };
}

/**
 * 끝난 작업 하나의 종료 단계. 현장이 쓰는 묶음이 아직 이 작업의 것이면 ending(문제는 시작과 같은 순서로 가른다. 거부는 가장 새 묶음이
 * 작업 없음 묶음인데 거부·불일치일 때), 아니면 idle(현장 경보 꺼짐 확인). 묶음 목록에 적용 묶음이 없으면 idle 이다(쓰는 작업 묶음이 없다).
 * 지연 기준은 가장 새 작업 없음 묶음의 발행 시각(종료 묶음이면 종료 시각)이고, 목록에 아직 없으면 작업 종료 시각이다.
 */
export function endPhase(
  work: { work_id: string; endedAt: number | null },
  bundles: readonly ConfigBundle[],
  link: Tier0Link,
  now: number,
): MonitoringPhase {
  const id = work.work_id;
  const applied = appliedBundle(bundles);
  if (!applied?.ppe_policy || !sameWork(applied.ppe_policy.work_id, id)) return IDLE;
  if (link === 'down')
    return { stage: 'ending', problem: 'link_lost', workId: id, recheckAt: null };
  const latest = bundles[0];
  const release = latest?.ppe_policy && latest.ppe_policy.work_id === null ? latest : undefined;
  if (failed(release)) return { stage: 'ending', problem: 'rejected', workId: id, recheckAt: null };
  const { delayed, recheckAt } = delayOf(release?.issued_at ?? work.endedAt, now);
  return { stage: 'ending', problem: delayed ? 'delayed' : null, workId: id, recheckAt };
}

/**
 * 실시간 관제의 단계. 진행 중 작업이 있으면 그 작업의 시작 단계, 없으면 현장이 아직 쓰는 작업 묶음의 종료 단계, 그것도 없으면 idle.
 * 작업·묶음 목록 중 하나라도 모르면 unknown 이다(모르는 채로 '경보 꺼짐'·'관제 중'이라 하지 않는다).
 */
export function monitoringPhase(
  works: readonly TbmWorkUnit[] | undefined,
  bundles: readonly ConfigBundle[] | undefined,
  link: Tier0Link,
  now: number,
): MonitoringPhase {
  if (!works || !bundles) return UNKNOWN;
  const active = activeWork(works);
  if (active) {
    return startPhase(
      { work_id: active.work_id, startedAt: workStartedAt(active) },
      bundles,
      link,
      now,
    );
  }
  const lingering = appliedBundle(bundles)?.ppe_policy?.work_id;
  if (lingering === null || lingering === undefined) return IDLE;
  const id = String(lingering);
  const ended = works.find((w) => w.work_id === id);
  return endPhase({ work_id: id, endedAt: ended ? workEndedAt(ended) : null }, bundles, link, now);
}

/** 화면 문구. what·how 는 문제가 있을 때만(무엇이 / 어떻게 두 줄). retry 면 「현장에 다시 보내기」 단추를 둔다. */
export interface MonitoringText {
  label: string;
  tone: 'ok' | 'wait' | 'bad' | 'off';
  what: string | null;
  how: string | null;
  retry: boolean;
}

/** 현장 장비 점검 안내(지연·끊김 공통). */
const CHECK_SITE = '현장 노트북과 GPU 서버가 켜져 있고 연결돼 있는지 확인하세요.';
const RETRY_HOW = '「현장에 다시 보내기」를 누르세요. 다시 거부되면 현장 세팅을 확인하세요.';

export const IDLE_LABEL = '작업 시작 전 · 경보 꺼짐';
export const STARTING_LABEL = '관제 준비 중';
export const ON_LABEL = '관제 중';
export const ENDING_LABEL = '종료 요청됨 · 현장 경보 끄는 중';
export const ENDED_LABEL = '현장 경보 종료 확인';

export function monitoringText({
  stage,
  problem,
}: Pick<MonitoringPhase, 'stage' | 'problem'>): MonitoringText {
  const text = (
    label: string,
    tone: MonitoringText['tone'],
    what: string | null = null,
    how: string | null = null,
    retry = false,
  ) => ({ label, tone, what, how, retry });
  switch (stage) {
    case 'unknown':
      return text('관제 상태 확인 중', 'wait');
    case 'idle':
      return text(IDLE_LABEL, 'off');
    case 'on':
      return problem === 'link_lost'
        ? text(
            '현장 연결 끊김',
            'bad',
            '현장 장비와 연결이 끊겨 경보가 울리는지 확인할 수 없습니다.',
            CHECK_SITE,
          )
        : text(ON_LABEL, 'ok');
    case 'starting':
      if (problem === 'link_lost') {
        return text(
          '현장 연결 끊김',
          'bad',
          '현장 장비와 연결이 끊겨 경보를 켜지 못했습니다.',
          CHECK_SITE,
        );
      }
      if (problem === 'rejected') {
        return text(
          '관제 시작 실패',
          'bad',
          '현장 장비가 이번 작업 설정을 받지 않아 경보가 꺼져 있습니다.',
          RETRY_HOW,
          true,
        );
      }
      if (problem === 'delayed') {
        return text(
          '관제 시작 지연',
          'bad',
          '10초가 지나도 현장 장비가 이번 작업 설정을 적용하지 않아 경보가 아직 꺼져 있습니다.',
          CHECK_SITE,
        );
      }
      return text(STARTING_LABEL, 'wait');
    case 'ending':
      if (problem === 'link_lost') {
        return text(
          '현장 연결 끊김',
          'bad',
          '현장 장비와 연결이 끊겨 현장 경보가 꺼졌는지 확인할 수 없습니다.',
          CHECK_SITE,
        );
      }
      if (problem === 'rejected') {
        return text(
          '현장 경보 종료 실패',
          'bad',
          '현장 장비가 작업 종료 설정을 받지 않아 경보가 아직 켜져 있습니다.',
          RETRY_HOW,
          true,
        );
      }
      if (problem === 'delayed') {
        return text(
          '현장 경보 종료 지연',
          'bad',
          '작업을 끝냈지만 10초가 지나도 현장 경보가 꺼지지 않았습니다.',
          CHECK_SITE,
        );
      }
      return text(ENDING_LABEL, 'wait');
  }
}

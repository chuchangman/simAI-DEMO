import {
  endPhase,
  MONITORING_APPLY_DELAY_MS,
  monitoringPhase,
  monitoringText,
  startPhase,
  tier0LinkOf,
} from '@/features/monitor/monitoringPhase';
import { readBundles } from '@/features/zones/useRecentBundles';
import type { ViewerHealthPayload } from '@simai/contracts';
import { describe, expect, it, vi } from 'vitest';

// 작업 시작 = 관제 시작의 화면 판정(S15P31A101-692). 서버가 주는 묶음 상태(config_ack)·ppe_policy.work_id·Tier 0 연결만 쓴다.
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const T = 1_760_342_400_000;
const DELAY = MONITORING_APPLY_DELAY_MS;

/** 묶음(새것부터 넘긴다). workId 가 undefined 면 ppe_policy 칸이 없고, 'none' 이면 null(ppe_policy 없는 묶음)이다. */
function bundles(
  ...rows: [status: string, workId: number | null | 'none' | undefined, issuedAt?: number][]
) {
  return readBundles(
    rows.map(([status, workId, issuedAt = T], i) => ({
      config_version: `cfg-${rows.length - i}`,
      issued_at: issuedAt,
      status,
      applied_at: status === 'APPLIED' ? issuedAt : null,
      last_ack: null,
      items: [],
      ...(workId === undefined
        ? {}
        : {
            ppe_policy:
              workId === 'none'
                ? null
                : { helmet: 'REQUIRED', vest: 'REQUIRED', work_id: workId, effective_from_ms: T },
          }),
    })),
  );
}

const work = (patch: Record<string, unknown>) =>
  ({ work_id: '12', status: 'IN_PROGRESS', actual_started_at: T, ...patch }) as never;

describe('tier0LinkOf', () => {
  it('health 가 없으면 모름, 끊김·관제 정지면 down, 그 밖은 up', () => {
    expect(tier0LinkOf(undefined)).toBe('unknown');
    const health = (tier0: string, remote: string) =>
      ({ tier0_link: tier0, remote_state: remote }) as unknown as ViewerHealthPayload;
    expect(tier0LinkOf(health('CONNECTED', 'NORMAL'))).toBe('up');
    expect(tier0LinkOf(health('DISCONNECTED', 'REMOTE_LINK_LOST'))).toBe('down');
    // 연결은 살아 있어도 Tier 0 처리가 멈췄다
    expect(tier0LinkOf(health('CONNECTED', 'CONTROL_HALTED'))).toBe('down');
  });
});

describe('startPhase', () => {
  const w = { work_id: '12', startedAt: T };

  it('한 번 더 실행하면(S15P31A101-696) 같은 작업의 실행 1 묶음은 이번 실행 묶음으로 보지 않는다(바로 지연·거부로 보지 않음)', () => {
    const run2 = { work_id: '12', startedAt: T + 3_600_000 };
    // 실행 1 묶음(거부·한참 전 발행)과 실행 사이 종료 묶음만 있는 목록: 실행 2 시작 직후는 대기
    const stale = bundles(['APPLIED', null, T + 1_800_000], ['REJECTED', 12, T]);
    expect(startPhase(run2, stale, 'up', T + 3_600_000 + 1_000)).toEqual({
      stage: 'starting',
      problem: null,
      workId: '12',
      recheckAt: T + 3_600_000 + DELAY,
    });
    // 실행 2 시작 묶음이 오면 그 발행 시각이 기준이고, 거부도 그 묶음으로 판단한다
    const fresh = bundles(['REJECTED', 12, T + 3_600_000], ['APPLIED', null, T + 1_800_000]);
    expect(startPhase(run2, fresh, 'up', T + 3_600_000 + 1_000).problem).toBe('rejected');
    // 실행 2 묶음이 적용되면 관제 중(작업 id 는 실행 1 과 같다)
    const applied = bundles(['APPLIED', 12, T + 3_600_000], ['APPLIED', null, T + 1_800_000]);
    expect(startPhase(run2, applied, 'up', T + 3_600_000 + 1_000).stage).toBe('on');
  });

  it('진행 중 실행이 있으면 그 실행 시작을 지연 기준으로 본다(monitoringPhase 가 runs 를 읽는다)', () => {
    const running = work({
      actual_started_at: T,
      runs: [
        { run_no: 1, started_at: T, ended_at: T + 1_000 },
        { run_no: 2, started_at: T + 100_000, ended_at: null },
      ],
    });
    const list = bundles(['APPLIED', null, T + 1_000], ['APPLIED', 12, T]);
    expect(monitoringPhase([running], list, 'up', T + 100_000 + 1)).toMatchObject({
      stage: 'starting',
      problem: null,
      recheckAt: T + 100_000 + DELAY,
    });
  });

  it('현장이 쓰는(가장 새로 적용된) 묶음이 이번 작업 것이면 관제 중, 아니면 준비 중(API 성공만으로 관제 중이 아니다)', () => {
    expect(startPhase(w, bundles(['APPLIED', 12], ['APPLIED', null]), 'up', T + 1).stage).toBe(
      'on',
    );
    const pending = startPhase(w, bundles(['PENDING', 12], ['APPLIED', null]), 'up', T + 1);
    expect(pending).toEqual({
      stage: 'starting',
      problem: null,
      workId: '12',
      recheckAt: T + DELAY,
    });
    // 다른 작업의 묶음을 쓰고 있다
    expect(startPhase(w, bundles(['APPLIED', 11]), 'up', T + 1).stage).toBe('starting');
    // 목록에 아직 이번 작업 묶음이 없다(시작 직후 캐시)
    expect(startPhase(w, bundles(['APPLIED', null]), 'up', T + 1).stage).toBe('starting');
  });

  it('ppe_policy 가 없는 묶음(-518 이전)을 쓰면 Tier 0 는 작업과 상관없이 판정하므로 관제 중이다', () => {
    expect(startPhase(w, bundles(['APPLIED', 'none']), 'up', T).stage).toBe('on');
  });

  it('10초가 지나도 적용이 없으면 지연, 기준은 이번 작업의 가장 새 묶음 발행 시각(없으면 시작 시각)', () => {
    const list = bundles(['PENDING', 12, T + 5_000], ['APPLIED', null]);
    expect(startPhase(w, list, 'up', T + 5_000 + DELAY).problem).toBeNull();
    expect(startPhase(w, list, 'up', T + 5_001 + DELAY)).toMatchObject({
      problem: 'delayed',
      recheckAt: null,
    });
    expect(startPhase(w, bundles(['APPLIED', null]), 'up', T + DELAY + 1).problem).toBe('delayed');
    // 기준을 모르면 지연을 말하지 않는다
    expect(
      startPhase({ work_id: '12', startedAt: null }, bundles(['APPLIED', null]), 'up', T + 1e9),
    ).toMatchObject({ problem: null, recheckAt: null });
  });

  it('이번 작업의 가장 새 묶음이 거부·불일치면 거부, 더 새 묶음이 대기 중이면 거부가 아니다', () => {
    expect(startPhase(w, bundles(['REJECTED', 12], ['APPLIED', null]), 'up', T).problem).toBe(
      'rejected',
    );
    expect(startPhase(w, bundles(['MISMATCH', 12], ['APPLIED', null]), 'up', T).problem).toBe(
      'rejected',
    );
    expect(
      startPhase(w, bundles(['PENDING', 12], ['REJECTED', 12], ['APPLIED', null]), 'up', T).problem,
    ).toBeNull();
  });

  it('Tier 0 와 끊기면 적용 전에는 끊김, 적용 뒤에도 관제 중을 끊김으로 표시한다(모름은 끊김으로 보지 않는다)', () => {
    expect(startPhase(w, bundles(['PENDING', 12], ['APPLIED', null]), 'down', T).problem).toBe(
      'link_lost',
    );
    expect(startPhase(w, bundles(['APPLIED', 12]), 'down', T)).toMatchObject({
      stage: 'on',
      problem: 'link_lost',
    });
    expect(startPhase(w, bundles(['APPLIED', 12]), 'unknown', T)).toMatchObject({
      stage: 'on',
      problem: null,
    });
  });
});

describe('endPhase', () => {
  const w = { work_id: '12', endedAt: T };

  it('현장이 아직 끝난 작업의 묶음을 쓰면 종료 중, 작업 없음 묶음이 적용되면 종료 확인(idle)', () => {
    const ending = endPhase(w, bundles(['PENDING', null], ['APPLIED', 12]), 'up', T + 1);
    expect(ending).toEqual({ stage: 'ending', problem: null, workId: '12', recheckAt: T + DELAY });
    expect(endPhase(w, bundles(['APPLIED', null], ['APPLIED', 12]), 'up', T + 1).stage).toBe(
      'idle',
    );
    // 다음 작업 묶음이 적용됐어도 끝난 작업의 경보는 꺼졌다(-679 작업 A→B 는 A 이벤트를 닫는다)
    expect(endPhase(w, bundles(['APPLIED', 13], ['APPLIED', 12]), 'up', T + 1).stage).toBe('idle');
  });

  it('지연·거부·끊김을 가른다', () => {
    expect(
      endPhase(w, bundles(['PENDING', null], ['APPLIED', 12]), 'up', T + DELAY + 1).problem,
    ).toBe('delayed');
    expect(endPhase(w, bundles(['REJECTED', null], ['APPLIED', 12]), 'up', T).problem).toBe(
      'rejected',
    );
    expect(endPhase(w, bundles(['PENDING', null], ['APPLIED', 12]), 'down', T).problem).toBe(
      'link_lost',
    );
  });
});

describe('monitoringPhase', () => {
  it('작업·묶음 목록 중 하나라도 모르면 unknown', () => {
    expect(monitoringPhase(undefined, bundles(), 'up', T).stage).toBe('unknown');
    expect(monitoringPhase([], undefined, 'up', T).stage).toBe('unknown');
  });

  it('진행 중 작업이 있으면 그 작업의 시작 단계', () => {
    expect(monitoringPhase([work({})], bundles(['APPLIED', 12]), 'up', T).stage).toBe('on');
    expect(monitoringPhase([work({})], bundles(['APPLIED', null]), 'up', T).stage).toBe('starting');
  });

  it('진행 중 작업이 없으면 현장이 아직 쓰는 작업 묶음의 종료 단계(종료 시각은 작업 목록), 없으면 idle', () => {
    const ended = work({ status: 'DONE', actual_ended_at: T });
    const list = bundles(['PENDING', null, T - 60_000], ['APPLIED', 12, T - 120_000]);
    // 작업 없음 묶음 발행 시각이 기준이라 이미 지연이다
    expect(monitoringPhase([ended], list, 'up', T + 1)).toMatchObject({
      stage: 'ending',
      problem: 'delayed',
      workId: '12',
    });
    expect(monitoringPhase([ended], bundles(['APPLIED', 12]), 'up', T + 1)).toMatchObject({
      stage: 'ending',
      problem: null,
      recheckAt: T + DELAY,
    });
    expect(monitoringPhase([ended], bundles(['APPLIED', null]), 'up', T).stage).toBe('idle');
    expect(monitoringPhase([], bundles(), 'up', T).stage).toBe('idle');
  });
});

describe('monitoringText', () => {
  it('배지 하나와 문제일 때만 무엇이 / 어떻게, 거부일 때만 다시 보내기', () => {
    expect(monitoringText({ stage: 'idle', problem: null })).toMatchObject({
      label: '작업 시작 전 · 경보 꺼짐',
      what: null,
    });
    expect(monitoringText({ stage: 'starting', problem: null }).label).toBe('관제 준비 중');
    expect(monitoringText({ stage: 'on', problem: null }).label).toBe('관제 중');
    expect(monitoringText({ stage: 'ending', problem: null }).label).toBe(
      '종료 요청됨 · 현장 경보 끄는 중',
    );
    for (const stage of ['starting', 'ending'] as const) {
      for (const problem of ['delayed', 'rejected', 'link_lost'] as const) {
        const text = monitoringText({ stage, problem });
        expect(text.tone).toBe('bad');
        expect(text.what).toBeTruthy();
        expect(text.how).toBeTruthy();
        expect(text.retry).toBe(problem === 'rejected');
        // 개발 용어를 쓰지 않는다
        expect(`${text.label}${text.what}${text.how}`).not.toMatch(/묶음|Tier|config|ACK|R\d/);
      }
    }
  });
});

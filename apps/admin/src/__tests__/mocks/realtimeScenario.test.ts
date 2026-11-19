import {
  EVENT_CYCLE_MS,
  ppeViewAt,
  riskEventsBetween,
  viewerHealthAt,
  worldStateAt,
  type MockOutage,
} from '@/mocks/realtimeScenario';
import { validateMessage } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

describe('장애·Scene 불일치 흉내', () => {
  const health = (t: number, kind: MockOutage) =>
    viewerHealthAt(t, { faults: false, outage: { kind, since: T0 } }).payload;

  it('끊긴 뒤 3초 동안은 데이터 연령만 늘고, 그 뒤 EC2 가 장애를 알린다', () => {
    const early = health(T0 + 2_999, 'tier0');
    expect(early.remote_state).toBe('NORMAL');
    expect(early.data_age_ms).toBeGreaterThanOrEqual(2_999);

    const late = health(T0 + 3_000, 'tier0');
    expect(late).toMatchObject({
      remote_state: 'CONTROL_HALTED',
      tier0_link: 'DISCONNECTED',
      laptop: { link: 'CONNECTED' },
      system_health: 'UNSAFE_UNKNOWN',
    });
  });

  it('노트북 정지는 노트북 하트비트가 끊기고 카메라 신호가 없다', () => {
    const payload = health(T0 + 5_000, 'laptop');
    expect(payload).toMatchObject({
      remote_state: 'CONTROL_HALTED',
      tier0_link: 'CONNECTED',
      laptop: { link: 'DISCONNECTED', last_heartbeat_at: T0 },
    });
    const cameras = (payload.tier0_health as { cameras: { status: string }[] }).cameras;
    expect(cameras.map((camera) => camera.status)).toEqual(Array(4).fill('NO_SIGNAL'));
  });

  it('Tier 0 → EC2 단절은 원격 전달 단절이고 노트북은 이어져 있다', () => {
    expect(health(T0 + 5_000, 'remote')).toMatchObject({
      remote_state: 'REMOTE_LINK_LOST',
      tier0_link: 'DISCONNECTED',
      laptop: { link: 'CONNECTED' },
    });
  });

  it('끊긴 동안 마지막 데이터 시각(as_of − 데이터 연령)은 장애가 시작될 때로 고정된다', () => {
    const lastAt = (t: number) => {
      const payload = health(t, 'tier0');
      return payload.as_of - (payload.data_age_ms ?? 0);
    };
    // 초마다 바뀌는 평소 연령 흔들림이 섞이지 않는다.
    expect(new Set([1_000, 2_500, 4_000, 7_300, 9_999].map((ms) => lastAt(T0 + ms)))).toEqual(
      new Set([T0 - 120]),
    );
  });

  it('Scene 불일치를 켜면 Tier 0 가 이전 Scene 을 쓴다고 알리고, world 도 그 Scene 으로 온다', () => {
    expect(viewerHealthAt(T0, { sceneMismatch: true }).payload.scene).toEqual({
      committed_version: 'scene-3',
      live_version: 'scene-2',
      mismatch: true,
    });
    expect(worldStateAt(T0, { sceneMismatch: true }).payload.scene_version).toBe('scene-2');
    expect(worldStateAt(T0).payload.scene_version).toBe('scene-3');
  });

  it('장애·불일치 흉내도 계약을 통과한다', () => {
    for (const kind of ['tier0', 'laptop', 'remote'] as const) {
      const message = viewerHealthAt(T0 + 5_000, {
        outage: { kind, since: T0 },
        sceneMismatch: true,
      });
      const result = validateMessage('viewer_health', message);
      expect(result.ok ? [] : result.errors).toEqual([]);
    }
  });
});

describe('실시간 mock 시나리오', () => {
  it('world·health 메시지는 계약을 통과한다', () => {
    for (let i = 0; i < 50; i++) {
      const t = T0 + i * 733;
      const world = validateMessage('world_state', worldStateAt(t));
      const health = validateMessage('viewer_health', viewerHealthAt(t));
      expect(world.ok ? [] : world.errors).toEqual([]);
      expect(health.ok ? [] : health.errors).toEqual([]);
    }
  });

  it('PPE 스냅샷(-531)은 계약을 통과하고 mock 사람 셋을 착용·미착용·모름으로 나눈다', () => {
    const ppe = ppeViewAt(T0);
    const checked = validateMessage('ppe_view', ppe);
    expect(checked.ok ? [] : checked.errors).toEqual([]);
    expect(ppe.payload.people.map((p) => p.helmet.state)).toEqual(['WORN', 'NOT_WORN', 'UNKNOWN']);
    expect(ppe.payload.people.map((p) => p.world_id)).toEqual(
      worldStateAt(T0).payload.tracks.map((tr) => tr.world_id),
    );
  });

  describe('바퀴의 20~26초에는 cam_C 가 키프레임을 기다린다', () => {
    const at = (t: number, faults?: boolean) => {
      const { payload } = viewerHealthAt(t, { faults });
      const cameras = (payload.tier0_health as { cameras: { id: string; status: string }[] })
        .cameras;
      return {
        system: payload.system_health,
        cam_C: cameras.find((camera) => camera.id === 'cam_C')?.status,
        others: cameras.filter((camera) => camera.id !== 'cam_C').map((camera) => camera.status),
        // cam_C 가 영상을 보내지 않는 동안에는 world 에서도 cam_C 로 관측하지 않는다.
        observed: new Set(worldStateAt(t).payload.tracks.flatMap((track) => track.cameras)),
      };
    };

    it.each([
      [19_999, 'NOMINAL', 'OK'],
      [20_000, 'DEGRADED', 'WAITING_KEYFRAME'],
      [25_999, 'DEGRADED', 'WAITING_KEYFRAME'],
      [26_000, 'NOMINAL', 'OK'],
      [EVENT_CYCLE_MS + 21_000, 'DEGRADED', 'WAITING_KEYFRAME'],
    ])('바퀴 시작 + %ims: %s, cam_C %s', (offset, system, cam_C) => {
      const state = at(T0 + offset);
      expect(state.system).toBe(system);
      expect(state.cam_C).toBe(cam_C);
      expect(state.others).toEqual(['OK', 'OK', 'OK']);
      expect(state.observed.has('cam_C')).toBe(cam_C === 'OK');
    });

    it('고장 흉내를 끄면 그 구간에도 정상이다', () => {
      expect(at(T0 + 21_000, false)).toMatchObject({ system: 'NOMINAL', cam_C: 'OK' });
    });
  });

  it('작업자는 교실(10×10m) 안에 있다', () => {
    for (let i = 0; i < 100; i++) {
      for (const track of worldStateAt(T0 + i * 977).payload.tracks) {
        const [x, y] = track.position_xy ?? [NaN, NaN];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(10);
      }
    }
  });

  it('위험 이벤트는 한 바퀴에 정해진 전이를 한 번씩 순서대로 보내고, 모두 계약을 통과한다', () => {
    const start = Math.floor(T0 / EVENT_CYCLE_MS) * EVENT_CYCLE_MS;
    const events = [];
    // 1초 간격으로 겹치지 않게 훑는다(mock 송출과 같은 방식).
    for (let t = start; t < start + EVENT_CYCLE_MS; t += 1000) {
      events.push(...riskEventsBetween(t, t + 1000));
    }
    const byEvent = new Map<string, { rule: string; steps: string[]; sequences: number[] }>();
    for (const { payload } of events) {
      const seen = byEvent.get(payload.event_id) ?? {
        rule: `${payload.rule_id} ${payload.severity}`,
        steps: [],
        sequences: [],
      };
      seen.steps.push(payload.lifecycle);
      seen.sequences.push(payload.event_sequence ?? 0);
      byEvent.set(payload.event_id, seen);
    }
    expect([...byEvent.values()].map(({ rule, steps }) => [rule, steps])).toEqual([
      ['R5 CAUTION', ['RAISED', 'RESOLVED']],
      ['R2 CRITICAL', ['RAISED', 'UPDATED', 'RESOLVED']],
      ['R1 HIGH', ['RAISED', 'RESOLVED']],
      ['R1 HIGH', ['RAISED', 'RESOLVED', 'UPDATED', 'RESOLVED']],
    ]);
    for (const { sequences } of byEvent.values()) {
      expect(sequences).toEqual(sequences.map((_, i) => i + 1));
    }
    for (const event of events) {
      const checked = validateMessage('risk_event', event);
      expect(checked.ok ? [] : checked.errors).toEqual([]);
    }
  });

  it('재개된 이벤트는 resume_count 와 확인 필요 이유를 싣는다', () => {
    const resumed = riskEventsBetween(0, EVENT_CYCLE_MS).find((e) => e.payload.resume_count === 1);
    expect(resumed?.payload).toMatchObject({
      lifecycle: 'UPDATED',
      needs_check: true,
      resolved_at: null,
      world_ids: ['w-0021'],
    });
  });

  it('바퀴마다 다른 이벤트 id 를 쓴다', () => {
    const first = riskEventsBetween(0, EVENT_CYCLE_MS)[0]?.payload.event_id;
    const second = riskEventsBetween(EVENT_CYCLE_MS, 2 * EVENT_CYCLE_MS)[0]?.payload.event_id;
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
  });
});

describe('복원된 이벤트(-308) 흉내', () => {
  it('Tier 0 재시작 뒤 복원된 이벤트처럼 확인 필요·검증 불가로 되살아나는 이벤트가 한 바퀴에 있다', () => {
    // 서버에는 복원을 알리는 전용 필드가 없다. 검증 불가·확인 필요(이유 Z_UNKNOWN·PREDICTED)가 신호의 전부다.
    const restored = riskEventsBetween(0, EVENT_CYCLE_MS).filter(
      (e) => e.payload.verification === 'UNVERIFIABLE',
    );
    expect(restored.length).toBeGreaterThan(0);
    for (const { payload } of restored) {
      expect(payload).toMatchObject({
        needs_check: true,
        confidence: 'LOW',
        confidence_reasons: ['Z_UNKNOWN', 'PREDICTED'],
      });
    }
  });
});

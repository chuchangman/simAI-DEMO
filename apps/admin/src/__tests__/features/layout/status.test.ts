import {
  clockLabel,
  lastDataClock,
  siteLinkDown,
  siteLinkDownTitle,
} from '@/features/layout/status';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import type { HealthSnapshot } from '@/store/realtime.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

function snapshot(change: Partial<ViewerHealthPayload> = {}, receivedAt = T): HealthSnapshot {
  const payload = { ...viewerHealthAt(T).payload, ...change };
  return { payload, receivedAt, clockOffsetMs: 0 };
}

describe('시계', () => {
  it('시계는 EC2 와의 차이를 더한 시각이다', () => {
    const now = new Date(2026, 9, 21, 14, 30, 5).getTime();
    expect(clockLabel(0, now)).toBe('14:30:05');
    expect(clockLabel(-5000, now)).toBe('14:30:00');
    expect(clockLabel(undefined, now)).toBeUndefined();
  });

  it('마지막 데이터 시각은 EC2 시각에서 데이터 연령을 뺀 때다', () => {
    const asOf = new Date(2026, 9, 21, 14, 30, 5).getTime();
    expect(lastDataClock(snapshot({ as_of: asOf, data_age_ms: 12_000 }))).toBe('14:29:53');
    expect(lastDataClock(snapshot({ data_age_ms: null }))).toBeUndefined();
    expect(lastDataClock(null)).toBeUndefined();
  });
});

describe('현장 연결 끊김(S15P31A101-719)', () => {
  const down = (lastHeartbeatAt: number | null) =>
    snapshot({ laptop: { link: 'DISCONNECTED', last_heartbeat_at: lastHeartbeatAt } });

  it('EC2 와 이어져 있고 GPU 가 켜져 있을 때 게이트웨이 하트비트가 끊겼으면 알린다', () => {
    expect(siteLinkDown(down(T - 4_000), true, true)).toEqual({ lastHeartbeatAt: T - 4_000 });
    expect(
      siteLinkDown(snapshot({ laptop: { link: 'CONNECTED', last_heartbeat_at: T } }), true, true),
    ).toBeNull();
  });

  it('EC2 와 끊겼거나(값이 낡음) GPU 가 꺼져 있으면(작업 없음) 알리지 않는다', () => {
    expect(siteLinkDown(down(T), false, true)).toBeNull();
    expect(siteLinkDown(down(T), true, false)).toBeNull();
    expect(siteLinkDown(null, true, true)).toBeNull();
  });

  it('설명에는 끊긴 시각과 확인할 것을 쓴다', () => {
    const at = new Date(2026, 10, 15, 13, 11, 4).getTime();
    expect(siteLinkDownTitle({ lastHeartbeatAt: at })).toContain('13:11:04부터 끊겼습니다');
    expect(siteLinkDownTitle({ lastHeartbeatAt: null })).toContain('신호를 받은 적이 없습니다');
  });
});

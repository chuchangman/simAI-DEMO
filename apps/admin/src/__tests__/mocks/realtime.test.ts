import { startRealtimeMock, type RealtimeMock } from '@/mocks/realtime';
import { EVENT_CYCLE_MS } from '@/mocks/realtimeScenario';
import type { StompBroker } from '@/mocks/stompBroker';
import type { ViewerHealthPayload } from '@simai/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T0 = 1_760_342_400_000;

let t = T0;
let sent: { topic: string; body: unknown }[] = [];
let mock: RealtimeMock;

const dropAll = vi.fn();
const rejectNextConnects = vi.fn();
const broker = {
  connections: 1,
  publish: (topic: string, body: unknown) => sent.push({ topic, body }),
  dropAll,
  rejectNextConnects,
} as unknown as StompBroker;

/** ms 만큼 시간을 보내고 그동안 보낸 메시지를 돌려준다. */
function run(ms: number) {
  sent = [];
  for (let i = 0; i < ms / 100; i++) {
    t += 100;
    vi.advanceTimersByTime(100);
  }
  const worlds = sent.filter((m) => m.topic === '/topic/world');
  return {
    worlds: worlds.length,
    worldScene: (worlds.at(-1)?.body as { payload: { scene_version: string } } | undefined)?.payload
      .scene_version,
    health: (
      sent.filter((m) => m.topic === '/topic/health').at(-1)?.body as {
        payload: ViewerHealthPayload;
      }
    )?.payload,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  dropAll.mockClear();
  rejectNextConnects.mockClear();
  t = T0;
  mock = startRealtimeMock(broker, () => t);
});
afterEach(() => {
  mock.stop();
  vi.useRealTimers();
});

describe('실시간 mock 장애 흉내', () => {
  it('장애를 켜면 world 가 끊기고 3초 뒤 health 가 장애를 알리며, 끄면 돌아온다', () => {
    expect(run(1_000).worlds).toBeGreaterThan(0);

    mock.outage('laptop');
    const first = run(1_000);
    expect(first.worlds).toBe(0);
    expect(first.health?.remote_state).toBe('NORMAL');

    const detected = run(3_000);
    expect(detected.worlds).toBe(0);
    expect(detected.health).toMatchObject({
      remote_state: 'CONTROL_HALTED',
      laptop: { link: 'DISCONNECTED' },
    });

    mock.outage(null);
    const back = run(1_000);
    expect(back.worlds).toBeGreaterThan(0);
    expect(back.health?.remote_state).toBe('NORMAL');
  });

  it('Scene 불일치를 켜고 끈다(health 와 world 가 같은 Scene 을 말한다)', () => {
    mock.sceneMismatch(true);
    const on = run(1_000);
    expect(on.health?.scene.mismatch).toBe(true);
    expect(on.worldScene).toBe(on.health?.scene.live_version);
    mock.sceneMismatch(false);
    const off = run(1_000);
    expect(off.health?.scene.mismatch).toBe(false);
    expect(off.worldScene).toBe('scene-3');
  });
});

describe('실시간 mock 송출', () => {
  it('한 바퀴 동안 world·health·ppe 토픽으로만 보내고 위험 이벤트는 만들지 않는다', () => {
    run(EVENT_CYCLE_MS);
    expect([...new Set(sent.map((m) => m.topic))].sort()).toEqual([
      '/topic/health',
      '/topic/ppe',
      '/topic/world',
    ]);
  });

  it('연결이 없으면 보내지 않는다', () => {
    const topics: string[] = [];
    const idle = {
      connections: 0,
      publish: (topic: string) => topics.push(topic),
      dropAll,
      rejectNextConnects,
    } as unknown as StompBroker;
    const other = startRealtimeMock(idle, () => t);
    try {
      run(EVENT_CYCLE_MS);
      expect(topics).toEqual([]);
    } finally {
      other.stop();
    }
  });

  it('expireStomp(): 다음 연결을 ERROR 로 거절하게 하고 지금 연결을 끊는다', () => {
    mock.expireStomp();
    expect(rejectNextConnects).toHaveBeenCalledTimes(1);
    expect(dropAll).toHaveBeenCalledTimes(1);
    expect(rejectNextConnects.mock.invocationCallOrder[0]).toBeLessThan(
      dropAll.mock.invocationCallOrder[0]!,
    );
  });
});

import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  INVALID_STEPS,
  PERIOD,
  SCENARIOS,
  scenarioTick,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

describe('Mock 시나리오 계약', () => {
  it.each(SCENARIOS.map((s) => s.key))('%s: 두 주기 동안 계약을 지키고 결정적이다', (key) => {
    const rejected: number[] = [];
    for (let tick = 0; tick < PERIOD[key] * 2; tick++) {
      const first = JSON.stringify(scenarioTick(key, tick, T0));
      expect(JSON.stringify(scenarioTick(key, tick, T0))).toBe(first);
      for (const out of scenarioTick(key, tick, T0)) {
        if (out.type !== 'message') continue;
        const result = adaptMessage(out.raw, 0);
        if (result.kind === 'rejected') rejected.push(tick % PERIOD[key]);
        else expect(['world', 'event', 'health', 'avatar']).toContain(result.kind);
      }
    }
    if (key === 'invalid-input') {
      expect(rejected).toEqual([...INVALID_STEPS, ...INVALID_STEPS]);
    } else {
      expect(rejected).toEqual([]);
    }
  });

  it('스냅샷 World 는 스트림과 같은 메시지다', () => {
    const streamed = scenarioTick('normal', 7, T0).find((o) => o.type === 'message');
    expect(streamed).toEqual({ type: 'message', raw: scenarioWorld('normal', 7, T0) });
  });
});

import {
  emptySlots,
  hasWorldStates,
  loadedPrefix,
  mergePrefix,
  pendingSpan,
  shouldBuild,
  withWindow,
} from '@/features/history/replayWindows';
import type { ReplayResponse } from '@/features/history/types';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const HOUR = 3_600_000;

const world = (t: number) => ({
  msg_type: 'world_state' as const,
  msg_id: `w-${t}`,
  payload: { t_latest_global: t },
});

/** from~to 창의 응답. 경계 tick 은 앞 창과 뒤 창이 같은 메시지로 준다(서버와 같다). */
function window(from: number, to: number, ticks: number[] = [from, to]): ReplayResponse {
  return {
    from,
    to,
    step_ms: 1_000,
    world_states: ticks.map(world),
    initial_events: [],
    events: [],
    gaps: [],
  };
}

const w0 = window(T0, T0 + HOUR);
const w1 = window(T0 + HOUR, T0 + 2 * HOUR);
const w2 = window(T0 + 2 * HOUR, T0 + 3 * HOUR);
const quiet = window(T0, T0 + HOUR, []);

describe('창 목록(withWindow·emptySlots·loadedPrefix)', () => {
  it('빈 목록은 창 수만큼 비어 있고, 창을 적어도 원본은 그대로다', () => {
    const slots = emptySlots(3);
    expect(slots).toEqual([undefined, undefined, undefined]);
    const next = withWindow(slots, 1, w1);
    expect(next).toEqual([undefined, w1, undefined]);
    expect(slots).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    ['아무것도 못 받음', [undefined, undefined, undefined], 0],
    ['앞 창만 받음', [w0, undefined, undefined], 1],
    ['앞에서부터 끊김 없이', [w0, w1, undefined], 2],
    ['뒤 창을 먼저 받았지만 앞이 비어 있음', [undefined, w1, w2], 0],
    ['가운데가 비어 있으면 거기까지만', [w0, undefined, w2], 1],
    ['전부 받음', [w0, w1, w2], 3],
    ['창이 없음', [], 0],
  ])('앞에서부터 이어서 받은 창 수: %s', (_name, slots, expected) => {
    expect(loadedPrefix(slots)).toBe(expected);
  });
});

describe('첫 화면 가능 여부(hasWorldStates)', () => {
  it('앞 prefix 개 창 안에 World 기록이 하나라도 있으면 true 다', () => {
    expect(hasWorldStates([w0, w1], 2)).toBe(true);
    expect(hasWorldStates([quiet, w1], 1)).toBe(false);
    expect(hasWorldStates([quiet, w1], 2)).toBe(true);
  });

  it('prefix 밖의 창과 못 받은 창은 보지 않는다', () => {
    expect(hasWorldStates([quiet, w1], 1)).toBe(false);
    expect(hasWorldStates([quiet, undefined], 2)).toBe(false);
    expect(hasWorldStates([], 0)).toBe(false);
  });
});

describe('다시 만들 때(shouldBuild)', () => {
  const ask = (prefix: number, builtPrefix: number, firstViewReady = true, total = 8) =>
    shouldBuild({ prefix, total, builtPrefix, firstViewReady });

  it('받은 앞 구간이 없거나 지난번과 같으면 만들지 않는다', () => {
    expect(ask(0, 0)).toBe(false);
    expect(ask(3, 3)).toBe(false);
    // 전부 받은 뒤에도 같은 구간을 다시 만들지 않는다.
    expect(ask(8, 8)).toBe(false);
  });

  it('처음 만들 때는 앞 구간에 World 기록이 있어야 한다(없으면 더 받아 본다)', () => {
    expect(ask(1, 0, false)).toBe(false);
    expect(ask(3, 0, false)).toBe(false);
    expect(ask(1, 0, true)).toBe(true);
  });

  it('전부 받았으면 앞 구간에 기록이 없어도 만든다("없음"을 보이려면 만들어야 한다)', () => {
    expect(ask(8, 0, false)).toBe(true);
    expect(ask(1, 0, false, 1)).toBe(true);
  });

  it('이미 만든 뒤에는 받은 구간이 지난번의 2배가 될 때마다와 전부 받았을 때만 다시 만든다', () => {
    const built: number[] = [];
    let builtPrefix = 0;
    for (let prefix = 1; prefix <= 10; prefix++) {
      if (ask(prefix, builtPrefix, true, 10)) {
        built.push(prefix);
        builtPrefix = prefix;
      }
    }
    expect(built).toEqual([1, 2, 4, 8, 10]);
  });

  it('만든 적 없는 채로 창이 한꺼번에 늘어도(캐시) 한 번에 전부 만든다', () => {
    expect(ask(8, 0, true, 8)).toBe(true);
  });
});

describe('앞 구간 합치기(mergePrefix)', () => {
  it('앞 prefix 개 창만 시간순으로 합치고, 경계 tick 은 한 번만 센다', () => {
    const merged = mergePrefix([w0, w1, undefined], 2);
    expect(merged.world_states.map((item) => item.payload.t_latest_global)).toEqual([
      T0,
      T0 + HOUR,
      T0 + 2 * HOUR,
    ]);
    expect([merged.from, merged.to]).toEqual([T0, T0 + 2 * HOUR]);
  });

  it('뒤 창을 받았어도 앞이 비어 있으면 prefix 밖이라 넣지 않는다', () => {
    const merged = mergePrefix([w0, undefined, w2], 1);
    expect(merged.world_states.map((item) => item.payload.t_latest_global)).toEqual([
      T0,
      T0 + HOUR,
    ]);
  });
});

describe('받지 못한 뒷구간(pendingSpan)', () => {
  const plan = [
    { from: T0, to: T0 + HOUR },
    { from: T0 + HOUR, to: T0 + 2 * HOUR },
    { from: T0 + 2 * HOUR, to: T0 + 3 * HOUR },
  ];

  it('앞 prefix 개 창이 끝나는 시각부터 마지막 창의 끝까지다', () => {
    expect(pendingSpan(plan, 1)).toEqual({ from: T0 + HOUR, to: T0 + 3 * HOUR });
    expect(pendingSpan(plan, 2)).toEqual({ from: T0 + 2 * HOUR, to: T0 + 3 * HOUR });
  });

  it('전부 받았거나 아무것도 받지 못했거나 창이 없으면 null 이다', () => {
    expect(pendingSpan(plan, 3)).toBeNull();
    expect(pendingSpan(plan, 0)).toBeNull();
    expect(pendingSpan([], 0)).toBeNull();
  });
});

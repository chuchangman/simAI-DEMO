import {
  mergeGaps,
  mergeReplay,
  planWindows,
  requestReplay,
  requestReplayWindow,
  type ReplayRange,
} from '@/features/history/api';
import { REPLAY_MAX_FRAMES, REPLAY_MAX_RANGE_MS } from '@/features/history/constants';
import { chooseStep } from '@/features/history/replay';
import type {
  EventEnvelope,
  ReplayGap,
  ReplayResponse,
  WorldEnvelope,
} from '@/features/history/types';
import { ApiError, type Http } from '@/lib/http';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const HOUR = 3_600_000;
const TOO_LARGE = 'REPLAY_RANGE_TOO_LARGE';

// ── 시험용 응답 ───────────────────────────────────────────────────────────────

const world = (t: number): WorldEnvelope => ({
  msg_type: 'world_state',
  msg_id: `w-${t}`,
  payload: { t_latest_global: t },
});
/** 같은 이벤트(event_id)의 전이 하나. 시각은 payload.updated_at 에 둔다. */
const transition = (eventId: string, sequence: number, t: number): EventEnvelope => ({
  msg_type: 'risk_event',
  msg_id: `e-${eventId}-${sequence}`,
  payload: { event_id: eventId, event_sequence: sequence, updated_at: t },
});
const eventAt = (t: number) => transition(`ev-${t}`, 1, t);

const worldTime = (item: WorldEnvelope) => item.payload.t_latest_global;
const eventTime = (item: EventEnvelope) => Number(Reflect.get(item.payload, 'updated_at'));
const ids = (items: readonly { msg_id: string }[]) => items.map((item) => item.msg_id);

const response = (overrides: Partial<ReplayResponse> = {}): ReplayResponse => ({
  from: T0,
  to: T0 + 1_000,
  step_ms: 100,
  world_states: [],
  initial_events: [],
  events: [],
  gaps: [],
  ...overrides,
});

// 서버처럼 step 의 배수 시각마다 World 가 있고(구간 양 끝 포함), 10초마다 이벤트 전이가 있다(from 초과 to 이하).
const EVENT_EVERY_MS = 10_000;
const ticksIn = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
  return out;
};
const transitionsIn = (from: number, to: number) => {
  const out: number[] = [];
  for (
    let t = (Math.floor(from / EVENT_EVERY_MS) + 1) * EVENT_EVERY_MS;
    t <= to;
    t += EVENT_EVERY_MS
  )
    out.push(t);
  return out;
};
const clip = (gaps: readonly ReplayGap[], from: number, to: number) =>
  gaps
    .map((gap) => ({ from: Math.max(gap.from, from), to: Math.min(gap.to, to) }))
    .filter((gap) => gap.from < gap.to);

/** 서버가 range 구간에 줄 응답. initial_events 는 from 시각 표시(i-from) 하나다. */
function serverReplay(range: ReplayRange, gaps: readonly ReplayGap[] = []): ReplayResponse {
  return {
    from: range.from,
    to: range.to,
    step_ms: range.stepMs,
    world_states: ticksIn(range.from, range.to, range.stepMs).map(world),
    initial_events: [
      {
        msg_type: 'risk_event',
        msg_id: `i-${range.from}`,
        payload: { event_id: 'ev-active', updated_at: range.from },
      },
    ],
    events: transitionsIn(range.from, range.to).map(eventAt),
    gaps: clip(gaps, range.from, range.to),
  };
}

interface Call extends ReplayRange {
  path: string;
  signal: AbortSignal | undefined;
}

/** 요청을 기록하는 가짜 Http. 경로의 쿼리를 읽어 answer 에 넘기고, 응답은 실제처럼 schema 로 검사한다. */
function fakeHttp(
  answer: (
    range: ReplayRange,
    signal: AbortSignal | undefined,
  ) => ReplayResponse | Promise<ReplayResponse>,
) {
  const calls: Call[] = [];
  let inflight = 0;
  const peak = { value: 0 };
  const http: Http = async (path, { schema, signal }) => {
    const url = new URL(path, 'http://api.test');
    expect(url.pathname).toBe('/api/replay');
    const range = {
      from: Number(url.searchParams.get('from')),
      to: Number(url.searchParams.get('to')),
      stepMs: Number(url.searchParams.get('step_ms')),
    };
    calls.push({ ...range, path, signal });
    inflight += 1;
    peak.value = Math.max(peak.value, inflight);
    try {
      return schema.parse(await answer(range, signal));
    } finally {
      inflight -= 1;
    }
  };
  return { http, calls, peak };
}

/** 중단 신호가 올 때까지 끝나지 않는 요청. 중단되면 그 이유로 거절한다(fetch 와 같다). */
const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

// ── planWindows ───────────────────────────────────────────────────────────────

const frames = (window: { from: number; to: number }, step: number) =>
  Math.floor((window.to - window.from) / step) + 1;

/** 어떤 구간이든 지켜야 하는 것: 처음부터 끝까지 이어지고, 창마다 1시간·3000 칸 이내다. */
function windowsOf(range: ReplayRange) {
  const windows = planWindows(range);
  expect(windows[0]!.from).toBe(range.from);
  expect(windows.at(-1)!.to).toBe(range.to);
  windows.forEach((window, i) => {
    if (i > 0) expect(window.from).toBe(windows[i - 1]!.to);
    expect(window.to).toBeGreaterThan(window.from);
    expect(window.to - window.from).toBeLessThanOrEqual(REPLAY_MAX_RANGE_MS);
    expect(frames(window, range.stepMs)).toBeLessThanOrEqual(REPLAY_MAX_FRAMES);
  });
  const lengths = windows.map((window) => window.to - window.from);
  // 길이는 같고, 나누어떨어지지 않으면 마지막만 몇 ms 짧다.
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(windows.length);
  return windows;
}

describe('planWindows', () => {
  it.each([
    ['1분(step 100)', 60_000, 100, 1],
    ['정확히 1시간(step 5초)', HOUR, 5_000, 1],
    ['1시간 + 1ms', HOUR + 1, 5_000, 2],
    ['3시간(step 1분)', 3 * HOUR, 60_000, 3],
    ['하루(step 1분)', 24 * HOUR, 60_000, 24],
    ['3000 칸이 딱 맞는 299.9초(step 100)', 299_900, 100, 1],
    ['3001 칸이 되는 299.901초(step 100)', 299_901, 100, 2],
    ['10분(step 100)', 10 * 60_000, 100, 3],
    ['1시간(step 100)', HOUR, 100, 13],
    ['길이가 나누어떨어지지 않는 구간', 10_000_001, 700, 5],
    ['1ms 구간', 1, 100, 1],
  ])('%s 는 창 %i 개로 나눈다', (_name, span, stepMs, count) => {
    const windows = windowsOf({ from: T0, to: T0 + span, stepMs });
    expect(windows).toHaveLength(count);
  });

  it('한 창이면 구간 그대로이고, 나누면 창 길이가 같다', () => {
    expect(planWindows({ from: T0, to: T0 + 60_000, stepMs: 100 })).toEqual([
      { from: T0, to: T0 + 60_000 },
    ]);
    expect(planWindows({ from: T0, to: T0 + 3 * HOUR, stepMs: 60_000 })).toEqual([
      { from: T0, to: T0 + HOUR },
      { from: T0 + HOUR, to: T0 + 2 * HOUR },
      { from: T0 + 2 * HOUR, to: T0 + 3 * HOUR },
    ]);
  });

  it('칸 수 한도는 step 에 따라 달라진다: step 이 작으면 1시간보다 짧게, 크면 1시간에 묶인다', () => {
    // step 100 은 2999 × 100 = 299.9초가 한 창의 상한이다.
    const small = windowsOf({ from: T0, to: T0 + 10 * 60_000, stepMs: 100 });
    expect(Math.max(...small.map((w) => w.to - w.from))).toBeLessThanOrEqual(299_900);
    // step 이 1.2초 이상이면 3000 칸이 아니라 1시간이 먼저 걸린다.
    const large = windowsOf({ from: T0, to: T0 + 2 * HOUR, stepMs: 5_000 });
    expect(large.map((w) => w.to - w.from)).toEqual([HOUR, HOUR]);
  });

  it('기록 간격 선택(chooseStep)이 정한 step 이면 어느 길이든 한도 안으로 나눈다', () => {
    for (const span of [1_000, 60_000, 5 * 60_000, 30 * 60_000, 90 * 60_000, 3 * HOUR, 8 * HOUR]) {
      windowsOf({ from: T0, to: T0 + span, stepMs: chooseStep(T0, T0 + span) });
    }
    // 1.5시간 작업은 1900ms 간격이고 창 둘이다.
    expect(planWindows({ from: T0, to: T0 + 90 * 60_000, stepMs: 1_900 })).toHaveLength(2);
  });

  it('끝이 시작보다 늦지 않으면 창이 없다', () => {
    expect(planWindows({ from: T0, to: T0, stepMs: 100 })).toEqual([]);
    expect(planWindows({ from: T0, to: T0 - 1, stepMs: 100 })).toEqual([]);
    expect(planWindows({ from: Number.NaN, to: T0, stepMs: 100 })).toEqual([]);
  });
});

// ── mergeGaps ─────────────────────────────────────────────────────────────────

describe('mergeGaps', () => {
  it('비어 있으면 비어 있고, 떨어진 구간은 시작 순서로 그대로 둔다', () => {
    expect(mergeGaps([])).toEqual([]);
    expect(
      mergeGaps([
        { from: 50, to: 60 },
        { from: 10, to: 20 },
      ]),
    ).toEqual([
      { from: 10, to: 20 },
      { from: 50, to: 60 },
    ]);
  });

  it('맞닿거나 겹치거나 포함된 구간은 하나로 합친다', () => {
    expect(
      mergeGaps([
        { from: 20, to: 30 },
        { from: 0, to: 10 },
        { from: 10, to: 20 },
        { from: 25, to: 28 },
        { from: 100, to: 120 },
        { from: 110, to: 130 },
      ]),
    ).toEqual([
      { from: 0, to: 30 },
      { from: 100, to: 130 },
    ]);
  });

  it('넘긴 배열과 구간을 고치지 않는다', () => {
    const input = [
      { from: 5, to: 10 },
      { from: 0, to: 6 },
    ];
    const merged = mergeGaps(input);
    expect(merged).toEqual([{ from: 0, to: 10 }]);
    expect(input).toEqual([
      { from: 5, to: 10 },
      { from: 0, to: 6 },
    ]);
    merged[0]!.to = 99;
    expect(input[0]).toEqual({ from: 5, to: 10 });
  });
});

// ── mergeReplay ───────────────────────────────────────────────────────────────

describe('mergeReplay', () => {
  it('합칠 응답이 없으면 오류다', () => {
    expect(() => mergeReplay([])).toThrow('합칠 응답이 없다');
  });

  it('창 경계의 같은 World·이벤트(msg_id)는 한 번만 두고, 시간순을 지킨다', () => {
    const boundary = world(200);
    const boundaryEvent = eventAt(200);
    const a = response({
      to: 200,
      world_states: [world(100), boundary],
      events: [eventAt(150), boundaryEvent],
    });
    const b = response({
      from: 200,
      to: 400,
      world_states: [{ ...boundary }, world(300)],
      events: [{ ...boundaryEvent }, eventAt(300)],
    });
    const merged = mergeReplay([a, b]);

    expect(ids(merged.world_states)).toEqual(['w-100', 'w-200', 'w-300']);
    expect(ids(merged.events)).toEqual(['e-ev-150-1', 'e-ev-200-1', 'e-ev-300-1']);
    // 먼저 온 것을 쓴다.
    expect(merged.world_states[1]).toBe(boundary);
    expect(merged.events[1]).toBe(boundaryEvent);
  });

  it('msg_id 가 다르면 같은 시각이어도 모두 둔다', () => {
    const merged = mergeReplay([
      response({ world_states: [world(100)] }),
      response({ world_states: [{ ...world(100), msg_id: 'other' }] }),
    ]);
    expect(ids(merged.world_states)).toEqual(['w-100', 'other']);
  });

  it('initial_events 는 첫 창의 것만 쓴다', () => {
    const first = [eventAt(1)];
    const merged = mergeReplay([
      response({ initial_events: first }),
      response({ initial_events: [eventAt(2)] }),
      response({ initial_events: [eventAt(3)] }),
    ]);
    expect(merged.initial_events).toBe(first);
  });

  it('창 경계에서 이어지는 gaps 는 하나로 합친다', () => {
    const merged = mergeReplay([
      response({
        to: 200,
        gaps: [
          { from: 10, to: 20 },
          { from: 150, to: 200 },
        ],
      }),
      response({ from: 200, to: 400, gaps: [{ from: 200, to: 260 }] }),
    ]);
    expect(merged.gaps).toEqual([
      { from: 10, to: 20 },
      { from: 150, to: 260 },
    ]);
  });

  it('from 은 첫 창, to 는 마지막 창, step_ms 는 가장 큰 값이다', () => {
    const merged = mergeReplay([
      response({ from: 0, to: 100, step_ms: 100 }),
      response({ from: 100, to: 200, step_ms: 300 }),
      response({ from: 200, to: 350, step_ms: 200 }),
    ]);
    expect([merged.from, merged.to, merged.step_ms]).toEqual([0, 350, 300]);
  });

  it('창이 하나면 내용이 그대로다', () => {
    const only = response({
      world_states: [world(1), world(2)],
      initial_events: [eventAt(1)],
      events: [eventAt(2)],
      gaps: [{ from: 1, to: 2 }],
    });
    expect(mergeReplay([only])).toEqual(only);
  });
});

// ── requestReplayWindow · requestReplay ───────────────────────────────────────

describe('requestReplayWindow', () => {
  it('from·to·step_ms 를 쿼리로 보내고, 받은 응답을 그대로 돌려준다', async () => {
    const range = { from: T0, to: T0 + 5_000, stepMs: 500 };
    const { http, calls } = fakeHttp((r) => serverReplay(r));
    const result = await requestReplayWindow(http, range);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/api/replay?from=${T0}&to=${T0 + 5_000}&step_ms=500`);
    expect(result).toEqual(serverReplay(range));
  });

  it('중단 신호를 넘기고, 모양이 틀린 응답은 거절한다', async () => {
    const controller = new AbortController();
    const { http, calls } = fakeHttp(() => ({ from: 1 }) as unknown as ReplayResponse);
    await expect(
      requestReplayWindow(http, { from: T0, to: T0 + 1_000, stepMs: 100 }, controller.signal),
    ).rejects.toThrow();
    expect(calls[0]!.signal).toBe(controller.signal);
  });
});

describe('requestReplay', () => {
  it('한도 안의 구간은 요청 하나로 받는다', async () => {
    const range = { from: T0, to: T0 + 60_000, stepMs: 500 };
    const gaps = [{ from: T0 + 1_000, to: T0 + 2_000 }];
    const { http, calls } = fakeHttp((r) => serverReplay(r, gaps));
    const result = await requestReplay(http, range);
    expect(calls).toHaveLength(1);
    expect(result).toEqual(serverReplay(range, gaps));
  });

  it('3시간 구간은 정한 간격으로 1시간씩 3번에 받아, 중복 없이 이어 붙이고 from·to 를 지킨다', async () => {
    const range = { from: T0, to: T0 + 3 * HOUR, stepMs: chooseStep(T0, T0 + 3 * HOUR) };
    expect(range.stepMs).toBe(3_700);
    // 첫 창과 둘째 창의 경계에 걸친 기록 없는 구간.
    const outage = [{ from: T0 + HOUR - 30_000, to: T0 + HOUR + 30_000 }];
    const { http, calls, peak } = fakeHttp((r) => serverReplay(r, outage));
    const result = await requestReplay(http, range);

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map((c) => c.from).sort((x, y) => x - y)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(calls.every((c) => c.stepMs === 3_700 && c.to - c.from <= HOUR)).toBe(true);
    expect(peak.value).toBe(3);

    expect([result.from, result.to, result.step_ms]).toEqual([range.from, range.to, 3_700]);
    expect(new Set(ids(result.world_states)).size).toBe(result.world_states.length);
    expect(new Set(ids(result.events)).size).toBe(result.events.length);
    // 하나도 빠지거나 겹치지 않고 시간순이다.
    expect(result.world_states.map(worldTime)).toEqual(ticksIn(range.from, range.to, 3_700));
    expect(result.events.map(eventTime)).toEqual(transitionsIn(range.from, range.to));
    // 시작 시각에 활성이던 이벤트는 첫 창의 것만이다.
    expect(ids(result.initial_events)).toEqual([`i-${T0}`]);
    expect(result.gaps).toEqual(outage);
  });

  it('창 경계가 tick 이면 두 창이 같은 메시지를 주지만 한 번만 센다', async () => {
    // step 1초: 한 창의 상한이 2999초라 3시간은 2700초짜리 창 넷이고, 경계(T0 + 2700초 × i)가 모두 tick 이다.
    const range = { from: T0, to: T0 + 3 * HOUR, stepMs: 1_000 };
    let served = 0;
    const { http, calls } = fakeHttp((r) => {
      const body = serverReplay(r);
      served += body.world_states.length;
      return body;
    });
    const result = await requestReplay(http, range);

    expect(calls).toHaveLength(4);
    expect(result.world_states).toHaveLength(3 * 3_600 + 1);
    expect(served - result.world_states.length).toBe(3);
    expect(result.world_states.map(worldTime)).toEqual(ticksIn(range.from, range.to, 1_000));
    expect(result.events.map(eventTime)).toEqual(transitionsIn(range.from, range.to));
  });

  it('동시에 3개까지만 보내고, 창이 더 많아도 모두 받아 시간순으로 합친다', async () => {
    const range = { from: T0, to: T0 + 10 * HOUR, stepMs: 60_000 };
    const { http, calls, peak } = fakeHttp(async (r) => {
      await Promise.resolve();
      return serverReplay(r);
    });
    const result = await requestReplay(http, range);
    expect(calls).toHaveLength(10);
    expect(peak.value).toBe(3);
    expect(result.world_states.map(worldTime)).toEqual(ticksIn(range.from, range.to, 60_000));
  });

  it.each([1_000_000, 300_000])(
    '창이 너무 크다(REPLAY_RANGE_TOO_LARGE)는 답이 오면 %i ms 이하가 될 때까지 반으로 나눠 받고, 합친 결과는 그대로다',
    async (limit) => {
      const range = { from: T0, to: T0 + HOUR, stepMs: 1_000 };
      // 첫 창의 앞쪽 반을 가르는 기록 없는 구간.
      const outage = [{ from: T0 + 870_000, to: T0 + 930_000 }];
      const baseline = await requestReplay(fakeHttp((r) => serverReplay(r, outage)).http, range);

      const { http, calls } = fakeHttp((r) => {
        if (r.to - r.from > limit) throw new ApiError(400, { code: TOO_LARGE });
        return serverReplay(r, outage);
      });
      const result = await requestReplay(http, range);

      expect(calls.some((c) => c.to - c.from > limit)).toBe(true);
      expect(calls.filter((c) => c.to - c.from <= limit).length).toBeGreaterThan(2);
      expect(result).toEqual(baseline);
      expect(result.world_states.map(worldTime)).toEqual(ticksIn(range.from, range.to, 1_000));
      expect(result.events.map(eventTime)).toEqual(transitionsIn(range.from, range.to));
      expect(ids(result.initial_events)).toEqual([`i-${T0}`]);
      expect(result.gaps).toEqual(outage);
    },
  );

  it('창을 반으로 나눌 때 가운데는 앞 반의 끝이고 뒤 반의 시작이다', async () => {
    const range = { from: T0, to: T0 + HOUR, stepMs: 1_000 };
    const { http, calls } = fakeHttp((r) => {
      if (r.to - r.from > 1_000_000) throw new ApiError(400, { code: TOO_LARGE });
      return serverReplay(r);
    });
    await requestReplay(http, range);
    const spans = calls.map((c) => [c.from - T0, c.to - T0]);
    expect(spans).toEqual(
      expect.arrayContaining([
        [0, 1_800_000],
        [0, 900_000],
        [900_000, 1_800_000],
        [1_800_000, 3_600_000],
        [1_800_000, 2_700_000],
        [2_700_000, 3_600_000],
      ]),
    );
    expect(calls).toHaveLength(6);
  });

  it('더 나눌 수 없을 만큼 짧은데도 거부하면 그 오류를 던진다', async () => {
    const { http, calls } = fakeHttp(() => {
      throw new ApiError(400, { code: TOO_LARGE });
    });
    await expect(
      requestReplay(http, { from: T0, to: T0 + 1_000, stepMs: 100 }),
    ).rejects.toMatchObject({ status: 400, code: TOO_LARGE });
    // 100ms 간격의 두 칸(200ms) 밑으로는 나누지 않는다.
    expect(Math.min(...calls.map((c) => c.to - c.from))).toBeGreaterThanOrEqual(100);
  });

  it.each([
    ['400 이어도 다른 코드', new ApiError(400, { code: 'INVALID_REPLAY_QUERY' })],
    ['코드가 같아도 400 이 아님', new ApiError(500, { code: TOO_LARGE })],
    ['코드 없는 400', new ApiError(400)],
  ])('%s 이면 나누지 않고 그대로 던진다', async (_name, error) => {
    const { http, calls } = fakeHttp(() => {
      throw error;
    });
    await expect(requestReplay(http, { from: T0, to: T0 + 60_000, stepMs: 500 })).rejects.toBe(
      error,
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['401', new ApiError(401)],
    ['네트워크', new ApiError(0, { kind: 'NETWORK' })],
    ['시간 초과', new ApiError(0, { kind: 'TIMEOUT' })],
    ['서버 오류', new ApiError(500)],
  ])(
    '한 창이 %s 오류로 실패하면 같은 오류를 던지고, 나머지 요청을 중단하며 더 보내지 않는다',
    async (_name, error) => {
      // 창 10개. 처음 보낸 3개 중 둘째만 실패하고, 나머지는 중단될 때까지 기다린다.
      const range = { from: T0, to: T0 + 10 * HOUR, stepMs: 60_000 };
      const { http, calls } = fakeHttp((r, signal) => {
        if (r.from === T0 + HOUR) throw error;
        return untilAborted(signal);
      });
      await expect(requestReplay(http, range)).rejects.toBe(error);

      expect(calls.map((c) => c.from)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
      expect(calls.filter((c) => c.from !== T0 + HOUR).every((c) => c.signal?.aborted)).toBe(true);
      // 실패 뒤 잠깐 기다려도 새 창을 보내지 않는다.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toHaveLength(3);
    },
  );

  it('부른 쪽이 중단하면 보낸 요청이 모두 중단되고 그 이유로 거절한다', async () => {
    const range = { from: T0, to: T0 + 5 * HOUR, stepMs: 60_000 };
    const { http, calls } = fakeHttp((_r, signal) => untilAborted(signal));
    const controller = new AbortController();
    const result = requestReplay(http, range, controller.signal);
    controller.abort(new Error('중단'));
    await expect(result).rejects.toThrow('중단');
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
  });

  describe('창 알림(onWindow)', () => {
    const range = { from: T0, to: T0 + 3 * HOUR, stepMs: 3_700 };

    it('창이 끝날 때마다 창의 순서(index)와 응답을 알리고, 합친 결과는 알림이 없을 때와 같다', async () => {
      const seen: [number, number][] = [];
      const { http } = fakeHttp((r) => serverReplay(r));
      const result = await requestReplay(http, range, undefined, (index, window) =>
        seen.push([index, window.from]),
      );

      expect(Object.fromEntries(seen)).toEqual({ 0: T0, 1: T0 + HOUR, 2: T0 + 2 * HOUR });
      expect(seen).toHaveLength(3);
      expect(result).toEqual(await requestReplay(fakeHttp((r) => serverReplay(r)).http, range));
    });

    it('앞 창이 늦어 뒤 창이 먼저 끝나면 끝난 순서대로 알리고 index 는 창의 순서 그대로다', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const { http } = fakeHttp(async (r) => {
        if (r.from === T0) await held;
        return serverReplay(r);
      });
      const seen: number[] = [];
      await requestReplay(http, range, undefined, (index) => {
        seen.push(index);
        // 뒤 두 창이 모두 알려진 뒤에야 첫 창을 놓는다.
        if (seen.length === 2) release();
      });

      expect(seen.at(-1)).toBe(0);
      expect([...seen].sort()).toEqual([0, 1, 2]);
    });

    it('창이 하나라도 실패하면 전체가 실패하고 그 창은 알리지 않는다', async () => {
      const failure = new ApiError(500);
      const { http } = fakeHttp((r) => {
        if (r.from === T0 + HOUR) throw failure;
        return serverReplay(r);
      });
      const seen: number[] = [];
      await expect(requestReplay(http, range, undefined, (index) => seen.push(index))).rejects.toBe(
        failure,
      );
      expect(seen).not.toContain(1);
    });
  });

  it.each([
    ['끝이 시작과 같다', { from: T0, to: T0, stepMs: 100 }],
    ['끝이 시작보다 이르다', { from: T0, to: T0 - 1, stepMs: 100 }],
  ])('%s: 요청을 보내지 않고 INVALID_REPLAY_QUERY(400)로 거절한다', async (_name, range) => {
    const { http, calls } = fakeHttp((r) => serverReplay(r));
    const error = await requestReplay(http, range).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'INVALID_REPLAY_QUERY' });
    expect(calls).toHaveLength(0);
  });
});

import type { WorkUnit } from '@/features/history/types';
import { useWorkReplay } from '@/features/history/useWorkReplay';
import worldStateExample from '@/features/viewer3d/replay/fixtures/world_state.example.jsonl?raw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, configure, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 긴 작업의 기록을 창 단위로 받는다: 앞 창이 오면 화면(재생 Source·색인)을 먼저 만들고, 나머지가 오면 같은 Source 의 기록을 늘린다.
// 서버는 실제 응답 모양으로 흉내 내고(창마다 붙잡아 둘 수 있다), 재생 엔진은 three.js 입구 없이 실제 파서·Source 를 쓴다.

const engine = vi.hoisted(() => ({ created: 0 }));

// 재생 엔진 코드를 처음 읽는 데 시간이 걸려(계약 검사기까지 따라온다) 기다리는 기본 1초로는 모자란다.
configure({ asyncUtilTimeout: 5_000 });

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});
vi.mock('@/features/viewer3d', async () => {
  const { parseReplayLog } = await import('@/features/viewer3d/replay/replayLog');
  const replaySource = await import('@/features/viewer3d/replay/replaySource');
  return {
    parseReplayLog,
    createReplaySource: (...args: Parameters<typeof replaySource.createReplaySource>) => {
      engine.created += 1;
      return replaySource.createReplaySource(...args);
    },
  };
});

const T0 = 1_760_342_400_000;
const HOUR = 3_600_000;
/** 4시간 작업: 기록 간격 3.7초라 1시간씩 창 네 개로 나뉜다(chooseStep·planWindows). */
const WORK: WorkUnit = {
  work_id: 'w-long',
  date: '2025-10-13',
  name: '긴 작업',
  from_ms: T0,
  to_ms: T0 + 4 * HOUR,
  actual_started_at: T0,
  actual_ended_at: T0 + 4 * HOUR,
  zone_id: null,
  planned_people: 1,
};
const WINDOW_START = (index: number) => T0 + index * HOUR;

// ── 시험용 서버 응답 ──────────────────────────────────────────────────────────

const worldTemplate = JSON.parse(worldStateExample.split('\n')[0]!) as {
  msg_id: string;
  sent_at: number;
  payload: { t_latest_global: number; tracks: { t_last_valid: number }[] };
};

/** 계약 검사를 통과하는 World 기록. msg_id 가 시각으로 정해져 창 경계의 같은 tick 은 같은 메시지다. */
function world(t: number) {
  const copy = structuredClone(worldTemplate);
  copy.msg_id = `0192a6f0-7c1e-7b3a-9f2d-${String(t).slice(-12).padStart(12, '0')}`;
  copy.sent_at = t + 20;
  copy.payload.t_latest_global = t;
  copy.payload.tracks.forEach((track) => (track.t_last_valid = t - 20));
  return copy;
}

/** 서버가 창에 주는 기록: 창 처음·끝 tick 둘. quiet 창은 사람이 없어 World 가 없다. */
function replayBody(from: number, to: number, stepMs: number, quiet: ReadonlySet<number>) {
  return {
    from,
    to,
    step_ms: stepMs,
    world_states: quiet.has(from) ? [] : [world(from), world(to)],
    initial_events: [],
    events: [],
    gaps: [],
  };
}

// ── 시험 장치 ─────────────────────────────────────────────────────────────────

interface Gate {
  promise: Promise<void>;
  open: () => void;
}
let gates = new Map<number, Gate>();
let requests: number[] = [];
let failing = new Set<number>();
let quietWindows = new Set<number>();

/** 이 창의 응답을 붙잡아 둔다. open 하면 그제야 서버가 답한다. */
function hold(...indexes: number[]) {
  for (const index of indexes) {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    gates.set(WINDOW_START(index), { promise, open });
  }
}
const release = (index: number) => gates.get(WINDOW_START(index))!.open();

const server = setupServer();
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  // 대역 모듈을 미리 한 번 불러 둔다. 처음 불러오는 중에 훅이 같은 모듈을 요청하면 첫 Source 가 대역을 거치지 않는다.
  await import('@/features/viewer3d');
});
afterAll(() => server.close());
beforeEach(() => {
  engine.created = 0;
  gates = new Map();
  requests = [];
  failing = new Set();
  quietWindows = new Set();
  server.resetHandlers(
    http.get('http://api.test/api/replay', async ({ request }) => {
      const query = new URL(request.url).searchParams;
      const from = Number(query.get('from'));
      requests.push(from);
      await gates.get(from)?.promise;
      if (failing.has(from)) return HttpResponse.json({ code: 'INTERNAL' }, { status: 500 });
      return HttpResponse.json(
        replayBody(from, Number(query.get('to')), Number(query.get('step_ms')), quietWindows),
      );
    }),
  );
});
afterEach(async () => {
  // 붙잡아 둔 창이 있으면 놓고 끝나게 한다(받는 중에 화면을 치우면 서버 대역이 끊긴 요청을 오류로 알린다).
  gates.forEach((gate) => gate.open());
  await settle();
  cleanup();
});

function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useWorkReplay(WORK), { wrapper }) };
}

/** 지금까지 만든 색인이 가진 World 기록 시각들. */
const frameTimes = (index: { frames: { t: number }[] } | null) => index?.frames.map((f) => f.t);
function settle() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 60)));
}

describe('useWorkReplay: 창 단위로 이어 받기', () => {
  it('앞 창이 오면 화면을 먼저 띄우고, 뒤 창이 올 때마다 같은 Source 의 기록을 늘려 전부 오면 pending 이 없어진다', async () => {
    hold(1, 2, 3);
    const { result } = setup();
    expect(result.current.loading).toBe(true);
    expect(result.current.replay).toBeNull();

    // 첫 창만 왔다: 화면이 뜨고, 받은 앞 구간이 첫 창의 끝까지다.
    await waitFor(() => expect(result.current.replay).not.toBeNull());
    const replay = result.current.replay!;
    expect(result.current.loading).toBe(false);
    expect(frameTimes(result.current.index)).toEqual([T0, T0 + HOUR]);
    expect(result.current.index!.pending).toEqual({ from: T0 + HOUR, to: T0 + 4 * HOUR });
    // 창은 시간순으로 시작한다(동시 3개: 앞 세 창).
    expect(requests.slice(0, 3)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);

    // 사용자가 옮겨 둔 재생 상태.
    replay.seek(T0 + 1_800_000);
    replay.setSpeed(2);

    // 둘째 창이 오면 기록이 늘고, Source 는 그대로이며 재생 시각·배속이 남는다.
    release(1);
    await waitFor(() => expect(result.current.index!.frames).toHaveLength(3));
    expect(frameTimes(result.current.index)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(result.current.index!.pending).toEqual({ from: T0 + 2 * HOUR, to: T0 + 4 * HOUR });
    expect(result.current.replay).toBe(replay);
    expect(replay.log.worlds.map((entry) => entry.t)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(replay.getStatus()).toMatchObject({ playhead: T0 + 1_800_000, speed: 2 });

    // 셋째·넷째 창까지 오면 전부 받은 것이다.
    release(2);
    release(3);
    await waitFor(() => expect(result.current.index!.pending).toBeNull());
    expect(frameTimes(result.current.index)).toEqual([0, 1, 2, 3, 4].map((i) => T0 + i * HOUR));
    expect(result.current.replay).toBe(replay);
    expect(replay.getStatus()).toMatchObject({ playhead: T0 + 1_800_000, speed: 2 });
    expect(engine.created).toBe(1);
    expect(result.current.failed).toBe(false);
  });

  it('받은 구간이 지난번 만들 때의 2배가 되기 전에는 다시 만들지 않는다', async () => {
    hold(1, 2, 3);
    const { result } = setup();
    await waitFor(() => expect(result.current.replay).not.toBeNull());

    release(1); // 앞 2개: 2 >= 1 × 2 → 만든다
    await waitFor(() => expect(result.current.index!.frames).toHaveLength(3));
    const afterTwo = result.current.index;

    release(2); // 앞 3개: 3 < 2 × 2 → 만들지 않는다
    await settle();
    expect(result.current.index).toBe(afterTwo);
    expect(result.current.index!.pending).toEqual({ from: T0 + 2 * HOUR, to: T0 + 4 * HOUR });

    release(3); // 전부: 만든다
    await waitFor(() => expect(result.current.index!.pending).toBeNull());
    expect(result.current.index!.frames).toHaveLength(5);
  });

  it('뒤 창이 먼저 와도 앞 창이 올 때까지 화면을 띄우지 않고 그 창은 받은 채로 둔다', async () => {
    hold(0);
    const { result } = setup();
    // 첫 창을 붙잡아 두는 동안 나머지 세 창이 모두 도착한다(동시 3개: 한 창이 끝나면 다음 창이 시작한다).
    await waitFor(() => expect(requests).toHaveLength(4));
    await settle();
    // 둘째~넷째 창은 왔지만 첫 창이 없어 이어진 구간이 없다.
    expect(result.current.replay).toBeNull();
    expect(result.current.loading).toBe(true);

    release(0);
    await waitFor(() => expect(result.current.replay).not.toBeNull());
    expect(frameTimes(result.current.index)).toEqual([0, 1, 2, 3, 4].map((i) => T0 + i * HOUR));
    // 첫 창이 오자 이미 받아 둔 둘째·셋째 창까지 한꺼번에 이어진다(넷째 창까지 전부 받았다).
    expect(result.current.index!.pending).toBeNull();
  });

  it('앞 구간에 World 기록이 없으면(사람이 없던 시간) 기록이 있는 창이 이어질 때까지 화면을 띄우지 않는다', async () => {
    quietWindows = new Set([WINDOW_START(0), WINDOW_START(1)]);
    hold(2, 3);
    const { result } = setup();
    await waitFor(() => expect(requests).toHaveLength(4));
    await settle();
    expect(result.current.replay).toBeNull();
    expect(result.current.loading).toBe(true);

    release(2);
    await waitFor(() => expect(result.current.replay).not.toBeNull());
    expect(frameTimes(result.current.index)).toEqual([T0 + 2 * HOUR, T0 + 3 * HOUR]);
    expect(result.current.index!.pending).toEqual({ from: T0 + 3 * HOUR, to: T0 + 4 * HOUR });

    release(3);
    await waitFor(() => expect(result.current.index!.pending).toBeNull());
    expect(frameTimes(result.current.index)).toEqual([2, 3, 4].map((i) => T0 + i * HOUR));
  });

  it('창이 하나라도 실패하면 전체 실패로 알린다', async () => {
    failing = new Set([WINDOW_START(1)]);
    const { result } = setup();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.error).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('이미 받은 작업을 다시 열면 요청 없이 전부 받은 채로 한 번에 만든다', async () => {
    const first = setup();
    await waitFor(() => expect(first.result.current.index?.pending).toBeNull());
    expect(requests).toHaveLength(4);
    first.unmount();

    requests = [];
    const second = setup(first.client);
    await waitFor(() => expect(second.result.current.replay).not.toBeNull());
    expect(second.result.current.index!.pending).toBeNull();
    expect(second.result.current.index!.frames).toHaveLength(5);
    expect(requests).toHaveLength(0);
    expect(engine.created).toBe(2);
  });
});

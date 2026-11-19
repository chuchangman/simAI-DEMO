import {
  mergeReplay,
  planWindows,
  requestReplay,
  requestReplayWindow,
} from '@/features/history/api';
import {
  chooseStep,
  fitLog,
  holdFor,
  replayErrorLine,
  replayFiles,
} from '@/features/history/replay';
import { allGap, frameAt, indexReplay, noDataAt } from '@/features/history/replayIndex';
import { replayResponseSchema } from '@/features/history/types';
import { TBM_TASKS } from '@/features/tbm/tbmDemo';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { parseReplayLog } from '@/features/viewer3d/replay/replayLog';
import { ApiError, createHttp } from '@/lib/http';
import { createHistoryMock, hasNoRecord, historyReplay, historyWorks } from '@/mocks/history';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// 오늘 11시. 09시 작업은 진행 중이고 13시 작업은 아직 시작하지 않았다.
const NOW = new Date(2026, 9, 29, 11, 0).getTime();
const HOUR = 3_600_000;
const LAST = TBM_TASKS[TBM_TASKS.length - 1]!;
const BASE = 'http://api.test';

const works = historyWorks(NOW);
const workOf = (id: string) => works.find((w) => w.work_id === id)!;
/** 진행 중인 작업(09:00–12:00). 11시 현재 지금 뒤가 기록 없는 구간이다. */
const TODAY_T1 = workOf('2026-10-29-T1');
/** 어제 09:00–12:00(3시간), 10:00–11:30(1.5시간: 3시간 작업 안에 든다). */
const PREV_T1 = workOf('2026-10-28-T1');
const PREV_T2 = workOf('2026-10-28-T2');

// mock 의 기록 없는 시간(src/mocks/history.ts): 작업 구간 40% 쯤 2분은 끊김(gaps), 20% 쯤 1분은 빈 방(gaps 아님).
const OUTAGE_MS = 2 * 60_000;
const EMPTY_ROOM_MS = 60_000;
const at40 = (work: { from_ms: number; to_ms: number }) =>
  work.from_ms + Math.floor((work.to_ms - work.from_ms) * 0.4);
/** 같은 날 hh:mm 의 ms. */
const at = (day: number, hhmm: string) => {
  const d = new Date(day);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
};
const at20 = (work: { from_ms: number; to_ms: number }) =>
  work.from_ms + Math.floor((work.to_ms - work.from_ms) * 0.2);

/** historyReplay 를 서버 응답으로 읽는다(스키마 검사 포함). */
const replayOf = (from: number, to: number, step: number) =>
  replayResponseSchema.parse(historyReplay(works, from, to, step, NOW));

/** 네트워크를 지나온 값과 비교하려고 JSON 으로 한 번 돌린다(-0 은 0 이 된다). */
const overWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sourceOf = (item: { payload: object }) => Reflect.get(item.payload, 'source');
const updatedAt = (item: { payload: object }) => Number(Reflect.get(item.payload, 'updated_at'));
const worldTime = (item: { payload: { t_latest_global: number } }) => item.payload.t_latest_global;
const ids = (items: readonly { msg_id: string }[]) => items.map((item) => item.msg_id);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.events.removeAllListeners());
afterAll(() => server.close());
beforeEach(() => server.resetHandlers(...createHistoryMock({ now: () => NOW }).handlers));

const get = (path: string, account: string | null = 'viewer') =>
  fetch(`${BASE}${path}`, {
    headers: account ? { Authorization: `Bearer mock-token.${account}` } : {},
  });

/** 실제 createHttp 로 mock 서버에 묻는다(로그인한 열람자). */
const client = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.viewer' });

describe('히스토리 mock: 작업 목록', () => {
  it('최근 3일의 TBM 작업을 서버처럼 시작 전인 것까지 주고, 가장 오래된 날 마지막 작업만 기록이 없다', () => {
    expect(works.some((w) => w.from_ms > NOW)).toBe(true);
    expect([...new Set(works.map((w) => w.date))]).toEqual([
      '2026-10-29',
      '2026-10-28',
      '2026-10-27',
    ]);
    expect(works.filter((w) => w.date === '2026-10-29').map((w) => w.name)).toEqual(
      TBM_TASKS.map((t) => t.name),
    );
    const none = works.filter(hasNoRecord);
    expect(none.map((w) => w.work_id)).toEqual([`2026-10-27-${LAST.id}`]);
    expect(none[0]!.event_counts).toBeNull();
  });

  it('작업마다 상태와 실제 시작·종료를 서버처럼 준다(시작 전은 둘 다 없고 진행 중은 종료만 없다)', () => {
    const today = works.filter((w) => w.date === '2026-10-29');
    expect(today.map((w) => [w.status, w.actual_started_at, w.actual_ended_at])).toEqual([
      ['IN_PROGRESS', today[0]!.from_ms, null],
      ['IN_PROGRESS', today[1]!.from_ms, null],
      ['PLANNED', null, null],
    ]);
    const past = works.filter((w) => w.date !== '2026-10-29');
    expect(past.every((w) => w.status === 'DONE')).toBe(true);
    expect(
      past.every((w) => w.actual_started_at === w.from_ms && w.actual_ended_at === w.to_ms),
    ).toBe(true);
  });

  it('작업 목록을 주고, 로그인하지 않았으면 401 이다', async () => {
    const body = await (await get('/api/work-units?days=7')).json();
    expect(body).not.toHaveProperty('contract');
    expect(body.works).toHaveLength(works.length);
    expect((await get('/api/work-units?days=7', null)).status).toBe(401);
  });
});

describe('히스토리 mock: 오늘 작업은 TBM 목의 작업을 따른다(liveWorks)', () => {
  const liveWork = (patch: Partial<TbmWorkUnit>): TbmWorkUnit => ({
    work_id: 'live-1',
    date: '2026-10-29',
    name: '관제에서 시작한 작업',
    from_ms: at(NOW, '13:00'),
    to_ms: at(NOW, '15:00'),
    zone_id: null,
    place: '북서쪽 바닥',
    planned_people: 2,
    lead: null,
    layout_id: null,
    work_type: null,
    status: 'PLANNED',
    ...patch,
  });
  const listOf = async (live: TbmWorkUnit[]) => {
    server.resetHandlers(...createHistoryMock({ now: () => NOW, liveWorks: () => live }).handlers);
    return (await (await get('/api/work-units?days=7')).json()).works as Record<string, unknown>[];
  };

  it('오늘 작업은 그 목의 작업이고 지난 이틀은 끝난 데모 작업이다. 시작 전 작업은 시작 기록이 없다', async () => {
    const list = await listOf([liveWork({})]);
    const today = list.filter((w) => w.date === '2026-10-29');
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({
      work_id: 'live-1',
      status: 'PLANNED',
      actual_started_at: null,
      actual_ended_at: null,
    });
    expect(list.filter((w) => w.date !== '2026-10-29').length).toBe(2 * TBM_TASKS.length);
  });

  it('시작한 작업은 시작 시각이 따라오고, 그 구간의 기록과 이벤트 수를 준다', async () => {
    const startedAt = NOW - 30 * 60_000;
    const live = liveWork({
      from_ms: NOW - HOUR,
      to_ms: NOW + HOUR,
      status: 'IN_PROGRESS',
      actual_started_at: startedAt,
    });
    const list = await listOf([live]);
    expect(list[0]).toMatchObject({ status: 'IN_PROGRESS', actual_started_at: startedAt });
    expect(list[0]!.actual_ended_at).toBeNull();
    expect(list[0]!.event_counts).not.toBeNull();

    const body = await (
      await get(`/api/replay?from=${startedAt}&to=${NOW}&step_ms=${chooseStep(startedAt, NOW)}`)
    ).json();
    expect(replayResponseSchema.parse(body).world_states.length).toBeGreaterThan(0);
  });
});

describe('히스토리 mock: 구간 기록은 실제 /api/replay 모양이다', () => {
  const step = chooseStep(TODAY_T1.from_ms, TODAY_T1.to_ms);
  const range = { from: TODAY_T1.from_ms, to: TODAY_T1.to_ms };

  it('봉투(world_states·initial_events·events·gaps)가 스키마를 통과하고, 이벤트 출처는 LIVE 다', () => {
    expect(step).toBe(3_700);
    const body = historyReplay(works, range.from, range.to, step, NOW);
    expect(Object.keys(body).sort()).toEqual(
      ['events', 'from', 'gaps', 'initial_events', 'step_ms', 'to', 'world_states'].sort(),
    );
    const data = replayResponseSchema.parse(body);

    expect([data.from, data.to, data.step_ms]).toEqual([range.from, range.to, step]);
    expect(data.world_states.length).toBeGreaterThan(0);
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.world_states.every((w) => w.msg_type === 'world_state')).toBe(true);
    expect([...data.initial_events, ...data.events].every((e) => e.msg_type === 'risk_event')).toBe(
      true,
    );
    expect([...data.initial_events, ...data.events].map(sourceOf)).toEqual(
      new Array<string>(data.initial_events.length + data.events.length).fill('LIVE'),
    );
  });

  it('replayFiles 와 재생 엔진(parseReplayLog)이 줄을 하나도 빼지 않고, 엔진에는 REPLAY 이벤트가 들어간다', () => {
    const data = replayOf(range.from, range.to, step);
    const files = replayFiles(data);
    const log = parseReplayLog(files);

    expect(log.issues).toEqual([]);
    expect(log.worlds).toHaveLength(data.world_states.length);
    expect(log.events).toHaveLength(data.initial_events.length + data.events.length);
    expect(log.events.length).toBeGreaterThan(0);
    expect(log.events.map((e) => JSON.parse(e.text).payload.source)).toEqual(
      new Array<string>(log.events.length).fill('REPLAY'),
    );
    // 받은 응답은 LIVE 그대로다.
    expect(data.events.every((e) => sourceOf(e) === 'LIVE')).toBe(true);
    // World 는 지금(now)까지만 있다.
    expect(log.worlds.every((w) => w.t <= NOW)).toBe(true);
  });

  it('작업 구간 40% 쯤의 2분 끊김과 지금 뒤는 gaps 이고, 그 시간에는 World 가 없다', () => {
    const data = replayOf(range.from, range.to, step);
    const outage = at40(TODAY_T1);
    expect(data.gaps).toEqual([
      { from: outage, to: outage + OUTAGE_MS },
      { from: NOW, to: range.to },
    ]);

    const times = data.world_states.map(worldTime);
    expect(times.filter((t) => t >= outage && t < outage + OUTAGE_MS)).toEqual([]);
    // 끊김 앞뒤로는 기록이 있다.
    expect(outage - times.filter((t) => t < outage).at(-1)!).toBeLessThanOrEqual(step);
    expect(times.find((t) => t >= outage + OUTAGE_MS)! - (outage + OUTAGE_MS)).toBeLessThan(step);
    // 지금 뒤에는 기록이 없다.
    expect(times.every((t) => t <= NOW)).toBe(true);
    expect(NOW - times.at(-1)!).toBeLessThan(step);
  });

  it('작업 구간 20% 쯤의 1분 빈 방은 World 만 없고 gaps 에는 들지 않는다(아무도 없던 것)', () => {
    const data = replayOf(range.from, range.to, step);
    const empty = at20(TODAY_T1);
    const times = data.world_states.map(worldTime);

    expect(times.filter((t) => t >= empty && t < empty + EMPTY_ROOM_MS)).toEqual([]);
    expect(empty - times.filter((t) => t < empty).at(-1)!).toBeLessThanOrEqual(step);
    expect(times.find((t) => t >= empty + EMPTY_ROOM_MS)! - (empty + EMPTY_ROOM_MS)).toBeLessThan(
      step,
    );
    expect(data.gaps.every((g) => g.to <= empty || g.from >= empty + EMPTY_ROOM_MS)).toBe(true);
  });

  it('화면 계산: 끊김과 지금 뒤는 "데이터 없음", 빈 방은 "아무도 없음"이다', () => {
    const data = replayOf(range.from, range.to, step);
    const log = fitLog(parseReplayLog(replayFiles(data)), range);
    const index = indexReplay(log, data.gaps);
    const hold = holdFor(step);

    expect([log.start, log.end]).toEqual([range.from, range.to]);
    expect(index.gaps).toEqual(data.gaps);
    expect(allGap(index.gaps, range)).toBe(false);

    const outage = at40(TODAY_T1);
    expect(frameAt(index, outage + OUTAGE_MS / 2, hold)).toBeNull();
    expect(noDataAt(index, outage + OUTAGE_MS / 2, hold)).toBe(true);
    expect(noDataAt(index, NOW + 600_000, hold)).toBe(true);

    const empty = at20(TODAY_T1);
    expect(frameAt(index, empty + EMPTY_ROOM_MS / 2, hold)).toBeNull();
    expect(noDataAt(index, empty + EMPTY_ROOM_MS / 2, hold)).toBe(false);

    const recorded = index.frames[10]!.t;
    expect(frameAt(index, recorded, hold)).not.toBeNull();
    expect(noDataAt(index, recorded, hold)).toBe(false);
    // 사람은 기록에서 나온다.
    expect(index.workers.length).toBeGreaterThan(0);
    expect(index.events.length).toBeGreaterThan(0);
  });

  it('기록 없는 작업과 구간이 같으면 구간 전체가 하나의 gap 이고 World·이벤트가 없다', () => {
    const none = works.find(hasNoRecord)!;
    const data = replayOf(none.from_ms, none.to_ms, 5_000);
    expect(data.world_states).toEqual([]);
    expect(data.events).toEqual([]);
    expect(data.initial_events).toEqual([]);
    expect(data.gaps).toEqual([{ from: none.from_ms, to: none.to_ms }]);
    expect(allGap(data.gaps, { from: none.from_ms, to: none.to_ms })).toBe(true);

    // 작업 안의 일부 구간을 물어도 그 구간 전체가 gap 이다.
    const part = replayOf(none.from_ms + 60_000, none.from_ms + 120_000, 1_000);
    expect(part.world_states).toEqual([]);
    expect(part.gaps).toEqual([{ from: none.from_ms + 60_000, to: none.from_ms + 120_000 }]);

    // 같은 날 다른 작업은 기록이 있다.
    const other = works.find((w) => w.date === none.date && !hasNoRecord(w))!;
    const recorded = replayOf(other.from_ms, other.to_ms, 5_000);
    expect(recorded.world_states.length).toBeGreaterThan(0);
    expect(allGap(recorded.gaps, { from: other.from_ms, to: other.to_ms })).toBe(false);
  });

  it('어느 작업에도 속하지 않는 구간은 요청한 구간 자체를 한 작업으로 본다', () => {
    const from = NOW - 10 * 86_400_000;
    const to = from + 600_000;
    const data = replayOf(from, to, 1_000);
    expect(data.gaps).toEqual([{ from: from + 240_000, to: from + 240_000 + OUTAGE_MS }]);
    // 601 칸 중 끊김 120 칸과 빈 방 60 칸이 빠진다.
    expect(data.world_states).toHaveLength(601 - 120 - 60);
  });

  it('지금보다 뒤에 시작하는 창은 World·이벤트 없이 창 전체가 gap 이다', () => {
    const from = NOW + 60_000;
    const to = NOW + 120_000;
    const data = replayOf(from, to, 1_000);
    expect(data.world_states).toEqual([]);
    expect(data.events).toEqual([]);
    expect(data.gaps).toEqual([{ from, to }]);
  });

  it('msg_id 는 같은 시각이면 같다: 같은 구간을 다시 읽어도 같고, 겹치는 창은 경계 tick 을 같이 준다', () => {
    const mid = PREV_T1.from_ms + 1_800_000;
    const end = mid + 1_800_000;
    const first = replayOf(PREV_T1.from_ms, mid, 1_000);
    const second = replayOf(mid, end, 1_000);

    expect(replayOf(PREV_T1.from_ms, mid, 1_000)).toEqual(first);
    // 경계(mid)는 1초 간격의 tick 이라 두 창이 같은 메시지를 준다.
    expect(worldTime(first.world_states.at(-1)!)).toBe(mid);
    expect(worldTime(second.world_states[0]!)).toBe(mid);
    expect(first.world_states.at(-1)).toEqual(second.world_states[0]);
    // 이벤트 전이는 (from, to] 라 두 창이 겹치지 않는다.
    expect(ids(first.events).filter((id) => ids(second.events).includes(id))).toEqual([]);

    // 두 창을 합치면 한 번에 받은 것과 같다.
    const whole = replayOf(PREV_T1.from_ms, end, 1_000);
    const merged = mergeReplay([first, second]);
    expect(ids(merged.world_states)).toEqual(ids(whole.world_states));
    expect(ids(merged.events)).toEqual(ids(whole.events));
    expect(merged.initial_events).toEqual(whole.initial_events);
    expect(new Set(ids(merged.world_states)).size).toBe(merged.world_states.length);
  });

  it('initial_events 는 시작 시각에 활성인 이벤트의 그 시각 상태이고, 전이(events)와 겹치지 않는다', () => {
    const scan = replayOf(PREV_T1.from_ms, PREV_T1.from_ms + HOUR, 5_000);
    const raised = scan.events.find((e) => Reflect.get(e.payload, 'lifecycle') === 'RAISED')!;
    // 발생 1초 뒤: 어느 이벤트든 아직 해소 전이다.
    const from = updatedAt(raised) + 1_000;
    const data = replayOf(from, from + 10_000, 1_000);

    const initial = data.initial_events.map((e) => e.payload);
    expect(initial.map((p) => p.event_id)).toContain(raised.payload.event_id);
    expect(initial.every((p) => Reflect.get(p, 'lifecycle') !== 'RESOLVED')).toBe(true);
    expect(data.initial_events.every((e) => updatedAt(e) <= from)).toBe(true);
    expect(data.events.every((e) => updatedAt(e) > from)).toBe(true);
    expect(ids(data.initial_events).filter((id) => ids(data.events).includes(id))).toEqual([]);

    // 재생 엔진은 시작 전 상태를 먼저 받고 그 뒤 전이를 받는다.
    const log = parseReplayLog(replayFiles(data));
    expect(log.issues).toEqual([]);
    expect(log.events[0]!.t).toBeLessThanOrEqual(from);
  });
});

describe('히스토리 mock: GET /api/replay 한도와 오류', () => {
  const code = async (path: string, account: string | null = 'viewer') => {
    const response = await get(path, account);
    return [response.status, (await response.json()).code];
  };
  const SPAN = `from=${NOW - 1_000}&to=${NOW}`;

  it.each([
    ['쿼리가 없다', ''],
    ['from 이 없다', `to=${NOW}&step_ms=100`],
    ['to 가 없다', `from=${NOW - 1_000}&step_ms=100`],
    ['from 이 숫자가 아니다', `from=abc&to=${NOW}&step_ms=100`],
    ['to 가 숫자가 아니다', `from=${NOW - 1_000}&to=xyz&step_ms=100`],
    ['from 이 정수가 아니다', `from=1.5&to=${NOW}&step_ms=100`],
    ['from 이 음수다', `from=-5&to=${NOW}&step_ms=100`],
    ['끝이 시작과 같다', `from=${NOW}&to=${NOW}&step_ms=100`],
    ['끝이 시작보다 이르다', `from=${NOW}&to=${NOW - 1_000}&step_ms=100`],
    ['step_ms 가 50 이다(최소 100)', `${SPAN}&step_ms=50`],
    ['step_ms 가 0 이다', `${SPAN}&step_ms=0`],
    ['step_ms 가 음수다', `${SPAN}&step_ms=-100`],
    ['step_ms 가 60001 이다(최대 60000)', `${SPAN}&step_ms=60001`],
    ['step_ms 가 숫자가 아니다', `${SPAN}&step_ms=abc`],
  ])('%s: 400 INVALID_REPLAY_QUERY', async (_name, query) => {
    expect(await code(`/api/replay?${query}`)).toEqual([400, 'INVALID_REPLAY_QUERY']);
  });

  it('오류 본문에 status·code·detail 이 있다', async () => {
    const response = await get(`/api/replay?${SPAN}&step_ms=50`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: 400,
      code: 'INVALID_REPLAY_QUERY',
      detail: expect.any(String),
    });
  });

  it.each([
    ['구간이 1시간보다 1ms 길다', `from=${NOW - HOUR - 1}&to=${NOW}&step_ms=5000`],
    ['구간이 2시간이다(칸 수는 적다)', `from=${NOW - 2 * HOUR}&to=${NOW}&step_ms=60000`],
    ['칸 수가 3001 이다(300초, step 100)', `from=${NOW - 300_000}&to=${NOW}&step_ms=100`],
    ['step_ms 를 빼면 100 이라 5분은 3001 칸이다', `from=${NOW - 300_000}&to=${NOW}`],
    ['칸 수가 3001 이다(3000초, step 1초)', `from=${NOW - 3_000_000}&to=${NOW}&step_ms=1000`],
  ])('%s: 400 REPLAY_RANGE_TOO_LARGE', async (_name, query) => {
    expect(await code(`/api/replay?${query}`)).toEqual([400, 'REPLAY_RANGE_TOO_LARGE']);
  });

  it('정확히 1시간은 받을 수 있다', async () => {
    const response = await get(`/api/replay?from=${NOW - HOUR}&to=${NOW}&step_ms=5000`);
    expect(response.status).toBe(200);
    const body = replayResponseSchema.parse(await response.json());
    expect([body.from, body.to, body.step_ms]).toEqual([NOW - HOUR, NOW, 5_000]);
    expect(body.world_states.length).toBeGreaterThan(0);
  });

  it('칸 수가 정확히 3000 이면 받을 수 있다', async () => {
    // 299.9초 / 100ms + 1 = 3000.
    const response = await get(`/api/replay?from=${NOW - 299_900}&to=${NOW}&step_ms=100`);
    expect(response.status).toBe(200);
    const body = replayResponseSchema.parse(await response.json());
    expect(body.world_states).toHaveLength(3_000);
  });

  it('step_ms 를 빼면 최소(100)로 받는다', async () => {
    const response = await get(`/api/replay?${SPAN}`);
    expect(response.status).toBe(200);
    expect(replayResponseSchema.parse(await response.json()).step_ms).toBe(100);
  });

  it('로그인하지 않았으면 401 이다(값 검사보다 먼저)', async () => {
    expect(await code(`/api/replay?${SPAN}&step_ms=500`, null)).toEqual([401, 'UNAUTHORIZED']);
    expect(await code('/api/replay', null)).toEqual([401, 'UNAUTHORIZED']);
  });
});

describe('실제 createHttp 로 받는 구간 기록', () => {
  it('응답 한 창을 replayResponseSchema 로 읽는다', async () => {
    const range = { from: PREV_T1.from_ms, to: PREV_T1.from_ms + 60_000, stepMs: 500 };
    const data = await requestReplayWindow(client, range);
    expect([data.from, data.to, data.step_ms]).toEqual([range.from, range.to, 500]);
    expect(data.world_states).toHaveLength(121);
    expect(data).toEqual(overWire(replayOf(range.from, range.to, 500)));
  });

  it('서버 오류 코드는 ApiError 로 오고, 화면 문구가 정해져 있다', async () => {
    const tooLarge = await requestReplayWindow(client, {
      from: NOW - 2 * HOUR,
      to: NOW,
      stepMs: 60_000,
    }).catch((e: unknown) => e);
    expect(tooLarge).toBeInstanceOf(ApiError);
    expect(tooLarge).toMatchObject({ status: 400, code: 'REPLAY_RANGE_TOO_LARGE' });
    expect(replayErrorLine(tooLarge)).toBe('기록이 너무 많아 불러오지 못했습니다.');

    const invalid = await requestReplayWindow(client, {
      from: NOW - 1_000,
      to: NOW,
      stepMs: 50,
    }).catch((e: unknown) => e);
    expect(invalid).toMatchObject({ status: 400, code: 'INVALID_REPLAY_QUERY' });
    expect(replayErrorLine(invalid)).toBe('작업 구간이 올바르지 않습니다.');

    const anonymous = await requestReplayWindow(createHttp({ baseUrl: BASE }), {
      from: NOW - 1_000,
      to: NOW,
      stepMs: 500,
    }).catch((e: unknown) => e);
    expect(anonymous).toMatchObject({ status: 401 });
    expect(replayErrorLine(anonymous)).toBe('다시 로그인해 주세요.');
  });

  it('연결이 끊기거나 모양이 틀린 응답도 화면 문구로 바뀐다', async () => {
    const range = { from: NOW - 1_000, to: NOW, stepMs: 500 };
    server.use(http.get('*/api/replay', () => HttpResponse.error()));
    const network = await requestReplayWindow(client, range).catch((e: unknown) => e);
    expect(network).toMatchObject({ kind: 'NETWORK' });
    expect(replayErrorLine(network)).toBe('서버에 연결하지 못했습니다.');

    server.use(http.get('*/api/replay', () => HttpResponse.json({ from: 1 })));
    const invalid = await requestReplayWindow(client, range).catch((e: unknown) => e);
    expect(invalid).toMatchObject({ kind: 'INVALID_RESPONSE' });
    expect(replayErrorLine(invalid)).toBe('기록을 읽지 못했습니다.');
  });

  it('1.5시간 작업(어제 T2)은 창 둘로 받아 합치고, 한 번에 받은 것과 같으며 재생 엔진이 하나도 빼지 않는다', async () => {
    const range = {
      from: PREV_T2.from_ms,
      to: PREV_T2.to_ms,
      stepMs: chooseStep(PREV_T2.from_ms, PREV_T2.to_ms),
    };
    expect(range.stepMs).toBe(1_900);
    const requested: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/api/replay') requested.push(url);
    });

    const merged = await requestReplay(client, range);

    // 창 둘, 각 창은 1시간 안이고 step 은 그대로다.
    const windows = planWindows(range);
    expect(windows).toHaveLength(2);
    expect(
      requested
        .map((u) => [Number(u.searchParams.get('from')), Number(u.searchParams.get('to'))])
        .sort((a, b) => a[0]! - b[0]!),
    ).toEqual(windows.map((w) => [w.from, w.to]));
    expect(requested.every((u) => u.searchParams.get('step_ms') === '1900')).toBe(true);

    expect([merged.from, merged.to, merged.step_ms]).toEqual([range.from, range.to, 1_900]);
    expect(new Set(ids(merged.world_states)).size).toBe(merged.world_states.length);
    expect(new Set(ids(merged.events)).size).toBe(merged.events.length);
    expect(merged).toEqual(overWire(replayOf(range.from, range.to, range.stepMs)));

    // 끊김 2분은 하나의 gap 이고 작업 구간 안이다. (3시간 작업 안에 든 구간이라 그 작업 기준으로 끊긴다.)
    expect(merged.gaps).toHaveLength(1);
    const [outage] = merged.gaps;
    expect(outage!.to - outage!.from).toBe(OUTAGE_MS);
    expect(outage!.from).toBeGreaterThanOrEqual(range.from);
    expect(outage!.to).toBeLessThanOrEqual(range.to);

    const log = parseReplayLog(replayFiles(merged));
    expect(log.issues).toEqual([]);
    expect(log.worlds).toHaveLength(merged.world_states.length);
    expect(log.events).toHaveLength(merged.initial_events.length + merged.events.length);

    const index = indexReplay(fitLog(log, range), merged.gaps);
    expect(noDataAt(index, outage!.from + OUTAGE_MS / 2, holdFor(range.stepMs))).toBe(true);
    expect(allGap(index.gaps, range)).toBe(false);
  });
});

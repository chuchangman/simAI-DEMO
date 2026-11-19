import { REPLAY_MAX_FRAMES } from '@/features/history/constants';
import {
  asReplayEvent,
  chooseStep,
  fitLog,
  holdFor,
  replayErrorLine,
  replayFiles,
} from '@/features/history/replay';
import {
  allGap,
  frameAt,
  indexReplay,
  inGap,
  inPending,
  isActiveAt,
  noDataAt,
} from '@/features/history/replayIndex';
import type { ReplayResponse, WorkUnit } from '@/features/history/types';
import {
  formatDate,
  groupByDate,
  readWorks,
  replayRange,
  startedWorks,
  timeRange,
  workTimeRange,
} from '@/features/history/works';
import type { ReplayLog } from '@/features/viewer3d';
import { ApiError } from '@/lib/http';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

/** 그 시각에 보이는 사람(화면은 기록 하나를 frameAt 으로 골라 그 ids 를 쓴다). */
const visibleAt = (index: Parameters<typeof frameAt>[0], t: number, holdMs: number) =>
  new Set(frameAt(index, t, holdMs)?.ids);

const work = (overrides: Partial<WorkUnit> = {}): WorkUnit => ({
  work_id: 'w',
  date: '2026-10-29',
  name: '작업',
  from_ms: T0,
  to_ms: T0 + 60_000,
  actual_started_at: null,
  actual_ended_at: null,
  zone_id: null,
  planned_people: 2,
  ...overrides,
});

// indexReplay 는 기록의 시각(t)과 원문(text)만 읽는다.
const world = (t: number, ids: string[]) => ({
  t,
  text: JSON.stringify({ payload: { tracks: ids.map((world_id) => ({ world_id })) } }),
});
const event = (t: number, payload: Record<string, unknown>) => ({
  t,
  text: JSON.stringify({ payload }),
});
const logOf = (worlds: { t: number; text: string }[], events: { t: number; text: string }[] = []) =>
  ({ worlds, events }) as unknown as ReplayLog;

describe('작업 다시 보기 계산', () => {
  it('형식이 틀렸거나 끝이 시작보다 이르지 않은 작업은 뺀다', () => {
    const items = [work(), { ...work(), date: '10/29' }, work({ to_ms: T0 }), 'x'];
    expect(readWorks(items).map((w) => w.work_id)).toEqual(['w']);
  });

  it('실제 시작 기록이 있는 작업만 남기고(진행 중·끝난 작업), 작업은 같은 객체로 돌려준다', () => {
    const planned = work({ work_id: 'planned', from_ms: T0 - 1 });
    const running = work({ work_id: 'running', actual_started_at: T0 });
    const done = work({ work_id: 'done', actual_started_at: T0 - 5, actual_ended_at: T0 });
    const started = startedWorks([planned, running, done]);
    expect(started.map((w) => w.work_id)).toEqual(['running', 'done']);
    expect(started[0]).toBe(running);
    expect(startedWorks([])).toEqual([]);
  });

  it('다시 볼 구간은 실제 시작부터 실제 종료까지이고, 진행 중이면 지금까지다', () => {
    const done = work({ actual_started_at: T0 + 10, actual_ended_at: T0 + 500 });
    expect(replayRange(done, T0 + 9_999)).toEqual({ from: T0 + 10, to: T0 + 500 });
    const running = work({ actual_started_at: T0 + 10 });
    expect(replayRange(running, T0 + 700)).toEqual({ from: T0 + 10, to: T0 + 700 });
  });

  it('시작 전이거나 구간 길이가 0 이면 다시 볼 구간이 없다', () => {
    expect(replayRange(work(), T0 + 1)).toBeNull();
    const justStarted = work({ actual_started_at: T0 + 10 });
    expect(replayRange(justStarted, T0 + 10)).toBeNull();
    expect(replayRange(justStarted, T0)).toBeNull();
    const zeroLength = work({ actual_started_at: T0 + 10, actual_ended_at: T0 + 10 });
    expect(replayRange(zeroLength, T0 + 99)).toBeNull();
  });

  it('날짜별로 새 날짜부터 묶고, 날짜 안에서는 시작 시각순이다', () => {
    const groups = groupByDate([
      work({ work_id: 'a2', date: '2026-10-28', actual_started_at: T0 + 2 }),
      work({ work_id: 'b', date: '2026-10-29' }),
      work({ work_id: 'a1', date: '2026-10-28', actual_started_at: T0 + 1 }),
    ]);
    expect(groups.map((g) => [g.date, g.works.map((w) => w.work_id)])).toEqual([
      ['2026-10-29', ['b']],
      ['2026-10-28', ['a1', 'a2']],
    ]);
    expect(formatDate('2026-10-29')).toBe('10월 29일 (목)');
    expect(formatDate('엉터리')).toBe('엉터리');
  });

  it('작업 시간대를 24시간제 "09:00–12:05" 로 보인다', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 29, h, m).getTime();
    expect(timeRange(at(9, 0), at(12, 5))).toBe('09:00–12:05');
    expect(timeRange(at(0, 0), at(23, 59))).toBe('00:00–23:59');
    // 목록의 시간대는 실제 시작~종료이고, 끝나지 않았으면 진행 중이다. 시작 기록이 없으면 계획 시간대다.
    const planned = { from_ms: at(9, 0), to_ms: at(12, 0) };
    expect(workTimeRange(work(planned))).toBe('09:00–12:00');
    const running = work({ ...planned, actual_started_at: at(9, 2) });
    expect(workTimeRange(running)).toBe('09:02–진행 중');
    expect(workTimeRange({ ...running, actual_ended_at: at(11, 48) })).toBe('09:02–11:48');
  });
});

describe('기록 간격(chooseStep)·보이는 시간(holdFor)', () => {
  it('전체가 3000 칸 안이 되게 100ms 단위로 올린다', () => {
    expect(chooseStep(T0, T0)).toBe(100);
    expect(chooseStep(T0, T0 + 60_000)).toBe(100);
    // 2999 칸 × 100ms = 299.9초까지는 100ms, 1ms 넘으면 200ms.
    expect(chooseStep(T0, T0 + 299_900)).toBe(100);
    expect(chooseStep(T0, T0 + 299_901)).toBe(200);
    expect(chooseStep(T0, T0 + 3_600_000)).toBe(1_300);
    expect(chooseStep(T0, T0 + 90 * 60_000)).toBe(1_900);
    expect(chooseStep(T0, T0 + 3 * 3_600_000)).toBe(3_700);
  });

  it('최소 100ms, 최대 60초로 막는다(끝이 시작보다 이르면 최소)', () => {
    expect(chooseStep(T0 + 1_000, T0)).toBe(100);
    expect(chooseStep(T0, T0 + 2_999 * 60_000)).toBe(60_000);
    expect(chooseStep(T0, T0 + 30 * 86_400_000)).toBe(60_000);
  });

  it('최대로 막히지 않은 구간은 칸 수가 3000 을 넘지 않고, step 은 100 의 배수다', () => {
    for (const span of [1, 999, 60_000, 299_900, 299_901, 1_234_567, 5_400_000, 10_800_000, 8e7]) {
      const step = chooseStep(T0, T0 + span);
      expect(step % 100).toBe(0);
      expect(Math.floor(span / step) + 1).toBeLessThanOrEqual(REPLAY_MAX_FRAMES);
    }
  });

  it('기록 하나가 보이는 시간은 1초 이상이고, 간격이 넓으면 그 두 배다', () => {
    expect(holdFor(100)).toBe(1_000);
    expect(holdFor(500)).toBe(1_000);
    expect(holdFor(600)).toBe(1_200);
    expect(holdFor(1_900)).toBe(3_800);
    expect(holdFor(60_000)).toBe(120_000);
  });
});

describe('구간 기록 가져오기 오류 문구(replayErrorLine)', () => {
  it.each([
    ['네트워크', new ApiError(0, { kind: 'NETWORK' }), '서버에 연결하지 못했습니다.'],
    ['시간 초과', new ApiError(0, { kind: 'TIMEOUT' }), '서버에 연결하지 못했습니다.'],
    ['응답 형식', new ApiError(200, { kind: 'INVALID_RESPONSE' }), '기록을 읽지 못했습니다.'],
    ['401', new ApiError(401), '다시 로그인해 주세요.'],
    [
      '기록이 너무 많음',
      new ApiError(400, { code: 'REPLAY_RANGE_TOO_LARGE' }),
      '기록이 너무 많아 불러오지 못했습니다.',
    ],
    [
      '구간이 틀림',
      new ApiError(400, { code: 'INVALID_REPLAY_QUERY' }),
      '작업 구간이 올바르지 않습니다.',
    ],
    ['서버 오류', new ApiError(500), '기록을 불러오지 못했습니다.'],
    ['권한 없음(403)', new ApiError(403), '기록을 불러오지 못했습니다.'],
    ['모르는 코드', new ApiError(400, { code: 'SOMETHING' }), '기록을 불러오지 못했습니다.'],
    ['일반 오류', new Error('boom'), '기록을 불러오지 못했습니다.'],
    ['오류가 아닌 값', 'x', '기록을 불러오지 못했습니다.'],
    ['값 없음', undefined, '기록을 불러오지 못했습니다.'],
  ])('%s 는 한 줄로 알린다', (_name, error, line) => {
    expect(replayErrorLine(error)).toBe(line);
  });

  it('서버가 보낸 문구는 보이지 않는다', () => {
    const error = new ApiError(500, { serverMessage: 'SQL 내부 정보' });
    expect(replayErrorLine(error)).not.toContain('SQL');
  });
});

describe('재생 엔진에 넘길 기록(replayFiles)', () => {
  const worldEnvelope = (t: number): ReplayResponse['world_states'][number] => ({
    msg_type: 'world_state',
    msg_id: `w-${t}`,
    payload: { t_latest_global: t, tracks: [{ world_id: 'w-1' }] },
  });
  const eventEnvelope = (id: string, source = 'LIVE'): ReplayResponse['events'][number] => ({
    msg_type: 'risk_event',
    msg_id: `m-${id}`,
    payload: { event_id: id, source, severity: 'HIGH', lifecycle: 'RAISED' },
  });
  const responseOf = (overrides: Partial<ReplayResponse> = {}): ReplayResponse => ({
    from: T0,
    to: T0 + 1_000,
    step_ms: 500,
    world_states: [],
    initial_events: [],
    events: [],
    gaps: [],
    ...overrides,
  });
  const linesOf = (text: string) => text.split('\n').map((line) => JSON.parse(line));

  it('기록된 LIVE 이벤트를 재생(REPLAY) 출처로 바꾸고 원본은 둔다', () => {
    const raw = { msg_id: 'm', payload: { source: 'LIVE', event_id: 'e' } };
    expect(asReplayEvent(raw)).toEqual({
      msg_id: 'm',
      payload: { source: 'REPLAY', event_id: 'e' },
    });
    expect(raw.payload.source).toBe('LIVE');
  });

  it('서버가 기록 이벤트에 싣는 복원 표시(delivery)는 REPLAY 계약에 없어서 뺀다', () => {
    const raw = { msg_id: 'm', payload: { source: 'LIVE', event_id: 'e', delivery: 'AUDIT_ONLY' } };
    expect(asReplayEvent(raw)).toEqual({
      msg_id: 'm',
      payload: { source: 'REPLAY', event_id: 'e' },
    });
    expect(raw.payload.delivery).toBe('AUDIT_ONLY');
  });

  it('객체가 아니거나 payload 가 없으면 그대로 돌려준다', () => {
    expect(asReplayEvent('x')).toBe('x');
    expect(asReplayEvent(null)).toBeNull();
    expect(asReplayEvent(undefined)).toBeUndefined();
    const noPayload = { msg_id: 'm' };
    expect(asReplayEvent(noPayload)).toBe(noPayload);
    const badPayload = { msg_id: 'm', payload: 'x' };
    expect(asReplayEvent(badPayload)).toBe(badPayload);
  });

  it('이름 붙은 두 묶음(world_state·risk_event)으로 보내고, World 는 한 줄에 하나씩 그대로 둔다', () => {
    const worlds = [worldEnvelope(T0), worldEnvelope(T0 + 500)];
    const files = replayFiles(responseOf({ world_states: worlds }));
    expect(files.map((f) => f.name)).toEqual(['world_state', 'risk_event']);
    expect(linesOf(files[0]!.text)).toEqual(worlds);
    expect(files[1]!.text).toBe('');
  });

  it('시작 시각에 활성이던 이벤트(initial_events)를 앞에 두고 전이(events)를 잇는다. 둘 다 REPLAY 로 바꾼다', () => {
    const response = responseOf({
      initial_events: [eventEnvelope('a')],
      events: [eventEnvelope('b'), eventEnvelope('c')],
    });
    const before = structuredClone(response);
    const files = replayFiles(response);

    const lines = linesOf(files[1]!.text);
    expect(lines.map((line) => line.payload.event_id)).toEqual(['a', 'b', 'c']);
    expect(lines.map((line) => line.payload.source)).toEqual(['REPLAY', 'REPLAY', 'REPLAY']);
    // 다른 칸은 그대로다.
    expect(lines[0]).toEqual({
      ...before.initial_events[0],
      payload: { ...before.initial_events[0]!.payload, source: 'REPLAY' },
    });
    // 받은 응답은 고치지 않는다(LIVE 로 남는다).
    expect(response).toEqual(before);
    expect(response.initial_events[0]!.payload['source']).toBe('LIVE');
    expect(response.events[1]!.payload['source']).toBe('LIVE');
  });

  it('이미 REPLAY 인 이벤트는 그대로 REPLAY 다', () => {
    const files = replayFiles(responseOf({ events: [eventEnvelope('a', 'REPLAY')] }));
    expect(linesOf(files[1]!.text)[0].payload.source).toBe('REPLAY');
  });
});

describe('재생 시각 범위(fitLog)', () => {
  it('처음·끝을 작업 구간으로 넓히고 기록은 그대로 둔다', () => {
    const log = {
      files: ['world_state'],
      worlds: [world(T0 + 2_000, ['w-1'])],
      events: [],
      start: T0 + 2_000,
      end: T0 + 3_000,
      issues: [],
      lines: 1,
    } as unknown as ReplayLog;
    const fitted = fitLog(log, { from: T0, to: T0 + 30_000 });

    expect([fitted.start, fitted.end]).toEqual([T0, T0 + 30_000]);
    expect(fitted.worlds).toBe(log.worlds);
    expect(fitted.events).toBe(log.events);
    expect(fitted.lines).toBe(1);
    // 원본은 그대로다.
    expect([log.start, log.end]).toEqual([T0 + 2_000, T0 + 3_000]);
    expect(fitted).not.toBe(log);
  });

  it('쓸 줄이 없어 처음·끝이 없던 기록도 작업 구간을 갖는다', () => {
    const log = { worlds: [], events: [], start: null, end: null } as unknown as ReplayLog;
    const fitted = fitLog(log, { from: T0, to: T0 + 1 });
    expect([fitted.start, fitted.end]).toEqual([T0, T0 + 1]);
  });
});

describe('화면 목록(indexReplay)', () => {
  it('작업자·이벤트 행을 만들고, 서버가 준 기록 없는 구간은 그대로 넘긴다', () => {
    const log = logOf(
      [world(T0 + 2_000, ['w-1']), world(T0 + 3_000, ['w-1', 'w-2']), world(T0 + 20_000, ['w-2'])],
      [
        event(T0 + 3_000, {
          event_id: 'e1',
          rule_id: 'R1',
          severity: 'HIGH',
          lifecycle: 'RAISED',
          world_ids: ['w-1'],
          zone_id: 'z-02',
          raised_at: T0 + 3_000,
        }),
        event(T0 + 9_000, {
          event_id: 'e1',
          rule_id: 'R1',
          severity: 'HIGH',
          lifecycle: 'RESOLVED',
          world_ids: ['w-1'],
          zone_id: 'z-02',
          raised_at: T0 + 3_000,
          resolved_at: T0 + 9_000,
        }),
        event(T0 + 1_000, { event_id: 'e0', severity: 'NOPE' }),
      ],
    );
    const gaps = [
      { from: T0, to: T0 + 2_000 },
      { from: T0 + 25_000, to: T0 + 30_000 },
    ];
    const index = indexReplay(log, gaps);

    expect(index.workers).toEqual([
      { worldId: 'w-1', firstSeen: T0 + 2_000, lastSeen: T0 + 3_000, events: 1 },
      { worldId: 'w-2', firstSeen: T0 + 3_000, lastSeen: T0 + 20_000, events: 0 },
    ]);
    expect(index.events).toEqual([
      {
        eventId: 'e1',
        ruleId: 'R1',
        severity: 'HIGH',
        worldIds: ['w-1'],
        zoneId: 'z-02',
        raisedAt: T0 + 3_000,
        resolvedAt: T0 + 9_000,
      },
    ]);
    // 우리가 간격으로 추정하지 않는다: 서버가 준 것만이고, 넘긴 배열과는 따로 둔다.
    expect(index.gaps).toEqual(gaps);
    expect(index.gaps).not.toBe(gaps);
    expect(index.frames.map((f) => f.t)).toEqual([T0 + 2_000, T0 + 3_000, T0 + 20_000]);

    expect([...visibleAt(index, T0 + 3_500, 1_500)]).toEqual(['w-1', 'w-2']);
    expect([...visibleAt(index, T0 + 10_000, 1_500)]).toEqual([]);
    expect([...visibleAt(index, T0 + 1_000, 1_500)]).toEqual([]);

    const e1 = index.events[0]!;
    expect([T0 + 2_999, T0 + 3_000, T0 + 8_999, T0 + 9_000].map((t) => isActiveAt(e1, t))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('기록 사이가 비어도 gaps 를 만들지 않는다(서버가 알려 줄 때만 있다)', () => {
    const log = logOf([world(T0 + 1_000, ['w-1']), world(T0 + 50_000, ['w-1'])]);
    expect(indexReplay(log, []).gaps).toEqual([]);
  });

  it('작업자는 world_id 순이고, 기록에 나온 사람의 이벤트만 센다', () => {
    const log = logOf(
      [world(T0 + 1_000, ['w-2', 'w-1']), world(T0 + 2_000, ['w-1'])],
      [
        event(T0 + 1_500, {
          event_id: 'a',
          severity: 'CRITICAL',
          lifecycle: 'RAISED',
          world_ids: ['w-1', 'w-2', 'w-9'],
        }),
        event(T0 + 1_800, {
          event_id: 'b',
          severity: 'INFO',
          lifecycle: 'RAISED',
          world_ids: ['w-1'],
        }),
      ],
    );
    const { workers } = indexReplay(log, []);
    expect(workers.map((w) => w.worldId)).toEqual(['w-1', 'w-2']);
    expect(workers.map((w) => w.events)).toEqual([2, 1]);
  });

  it('이벤트 행: 빠진 칸은 채우고, 같은 event_id 의 마지막 전이를 따르며, 발생 시각순으로 둔다', () => {
    const log = logOf(
      [],
      [
        // raised_at 없이 온 첫 전이: 그 전이 시각이 발생 시각이다. 다음 전이도 처음 발생 시각을 지킨다.
        event(T0 + 5_000, { event_id: 'late', severity: 'CAUTION', lifecycle: 'RAISED' }),
        event(T0 + 6_000, { event_id: 'late', severity: 'HIGH', lifecycle: 'UPDATED' }),
        // 해소 시각이 없으면 해소 전이 시각이다.
        event(T0 + 1_000, {
          event_id: 'early',
          severity: 'CRITICAL',
          lifecycle: 'RAISED',
          raised_at: T0 + 1_000,
          world_ids: ['w-1', 7, null],
        }),
        event(T0 + 2_000, {
          event_id: 'early',
          severity: 'CRITICAL',
          lifecycle: 'RESOLVED',
          raised_at: T0 + 1_000,
          world_ids: ['w-1'],
        }),
        // 해소됐다가 다시 열리면 지금은 해소 아님이다.
        event(T0 + 3_000, {
          event_id: 'reopened',
          severity: 'HIGH',
          lifecycle: 'RESOLVED',
          raised_at: T0 + 2_500,
          resolved_at: T0 + 3_000,
          rule_id: 'R1',
          zone_id: 'z-04',
        }),
        event(T0 + 4_000, {
          event_id: 'reopened',
          severity: 'HIGH',
          lifecycle: 'UPDATED',
          raised_at: T0 + 2_500,
          rule_id: 'R1',
          zone_id: 'z-04',
        }),
        // event_id 가 없거나 등급이 틀리면 뺀다.
        event(T0 + 7_000, { severity: 'HIGH' }),
        event(T0 + 8_000, { event_id: 'bad', severity: 'low' }),
      ],
    );
    const { events } = indexReplay(log, []);

    expect(events.map((e) => e.eventId)).toEqual(['early', 'reopened', 'late']);
    expect(events[0]).toEqual({
      eventId: 'early',
      ruleId: '—',
      severity: 'CRITICAL',
      worldIds: ['w-1'],
      zoneId: null,
      raisedAt: T0 + 1_000,
      resolvedAt: T0 + 2_000,
    });
    expect(events[1]).toMatchObject({
      ruleId: 'R1',
      zoneId: 'z-04',
      raisedAt: T0 + 2_500,
      resolvedAt: null,
    });
    expect(events[2]).toMatchObject({ severity: 'HIGH', raisedAt: T0 + 5_000, resolvedAt: null });
  });

  it('기록마다 위치가 있는 사람을 남기고, 그 시각 기록을 찾는다(빈 구간이면 없다)', () => {
    const text = JSON.stringify({
      payload: {
        tracks: [
          { world_id: 'w-1', position_xy: [1, 2], observation_state: 'OBSERVED' },
          { world_id: 'w-2', position_xy: null },
          { position_xy: [3, 4] },
        ],
      },
    });
    const index = indexReplay(logOf([{ t: T0 + 1_000, text }]), []);
    const frame = frameAt(index, T0 + 2_000, 1_500)!;
    expect(frame.ids).toEqual(['w-1', 'w-2']);
    expect(frame.tracks.map((track) => track.world_id)).toEqual(['w-1']);
    expect(frameAt(index, T0 + 1_000, 0)).toBe(frame);
    expect(frameAt(index, T0 + 3_000, 1_500)).toBeNull();
    expect(frameAt(index, T0 + 500, 1_500)).toBeNull();
  });

  it('사람이 없는 기록(tracks 가 없거나 비어 있음)도 기록이다', () => {
    const index = indexReplay(
      logOf([
        { t: T0, text: JSON.stringify({ payload: {} }) },
        { t: T0 + 1_000, text: JSON.stringify({ payload: { tracks: [] } }) },
      ]),
      [],
    );
    expect(index.frames.map((f) => f.ids)).toEqual([[], []]);
    expect(index.workers).toEqual([]);
    expect(frameAt(index, T0 + 500, 1_000)?.t).toBe(T0);
  });
});

describe('그 시각의 기록(frameAt·visibleAt)', () => {
  const index = indexReplay(
    logOf([world(T0 + 1_000, ['w-1']), world(T0 + 2_000, ['w-2']), world(T0 + 3_000, ['w-3'])]),
    [],
  );

  it('그 시각 이하의 마지막 기록을 고른다', () => {
    expect(frameAt(index, T0 + 2_500, 5_000)!.t).toBe(T0 + 2_000);
    expect(frameAt(index, T0 + 3_000, 5_000)!.t).toBe(T0 + 3_000);
    expect(frameAt(index, T0 + 99_000, 100_000)!.t).toBe(T0 + 3_000);
    expect([...visibleAt(index, T0 + 2_500, 5_000)]).toEqual(['w-2']);
  });

  it('유지 시간(holdMs)이 지난 기록은 그 시각의 것이 아니다. 딱 holdMs 만큼은 본다', () => {
    expect(frameAt(index, T0 + 3_000 + 1_000, 1_000)!.t).toBe(T0 + 3_000);
    expect(frameAt(index, T0 + 3_000 + 1_001, 1_000)).toBeNull();
    expect([...visibleAt(index, T0 + 3_000 + 1_001, 1_000)]).toEqual([]);
    // 첫 기록보다 이르면 없다.
    expect(frameAt(index, T0 + 999, 1_000_000)).toBeNull();
  });

  it('기록이 하나도 없으면 없다', () => {
    const empty = indexReplay(logOf([]), []);
    expect(frameAt(empty, T0, 1_000)).toBeNull();
    expect([...visibleAt(empty, T0, 1_000)]).toEqual([]);
  });
});

describe('데이터 없음(inGap·noDataAt·allGap)', () => {
  const gaps = [{ from: T0 + 10_000, to: T0 + 20_000 }];
  const index = indexReplay(logOf([world(T0 + 9_000, ['w-1']), world(T0 + 21_000, ['w-1'])]), gaps);
  const HOLD = 1_500;

  it('기록 없는 구간은 양 끝을 포함한다', () => {
    expect(
      [T0 + 9_999, T0 + 10_000, T0 + 15_000, T0 + 20_000, T0 + 20_001].map((t) => inGap(gaps, t)),
    ).toEqual([false, true, true, true, false]);
    expect(inGap([], T0)).toBe(false);
  });

  it('보이는 기록이 없고 서버가 기록 없는 구간이라 한 시각만 "데이터 없음"이다', () => {
    // 구간 안이어도 유지 시간 안의 기록이 있으면 그 기록이 보인다.
    expect(noDataAt(index, T0 + 10_000, HOLD)).toBe(false);
    expect(noDataAt(index, T0 + 10_500, HOLD)).toBe(false);
    // 유지 시간이 지났으면 데이터 없음.
    expect(noDataAt(index, T0 + 10_501, HOLD)).toBe(true);
    expect(noDataAt(index, T0 + 15_000, HOLD)).toBe(true);
    expect(noDataAt(index, T0 + 20_000, HOLD)).toBe(true);
  });

  it('기록이 없어도 기록 없는 구간 밖이면 그 시각에 아무도 없던 것이다(데이터 없음이 아니다)', () => {
    expect(frameAt(index, T0 + 20_500, HOLD)).toBeNull();
    expect(noDataAt(index, T0 + 20_500, HOLD)).toBe(false);
    expect(noDataAt(index, T0 + 5_000, HOLD)).toBe(false);
    // 기록이 있는 시각은 아니다.
    expect(noDataAt(index, T0 + 21_000, HOLD)).toBe(false);
    expect(noDataAt(index, T0 + 9_500, HOLD)).toBe(false);
  });

  it('기록 없는 구간 정보가 없으면 어디서도 데이터 없음이 아니다', () => {
    const none = indexReplay(logOf([world(T0 + 1_000, ['w-1'])]), []);
    expect(noDataAt(none, T0 + 60_000, HOLD)).toBe(false);
  });

  it('작업 구간 전체가 기록 없는 구간인지 본다', () => {
    const range = { from: T0, to: T0 + 60_000 };
    expect(allGap([{ from: T0, to: T0 + 60_000 }], range)).toBe(true);
    expect(allGap([{ from: T0 - 1_000, to: T0 + 70_000 }], range)).toBe(true);
    expect(allGap([{ from: T0 + 1, to: T0 + 60_000 }], range)).toBe(false);
    expect(allGap([{ from: T0, to: T0 + 59_999 }], range)).toBe(false);
    expect(allGap([{ from: T0 + 10_000, to: T0 + 20_000 }], range)).toBe(false);
    expect(allGap([], range)).toBe(false);
  });
});

describe('아직 받지 못한 뒷구간(pending·inPending)', () => {
  const log = logOf([world(T0 + 1_000, ['w-1'])]);

  it('색인에 받지 못한 구간을 싣고, 안 주면 다 받은 것(null)이다', () => {
    const pending = { from: T0 + 60_000, to: T0 + 120_000 };
    expect(indexReplay(log, [], pending).pending).toEqual(pending);
    expect(indexReplay(log, []).pending).toBeNull();
  });

  it('받은 구간의 끝 tick 은 받은 쪽이고, 그 뒤 시각부터 모른다', () => {
    const index = indexReplay(log, [], { from: T0 + 60_000, to: T0 + 120_000 });
    expect(inPending(index, T0)).toBe(false);
    expect(inPending(index, T0 + 60_000)).toBe(false);
    expect(inPending(index, T0 + 60_001)).toBe(true);
    expect(inPending(index, T0 + 120_000)).toBe(true);
  });

  it('다 받았으면 어느 시각도 모르는 구간이 아니다', () => {
    expect(inPending(indexReplay(log, []), T0 + 999_999)).toBe(false);
  });

  it('받지 못한 구간은 데이터 없음이 아니다(서버가 준 gaps 만 데이터 없음이다)', () => {
    const index = indexReplay(log, [], { from: T0 + 60_000, to: T0 + 120_000 });
    expect(noDataAt(index, T0 + 90_000, 1_000)).toBe(false);
  });
});

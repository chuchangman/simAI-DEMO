import { TBM_TASKS, TBM_ZONES } from '@/features/tbm/tbmDemo';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { EVENT_CYCLE_MS, riskEventsBetween, worldStateAt } from '@/mocks/realtimeScenario';
import { http, HttpResponse } from 'msw/http';

// 히스토리(작업 다시 보기) mock.
// - 작업 목록(GET /api/work-units)은 서버의 실제 응답 모양(docs/design/server-work-units.md)이다: { works: [...] }.
// - 구간 기록(GET /api/replay)은 서버의 실제 응답 모양(docs/design/server-replay.md)이다: 봉투의 world_states·initial_events·
//   events(출처 LIVE)·gaps 와 한도(1시간·3000 칸·400 코드)가 같다. 실시간 mock 장면(worldStateAt·riskEventsBetween)을 합성한다.

/** 하루(ms). */
const DAY_MS = 86_400_000;
/** 목록에 넣는 날 수(오늘 포함). */
const DAYS = 3;
/** 이벤트는 이 바퀴(40초)마다 한 번만 넣는다. 30분에 한 번꼴이다. */
const EVENT_EVERY_CYCLES = 45;

// 기록이 비는 두 곳. 작업 구간의 앞에서부터의 비율로 잡는다.
/** 기록이 끊기는 지점(구간의 40%). Tier 0 health 가 끊겨 gaps 에 든다("데이터 없음"). */
const OUTAGE_AT = 0.4;
/** 끊겨 있는 시간(ms). */
const OUTAGE_MS = 2 * 60_000;
/** 사람이 없는 지점(구간의 20%). 기록(world 행)은 없지만 Tier 0 는 돌고 있어 gaps 에 들지 않는다. */
const EMPTY_ROOM_AT = 0.2;
/** 사람이 없던 시간(ms). */
const EMPTY_ROOM_MS = 60_000;

// 서버 한도(ReplayController). 서버 역할이라 클라이언트 상수(features/history/constants.ts)와 일부러 따로 둔다.
// 넘으면 400 REPLAY_RANGE_TOO_LARGE, 값이 틀리면 400 INVALID_REPLAY_QUERY 다.
const MIN_STEP_MS = 100;
const MAX_STEP_MS = 60_000;
const MAX_RANGE_MS = 3_600_000;
const MAX_FRAMES = 3_000;
const MAX_TRANSITIONS = 5_000;
const CODE_TOO_LARGE = 'REPLAY_RANGE_TOO_LARGE';
const CODE_INVALID_QUERY = 'INVALID_REPLAY_QUERY';

/** worldStateAt(t) 은 t_latest_global 을 t − 120ms(처리 지연)로 만든다. tick 시각에 맞추려고 그만큼 더해 부른다. */
const WORLD_LATENCY_MS = 120;
/** msg_id 의 앞부분(UUID 마지막 12자리 앞). 같은 시각이면 같은 msg_id 가 되게 시각을 뒤에 붙인다. */
const WORLD_MSG_ID_PREFIX = '0192a6f0-7c1e-4b3a-9f2d-';
const EVENT_MSG_ID_PREFIX = '0192a6f0-7c1e-4b3a-9a2d-';

/** 숫자를 UUID 마지막 칸(16진수 12자리)으로. */
const hex12 = (n: number) => (n % 16 ** 12).toString(16).padStart(12, '0');

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const at = (day: number, hhmm: string) => {
  const d = new Date(day);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
};

/** 표본 이벤트만 남긴다(EVENT_EVERY_CYCLES 바퀴마다 한 번). */
const sampledEvents = (from: number, to: number) =>
  riskEventsBetween(from, to).filter(
    (e) => Math.floor((e.payload.raised_at ?? 0) / EVENT_CYCLE_MS) % EVENT_EVERY_CYCLES === 0,
  );

export interface HistoryMockWork {
  work_id: string;
  date: string;
  name: string;
  from_ms: number;
  to_ms: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE';
  /** 실제 시작·종료(서버 work_unit.actual_*). 시작 전이면 둘 다 null, 진행 중이면 종료만 null 이다. */
  actual_started_at: number | null;
  actual_ended_at: number | null;
  zone_id: string | null;
  place: string | null;
  planned_people: number;
  /** 기록이 하나도 없는 작업은 모른다(null). */
  event_counts: { CRITICAL: number; HIGH: number } | null;
}

/** 기록이 하나도 없는 작업(이벤트 수를 모른다). */
export const hasNoRecord = (work: HistoryMockWork) => work.event_counts === null;

/** 구간에 발생(RAISED)한 이벤트를 등급별로 센다. */
function countEvents(from: number, to: number): { CRITICAL: number; HIGH: number } {
  const raised = sampledEvents(from, to).filter((e) => e.payload.lifecycle === 'RAISED');
  return {
    CRITICAL: raised.filter((e) => e.payload.severity === 'CRITICAL').length,
    HIGH: raised.filter((e) => e.payload.severity === 'HIGH').length,
  };
}

/** 날짜 하나의 TBM 데모 작업. 계획 시각이 지났으면 시작했고 계획 종료가 지났으면 끝난 것으로 한다(실제 = 계획). */
function scenarioWorks(day: number, now: number, lastHasNoRecord: boolean): HistoryMockWork[] {
  return TBM_TASKS.map((task, i) => {
    const from = at(day, task.from);
    const to = at(day, task.to);
    const started = from <= now;
    const ended = to <= now;
    const noRecord = lastHasNoRecord && i === TBM_TASKS.length - 1;
    return {
      work_id: `${dateOf(day)}-${task.id}`,
      date: dateOf(day),
      name: task.name,
      from_ms: from,
      to_ms: to,
      status: ended ? 'DONE' : started ? 'IN_PROGRESS' : 'PLANNED',
      actual_started_at: started ? from : null,
      actual_ended_at: ended ? to : null,
      zone_id: task.zone,
      place: TBM_ZONES.find((z) => z.id === task.zone)?.name ?? task.area ?? null,
      planned_people: task.people,
      event_counts: noRecord ? null : countEvents(from, Math.min(to, now)),
    };
  });
}

const msOrNull = (value: string | number | null | undefined) =>
  typeof value === 'number' ? value : null;

/** TBM 목(/api/work-units)의 작업을 히스토리 응답 모양으로. 시작·종료는 그 목이 기록한 값이다. */
function liveWork(work: TbmWorkUnit, now: number): HistoryMockWork {
  const started = msOrNull(work.actual_started_at);
  const ended = msOrNull(work.actual_ended_at);
  return {
    work_id: work.work_id,
    date: work.date,
    name: work.name,
    from_ms: work.from_ms,
    to_ms: work.to_ms,
    status: work.status ?? 'PLANNED',
    actual_started_at: started,
    actual_ended_at: ended,
    zone_id: work.zone_id,
    place: work.place ?? null,
    planned_people: work.planned_people,
    event_counts:
      started === null
        ? countEvents(work.from_ms, Math.min(work.to_ms, now))
        : countEvents(started, Math.min(ended ?? now, now)),
  };
}

/**
 * 최근 DAYS 일의 TBM 작업(서버처럼 아직 시작하지 않은 작업도 준다). 어제 이전은 모두 끝난 작업이고, 가장 오래된 날의
 * 마지막 작업은 기록이 없다(다른 작업과 겹치지 않는다). 오늘 작업은 live(TBM 목의 지금 작업)가 있으면 그것이고,
 * 없으면 계획 시각을 따르는 데모 작업이다.
 */
export function historyWorks(now: number, live?: readonly TbmWorkUnit[]): HistoryMockWork[] {
  const today = live ? live.map((work) => liveWork(work, now)) : scenarioWorks(now, now, false);
  const past = Array.from({ length: DAYS - 1 }, (_, i) =>
    scenarioWorks(now - (i + 1) * DAY_MS, now, i === DAYS - 2),
  );
  return [...today, ...past.flat()];
}

/** 작업의 실제 구간(시작 전이면 계획 구간). 진행 중이면 끝이 null 이다(지금까지). */
const spanOf = (work: HistoryMockWork) =>
  work.actual_started_at === null
    ? { from: work.from_ms, to: work.to_ms }
    : { from: work.actual_started_at, to: work.actual_ended_at };

/** 어느 작업의 구간인가(창이 들어 있는 첫 작업. 겹치는 작업은 먼저 나온 쪽). 없으면 요청 구간 자체를 한 작업으로 본다. */
const workOf = (works: readonly HistoryMockWork[], from: number, to: number) =>
  works.find((w) => {
    const span = spanOf(w);
    return span.from <= from && (span.to === null || to <= span.to);
  });

/** 같은 시각이면 같은 msg_id 다(서버가 저장된 원래 msg_id 를 주므로 같은 구간을 다시 읽어도 같다). */
const stableWorld = (ot: number) => {
  const message = worldStateAt(ot + WORLD_LATENCY_MS);
  return { ...message, msg_id: `${WORLD_MSG_ID_PREFIX}${hex12(ot)}` };
};
// 서버는 기록 이벤트(LIVE)에 재시작 복원 표시 delivery 를 싣는다(S15P31A101-355). 복원된 것이 없는 기록은 REALTIME 이다.
// 지금 Tier 0 가 들고 있는지(held_by_tier0)는 실시간 표시용이라 기록에는 싣지 않는다(S15P31A101-595, 서버 ReplayRepository 와 같다).
const stableEvent = (message: ReturnType<typeof riskEventsBetween>[number]) => {
  const payload = { ...message.payload, delivery: 'REALTIME' as const };
  delete payload.held_by_tier0;
  return {
    ...message,
    msg_id: `${EVENT_MSG_ID_PREFIX}${hex12(message.payload.updated_at ?? 0)}`,
    payload,
  };
};

/** from 시각에 활성인 이벤트의 그 시각 상태(마지막 전이가 해소가 아닌 것). */
function activeEventsAt(from: number) {
  const last = new Map<string, ReturnType<typeof stableEvent>>();
  for (const message of sampledEvents(from - EVENT_CYCLE_MS, from))
    last.set(message.payload.event_id, stableEvent(message));
  return [...last.values()].filter((m) => m.payload.lifecycle !== 'RESOLVED');
}

/** 작업 구간에서 기록이 비는 두 곳의 시작 시각. */
function quietStarts(base: { from_ms: number; to_ms: number }) {
  const span = base.to_ms - base.from_ms;
  return {
    outageFrom: base.from_ms + Math.floor(span * OUTAGE_AT),
    emptyFrom: base.from_ms + Math.floor(span * EMPTY_ROOM_AT),
  };
}

type Quiet = ReturnType<typeof quietStarts>;

/** [from, until] 의 world tick. tick 은 step 의 배수 시각이다(같은 step 이면 창이 달라도 같은 tick 이라 경계에서 겹쳐도 같은 메시지다). */
function worldStatesBetween(from: number, until: number, step: number, quiet: Quiet) {
  const worldStates = [];
  for (let ot = Math.ceil(from / step) * step; ot <= until; ot += step) {
    if (ot >= quiet.outageFrom && ot < quiet.outageFrom + OUTAGE_MS) continue;
    if (ot >= quiet.emptyFrom && ot < quiet.emptyFrom + EMPTY_ROOM_MS) continue;
    worldStates.push(stableWorld(ot));
  }
  return worldStates;
}

/** 서버가 알리는 기록 없는 구간: 끊긴 곳과 아직 오지 않은 시각(now 뒤). 기록이 없는 작업은 구간 전체다. */
function gapsBetween(from: number, to: number, now: number, quiet: Quiet, empty: boolean) {
  if (empty) return [{ from, to }];
  const gaps: { from: number; to: number }[] = [];
  const outage = {
    from: Math.max(from, quiet.outageFrom),
    to: Math.min(to, quiet.outageFrom + OUTAGE_MS),
  };
  if (outage.from < outage.to) gaps.push(outage);
  if (now < to) gaps.push({ from: Math.max(from, now), to });
  return gaps;
}

/**
 * 구간 기록(GET /api/replay 의 본문). 작업 구간 40% 쯤 OUTAGE_MS 는 기록이 없고(gaps), 20% 쯤 EMPTY_ROOM_MS 는 사람이 없어
 * world 행이 없다(gaps 아님). 아직 오지 않은 시각(now 뒤)도 gaps 다. 기록이 없는 작업은 구간 전체가 gaps 다.
 */
export function historyReplay(
  works: readonly HistoryMockWork[],
  from: number,
  to: number,
  step: number,
  now: number,
) {
  const work = workOf(works, from, to);
  const empty = work !== undefined && hasNoRecord(work);
  const span = work && spanOf(work);
  const quiet = quietStarts(
    work && span
      ? { from_ms: span.from, to_ms: span.to ?? work.to_ms }
      : { from_ms: from, to_ms: to },
  );
  const until = Math.min(to, now);
  return {
    from,
    to,
    step_ms: step,
    world_states: empty ? [] : worldStatesBetween(from, until, step, quiet),
    initial_events: empty || from > now ? [] : activeEventsAt(from),
    events: empty || until <= from ? [] : sampledEvents(from, until).map(stableEvent),
    gaps: gapsBetween(from, to, now, quiet, empty),
  };
}

/** 쿼리의 정수 값. 없거나 정수가 아니면 NaN. */
const intParam = (url: URL, key: string) => {
  const value = url.searchParams.get(key);
  return value !== null && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
};

/** GET /api/replay 의 from·to·step_ms. step_ms 를 생략하면 최소 간격이다. 값이 틀리면 null. */
function readReplayQuery(url: URL) {
  const from = intParam(url, 'from');
  const to = intParam(url, 'to');
  const stepParam = url.searchParams.get('step_ms');
  const step =
    stepParam === null || stepParam.trim() === '' ? MIN_STEP_MS : intParam(url, 'step_ms');
  const valid = from >= 0 && to >= 0 && from < to && step >= MIN_STEP_MS && step <= MAX_STEP_MS;
  return valid ? { from, to, step } : null;
}

/**
 * 작업 목록(GET /api/work-units?days=)과 구간 기록(GET /api/replay). 로그인만 하면 볼 수 있다(열람).
 * liveWorks 를 주면 오늘 작업은 그 목(TBM 목)의 지금 작업이라, 거기서 시작·종료한 것이 목록에 따라온다.
 */
export function createHistoryMock({
  now = Date.now,
  liveWorks,
}: { now?: () => number; liveWorks?: () => readonly TbmWorkUnit[] } = {}) {
  const deny = (request: Request) => (readLiveUser(request, now()) ? undefined : unauthorized());
  const tooLarge = () => problem(400, CODE_TOO_LARGE, '한 번에 받을 수 있는 기록보다 많습니다');

  const handlers = [
    http.get('*/api/work-units', ({ request }) => {
      const denied = deny(request);
      if (denied) return denied;
      return HttpResponse.json({ works: historyWorks(now(), liveWorks?.()) });
    }),
    http.get('*/api/replay', ({ request }) => {
      const denied = deny(request);
      if (denied) return denied;
      const query = readReplayQuery(new URL(request.url));
      if (!query) return problem(400, CODE_INVALID_QUERY, '구간이 올바르지 않습니다');
      const { from, to, step } = query;
      if (to - from > MAX_RANGE_MS || Math.floor((to - from) / step) + 1 > MAX_FRAMES)
        return tooLarge();
      const t = now();
      const body = historyReplay(historyWorks(t, liveWorks?.()), from, to, step, t);
      if (body.events.length > MAX_TRANSITIONS || body.world_states.length > MAX_FRAMES)
        return tooLarge();
      return HttpResponse.json(body);
    }),
  ];
  return { handlers };
}

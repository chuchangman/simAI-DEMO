import {
  HISTORY_DAYS,
  REPLAY_CONCURRENCY,
  REPLAY_INVALID_QUERY_CODE,
  REPLAY_MAX_FRAMES,
  REPLAY_MAX_RANGE_MS,
  REPLAY_MIN_STEP_MS,
  REPLAY_TOO_LARGE_CODE,
} from '@/features/history/constants';
import {
  replayResponseSchema,
  videoSegmentsSchema,
  videoUrlSchema,
  workUnitsResponseSchema,
  type EventEnvelope,
  type ReplayGap,
  type ReplayResponse,
  type Span,
  type WorldEnvelope,
} from '@/features/history/types';
import { ApiError, type Http } from '@/lib/http';

// 히스토리 조회. http 를 인자로 받는다(테스트가 env 없이 createHttp 로 부를 수 있게 한다).

/** 구간이 키에 들어 있어, 진행 중이던 작업이 끝나 구간이 바뀌면 다시 받는다. */
export const replayKey = (workId: string, range: Span) =>
  ['history', 'replay', workId, range.from, range.to] as const;

/** 최근 작업(새 날짜부터). */
export function requestWorks(http: Http, signal?: AbortSignal) {
  return http(`/api/work-units?days=${HISTORY_DAYS}`, { schema: workUnitsResponseSchema, signal });
}

// ── GET /api/replay ───────────────────────────────────────────────────────────

export interface ReplayRange extends Span {
  stepMs: number;
}

/** 창 하나의 최대 길이(ms). 칸 수 span / step + 1 ≤ 3000 이려면 span ≤ 2999 × step 이고, 1시간도 넘지 못한다. */
const maxWindowSpan = (stepMs: number) =>
  Math.min(REPLAY_MAX_RANGE_MS, (REPLAY_MAX_FRAMES - 1) * stepMs);

/**
 * 구간을 서버 한도 안의 창으로 나눈다. 창은 같은 길이이고(마지막이 아주 짧아지지 않게) 앞 창의 끝이 다음 창의 시작이다.
 * 경계 시각의 tick 은 두 창에 모두 들어 있어 합칠 때 하나로 센다(mergeReplay).
 */
export function planWindows(range: ReplayRange): Span[] {
  const { from, to, stepMs } = range;
  const span = to - from;
  if (!(span > 0)) return [];
  const count = Math.ceil(span / maxWindowSpan(stepMs));
  const length = Math.ceil(span / count);
  return Array.from({ length: count }, (_, i) => ({
    from: from + i * length,
    to: Math.min(to, from + (i + 1) * length),
  }));
}

/** 요청 하나. */
export function requestReplayWindow(
  http: Http,
  range: ReplayRange,
  signal?: AbortSignal,
): Promise<ReplayResponse> {
  const query = new URLSearchParams({
    from: String(range.from),
    to: String(range.to),
    step_ms: String(range.stepMs),
  });
  return http(`/api/replay?${query}`, { schema: replayResponseSchema, signal });
}

/** 이어지거나 겹치는 구간을 하나로 합친다. */
export function mergeGaps(gaps: readonly ReplayGap[]): ReplayGap[] {
  const sorted = [...gaps].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: ReplayGap[] = [];
  for (const gap of sorted) {
    const last = out.at(-1);
    if (last && gap.from <= last.to) last.to = Math.max(last.to, gap.to);
    else out.push({ ...gap });
  }
  return out;
}

/** 목록들을 이어 붙이되 같은 msg_id 는 처음 것만 둔다. */
function uniqueByMsgId<Item extends WorldEnvelope | EventEnvelope>(
  lists: readonly (readonly Item[])[],
): Item[] {
  const seen = new Set<string>();
  return lists.flat().filter((item) => {
    if (seen.has(item.msg_id)) return false;
    seen.add(item.msg_id);
    return true;
  });
}

/**
 * 시간순 창 응답을 하나로 합친다.
 * - world_states·events: 창 경계의 같은 메시지(msg_id)는 한 번만 둔다.
 * - initial_events: 첫 창의 것만 쓴다. 다음 창의 것은 앞 창 전이로 이미 이어진 상태다.
 * - gaps: 창 경계에서 이어지는 구간은 하나로 합친다.
 */
export function mergeReplay(windows: readonly ReplayResponse[]): ReplayResponse {
  const first = windows[0];
  if (!first) throw new Error('합칠 응답이 없다');
  return {
    from: first.from,
    to: windows.at(-1)!.to,
    step_ms: Math.max(...windows.map((w) => w.step_ms)),
    world_states: uniqueByMsgId(windows.map((w) => w.world_states)),
    initial_events: first.initial_events,
    events: uniqueByMsgId(windows.map((w) => w.events)),
    gaps: mergeGaps(windows.flatMap((w) => w.gaps)),
  };
}

const isTooLarge = (error: unknown) =>
  error instanceof ApiError && error.status === 400 && error.code === REPLAY_TOO_LARGE_CODE;

/** 구간을 반으로 가른다. 앞 절반의 끝이 뒤 절반의 시작이다. */
function halve(range: ReplayRange): [ReplayRange, ReplayRange] {
  const mid = range.from + Math.floor((range.to - range.from) / 2);
  return [
    { ...range, to: mid },
    { ...range, from: mid },
  ];
}

/** 한 번 더 나눌 수 있는 길이인지(최소 간격 두 칸 이상). */
const canHalve = (range: ReplayRange) => range.to - range.from >= 2 * REPLAY_MIN_STEP_MS;

/**
 * 창 하나. 전이가 5000 개를 넘거나 tick 이 3000 개를 넘어 400 REPLAY_RANGE_TOO_LARGE 가 오면 창을 반으로 나눠 다시 받는다.
 * 더 나눌 수 없을 만큼 짧은데도 거부하면 그 오류를 그대로 던진다.
 */
async function fetchWindow(
  http: Http,
  range: ReplayRange,
  signal: AbortSignal | undefined,
): Promise<ReplayResponse> {
  try {
    return await requestReplayWindow(http, range, signal);
  } catch (error) {
    if (!isTooLarge(error) || !canHalve(range)) throw error;
    const [head, tail] = halve(range);
    const halves = await Promise.all([
      fetchWindow(http, head, signal),
      fetchWindow(http, tail, signal),
    ]);
    return mergeReplay(halves);
  }
}

/**
 * items 를 한 번에 limit 개씩 처리한다(결과는 items 순서). 하나라도 실패하면 나머지 요청을 멈추고 그 오류를 던진다.
 * run 에는 바깥 signal 과 이 멈춤을 합친 signal 을 넘긴다.
 */
async function mapWithLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  signal: AbortSignal | undefined,
  run: (item: Item, signal: AbortSignal, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  const stop = new AbortController();
  const shared = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!, shared, index);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  } catch (error) {
    stop.abort();
    throw error;
  }
  return results;
}

/** 창 하나를 받았을 때 알리는 함수. index 는 planWindows 가 나눈 창의 순서(0부터)다. */
export type OnReplayWindow = (index: number, response: ReplayResponse) => void;

/**
 * 구간 기록. 서버 한도(1시간·3000 칸)를 넘는 구간은 창으로 나눠 받아 하나로 합친다.
 * 한 창이라도 실패하면 전체가 실패한다(빠진 창을 "기록 없음"으로 보이지 않게).
 * 창은 시간순으로 시작하고 끝나는 대로 onWindow 로 알린다(앞 구간부터 먼저 보여 줄 수 있게). 합친 결과는 그대로 돌려준다.
 */
export async function requestReplay(
  http: Http,
  range: ReplayRange,
  signal?: AbortSignal,
  onWindow?: OnReplayWindow,
): Promise<ReplayResponse> {
  const windows = planWindows(range);
  if (windows.length === 0) throw new ApiError(400, { code: REPLAY_INVALID_QUERY_CODE });
  const responses = await mapWithLimit(
    windows,
    REPLAY_CONCURRENCY,
    signal,
    async (span, shared, index) => {
      const response = await fetchWindow(http, { ...range, ...span }, shared);
      onWindow?.(index, response);
      return response;
    },
  );
  // 요청한 구간 그대로 돌려준다(창이 나뉘어도 from·to 는 처음과 끝이다).
  return { ...mergeReplay(responses), from: range.from, to: range.to };
}

// ── GET /api/videos ───────────────────────────────────────────────────────────

/** 구간과 겹치는 상시 영상 조각(관리자). 모든 카메라의 조각이 카메라·시작 시각 순으로 온다. */
export function requestVideoSegments(http: Http, range: Span, signal?: AbortSignal) {
  return http(`/api/videos?from=${range.from}&to=${range.to}`, {
    schema: videoSegmentsSchema,
    signal,
  });
}

/** 조각 재생 주소. EC2 가 이 요청마다 조회 기록을 남긴다(명세 14장). 지운 조각은 410 SEGMENT_DELETED. */
export function requestVideoUrl(http: Http, segmentId: string, signal?: AbortSignal) {
  return http(`/api/videos/${encodeURIComponent(segmentId)}`, { schema: videoUrlSchema, signal });
}

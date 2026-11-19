import {
  HOLD_MIN_MS,
  HOLD_STEP_FACTOR,
  REPLAY_INVALID_QUERY_CODE,
  REPLAY_MAX_FRAMES,
  REPLAY_MAX_STEP_MS,
  REPLAY_MIN_STEP_MS,
  REPLAY_TOO_LARGE_CODE,
} from '@/features/history/constants';
import type { ReplayResponse, Span } from '@/features/history/types';
import type { ReplayFile, ReplayLog } from '@/features/viewer3d';
import { ApiError } from '@/lib/http';

// 작업 다시 보기의 순수 계산 중 서버 응답을 재생 엔진(viewer3d -187)에 넘기는 쪽: 기록 간격·유지 시간·JSONL 묶음.
// 화면 목록(작업자·이벤트·데이터 없음)은 replayIndex.ts 가 만든다.

/** 작업 구간에 맞는 World 기록 간격(ms). 전체가 3000 칸 안이 되게 100ms 단위로 올린다(서버 한 요청의 칸 수 상한). */
export function chooseStep(from: number, to: number): number {
  const span = Math.max(0, to - from);
  const step = Math.ceil(span / (REPLAY_MAX_FRAMES - 1) / REPLAY_MIN_STEP_MS) * REPLAY_MIN_STEP_MS;
  return Math.min(REPLAY_MAX_STEP_MS, Math.max(REPLAY_MIN_STEP_MS, step));
}

/**
 * World 기록 하나가 보이는 시간(ms). 이보다 오래된 기록은 그 시각의 것이 아니다("모르면 비운다", 서버 /api/world 의 1초 창과
 * 같다). 간격을 넓혔으면 그 간격의 두 배까지 잇는다. 이 안에 기록이 없을 때 서버가 준 gaps 안이면 "데이터 없음"이고,
 * 밖이면 그 시각에 아무도 없던 것이다.
 */
export const holdFor = (stepMs: number) => Math.max(HOLD_MIN_MS, stepMs * HOLD_STEP_FACTOR);

const GENERIC_ERROR_LINE = '기록을 불러오지 못했습니다.';

/**
 * 구간 기록을 못 받았을 때 한 줄. 401 은 세션이 끝나 로그인 화면으로 가므로(라우트 가드) 잠깐 보이는 안내다.
 * 서버 문구는 보이지 않는다(내부 정보가 섞일 수 있다).
 */
export function replayErrorLine(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR_LINE;
  if (error.kind === 'NETWORK' || error.kind === 'TIMEOUT') return '서버에 연결하지 못했습니다.';
  if (error.kind === 'INVALID_RESPONSE') return '기록을 읽지 못했습니다.';
  if (error.status === 401) return '다시 로그인해 주세요.';
  if (error.code === REPLAY_TOO_LARGE_CODE) return '기록이 너무 많아 불러오지 못했습니다.';
  if (error.code === REPLAY_INVALID_QUERY_CODE) return '작업 구간이 올바르지 않습니다.';
  return GENERIC_ERROR_LINE;
}

/** 서버가 기록 이벤트에 싣는 재시작 복원 표시. 계약은 이 칸을 LIVE 이벤트에만 둔다(risk_event, 7.4 출처 분리). */
const DELIVERY_KEY = 'delivery';

/**
 * 기록된 이벤트는 LIVE 출처다. 다시 보기는 재생(REPLAY) 출처로만 넣는다: 재생 엔진이 REPLAY 만 받고, 실제 알림
 * 경로(LIVE)와 섞이지 않는다(AGENTS 규칙 5). REPLAY 이벤트는 delivery 를 가질 수 없어서(계약 검사에서 걸린다)
 * 그 칸은 뺀다. 원본은 고치지 않는다.
 */
export function asReplayEvent(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const payload = Reflect.get(raw, 'payload');
  if (typeof payload !== 'object' || payload === null) return raw;
  const kept = Object.entries(payload).filter(([key]) => key !== DELIVERY_KEY);
  return { ...raw, payload: { ...Object.fromEntries(kept), source: 'REPLAY' } };
}

/**
 * 구간 기록을 재생 엔진이 읽는 JSONL 묶음으로 바꾼다. 시작 시각에 활성이던 이벤트(initial_events)를 앞에 두고 전이(events)를
 * 잇는다. 이벤트 출처는 REPLAY 로 바꾼다.
 */
export function replayFiles(response: ReplayResponse): ReplayFile[] {
  const lines = (items: readonly unknown[]) => items.map((item) => JSON.stringify(item)).join('\n');
  const events = [...response.initial_events, ...response.events];
  return [
    { name: 'world_state', text: lines(response.world_states) },
    { name: 'risk_event', text: lines(events.map(asReplayEvent)) },
  ];
}

/**
 * 재생 시각 범위를 작업 구간으로 맞춘다. 엔진은 기록의 처음·끝을 범위로 쓰는데, 작업 처음·끝에 사람이 없었거나 기록이 없던
 * 구간이 있어도 타임라인은 작업 구간 전체를 움직여야 한다. 기록(worlds·events)은 그대로 둔다.
 */
export const fitLog = (log: ReplayLog, range: Span): ReplayLog => ({
  ...log,
  start: range.from,
  end: range.to,
});

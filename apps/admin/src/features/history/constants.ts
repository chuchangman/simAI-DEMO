// 히스토리(작업 다시 보기)의 고정값. 값의 출처가 서버면 그 문서를 적는다.

/** 목록에 보일 날짜 수(오늘 포함). */
export const HISTORY_DAYS = 7;

// 서버가 한 번에 주는 양(docs/design/server-replay.md). 넘으면 잘라 주지 않고 400 REPLAY_RANGE_TOO_LARGE 다.
/** 구간 길이 상한(1시간). */
export const REPLAY_MAX_RANGE_MS = 3_600_000;
/** world_state 수 상한. 칸 수는 구간 / step_ms + 1 로 센다. */
export const REPLAY_MAX_FRAMES = 3_000;
/** step_ms 의 기본이자 최소(world_state 10 Hz). */
export const REPLAY_MIN_STEP_MS = 100;
/** step_ms 상한(1분). */
export const REPLAY_MAX_STEP_MS = 60_000;
/** 동시에 보내는 요청 수. */
export const REPLAY_CONCURRENCY = 3;

/** 구간이 한 번에 받을 양을 넘었다. */
export const REPLAY_TOO_LARGE_CODE = 'REPLAY_RANGE_TOO_LARGE';
/** from·to·step_ms 가 올바르지 않다. */
export const REPLAY_INVALID_QUERY_CODE = 'INVALID_REPLAY_QUERY';

/** World 기록 하나가 보이는 시간의 최소(ms). 서버 /api/world 의 1초 창과 같다. */
export const HOLD_MIN_MS = 1_000;
/** 간격을 넓혔으면 그 간격의 몇 배까지 기록을 잇는지. */
export const HOLD_STEP_FACTOR = 2;

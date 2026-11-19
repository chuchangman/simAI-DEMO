import { requestSetupSession } from '@/features/setup/api';
import type { SetupSessionResponse } from '@/features/setup/types';
import { fetchWorkUnits } from '@/features/work/api';
import type { WorkDayItem } from '@/features/work/types';
import { parseDateKey, toDateKey } from '@/features/work/workDay';
import { ApiError, type Http } from '@/lib/http';

// 멈춘 세팅 하나가 같은 현장의 새 세팅을 막을 때(409), 막는 세션을 작업 목록에서 찾아 취소할 수 있게 한다.
// 작업 시작은 그 작업의 세팅 완료만 본다(409 WORK_SETUP_NOT_COMPLETED, -642). 다른 세팅이 막는 일은 세팅 시작 때만 생긴다.
// 서버 409 본문에는 세션·작업 id 가 없다. 진행 중인 세션은 언제나 자기 작업의 active_setup_session_id 라서 그 값을 모아 세션을 조회한다.

export const BLOCKING_SETUP_KEY = ['setup', 'blocking-session'] as const;

/** 오늘부터 이만큼 전 날짜까지 작업을 훑는다(서버 작업 목록은 한 번에 92일까지 준다). */
export const BLOCKING_SETUP_LOOKBACK_DAYS = 90;

/** 현장의 새 세팅을 막는 오류 코드(SETUP_ALREADY_IN_PROGRESS). */
const BLOCKED_BY_SETUP_CODES: ReadonlySet<string> = new Set(['SETUP_ALREADY_IN_PROGRESS']);

/** 세팅 세션이 아직 끝나지 않았다(완료·실패가 아니다). 취소할 수 있고 현장의 새 세팅을 막는다. */
export function isSetupSessionRunning(session: SetupSessionResponse | null): boolean {
  return session !== null && session.status !== 'COMPLETED' && session.status !== 'FAILED';
}

/** 진행 중인 세팅 세션이 현장을 막아 거절된 오류인가. */
export function isBlockedBySetupSession(error: unknown): boolean {
  return (
    error instanceof ApiError && error.code !== undefined && BLOCKED_BY_SETUP_CODES.has(error.code)
  );
}

/** 현장을 막고 있는 세팅 세션과 그 작업의 날짜. */
export interface BlockingSetup {
  sessionId: string;
  /** 작업 날짜('YYYY-MM-DD'). */
  date: string;
}

/**
 * 진행 중인 세션 가운데 작업을 찾을 수 있는 것을 고른다. 서버는 현장에 진행 중인 세션을 하나만 허락하므로 보통 하나다.
 * 여럿이면 날짜가 늦은 쪽. 세션의 work_unit_id 는 숫자, 작업의 work_id 는 문자열이다.
 */
export function pickBlockingSetup(
  works: readonly WorkDayItem[],
  sessions: readonly SetupSessionResponse[],
): BlockingSetup | null {
  const dateOfWork = new Map(works.map((work) => [work.work_id, work.date]));
  const blocking = sessions.filter(isSetupSessionRunning).flatMap((session) => {
    const date = dateOfWork.get(String(session.work_unit_id));
    return date === undefined ? [] : [{ sessionId: session.setup_session_id, date }];
  });
  return blocking.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** 오늘 기준 최근 작업의 세션들을 조회해 현장을 막는 세션을 찾는다. 못 찾으면 null. */
export async function requestBlockingSetup(
  http: Http,
  today: Date,
  signal?: AbortSignal,
): Promise<BlockingSetup | null> {
  const from = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - BLOCKING_SETUP_LOOKBACK_DAYS,
  );
  const works = await fetchWorkUnits(http, { from: toDateKey(from), to: toDateKey(today) }, signal);
  const sessionIds = new Set(works.flatMap((work) => work.active_setup_session_id ?? []));
  const results = await Promise.allSettled(
    [...sessionIds].map((id) => requestSetupSession(http, id, signal)),
  );
  const sessions = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  return pickBlockingSetup(works, sessions);
}

/** 'YYYY-MM-DD' → 'M월 D일'. 잘못된 키면 받은 그대로. */
export function monthDayLabel(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return date ? `${date.getMonth() + 1}월 ${date.getDate()}일` : dateKey;
}

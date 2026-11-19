import { deriveWaitingView, WAITING_STAGES, type SetupWaitingView } from '@/features/setup/setup';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useEffect, useMemo, useState } from 'react';

// 시연 계정의 「새 맵 만들기」(features/demo/demoAccount). 서버에는 준비된 맵을 재사용으로 요청하고(워커 없이 바로 끝난다),
// 화면은 새 맵처럼 보정·생성 5단계를 DEMO_NEW_MAP_SECONDS 동안 채운 뒤 구역 단계로 넘어갈 수 있게 한다.
// 어느 세션을 그렇게 보일지는 이 브라우저가 시작한 시각과 함께 남겨 새로고침·다른 탭에서도 이어서 센다.

export const DEMO_NEW_MAP_SECONDS = 10;

const STORAGE_KEY = 'simai.demoNewMap';
/** 남겨 둘 세션 수(오래된 것부터 버린다). */
const KEEP_SESSIONS = 20;
/** 막대를 다시 그리는 간격(ms). */
const TICK_MS = 200;

type StartedAt = Record<string, number>;

function readStarts(): StartedAt {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as StartedAt) : {};
  } catch {
    return {};
  }
}

/** 지금 보낸 세팅 요청이 시연 계정의 새 맵인지(응답 세션을 claimDemoNewMap 이 남긴다). */
let demoRequestPending = false;

/** 세팅 요청을 보낼 때 시연 계정의 새 맵인지 적어 둔다. */
export function requestDemoNewMap(isDemoNewMap: boolean): void {
  demoRequestPending = isDemoNewMap;
}

/** 요청이 만든 세션을 받았다. 시연 계정의 새 맵 요청이었으면 그 세션을 남긴다. */
export function claimDemoNewMap(sessionId: string): void {
  if (demoRequestPending) markDemoNewMap(sessionId);
  demoRequestPending = false;
}

/** 시연 계정의 새 맵으로 시작한 세션을 남긴다. */
export function markDemoNewMap(sessionId: string, nowMs: number = Date.now()): void {
  const kept = Object.entries({ ...readStarts(), [sessionId]: nowMs })
    .sort(([, a], [, b]) => b - a)
    .slice(0, KEEP_SESSIONS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // 저장소를 못 쓰면 이 화면에서만 재사용 흐름(곧장 구역 단계)으로 보인다
  }
}

/** 시연 계정의 새 맵으로 시작한 세션이면 시작 시각(ms), 아니면 null. */
export function demoNewMapStartedAt(sessionId: string | null | undefined): number | null {
  if (!sessionId) return null;
  const startedAt = readStarts()[sessionId];
  return typeof startedAt === 'number' ? startedAt : null;
}

export function isDemoNewMap(sessionId: string | null | undefined): boolean {
  return demoNewMapStartedAt(sessionId) !== null;
}

/** 시작 뒤 지난 시간으로 만든 새 맵 진행 모양의 세션(진행률·단계·배경 수집). 다 차면 끝난 세션이다. */
export function pacedDemoSession(
  session: SetupSessionResponse,
  startedAtMs: number,
  nowMs: number,
): SetupSessionResponse {
  const ratio = Math.min(1, Math.max(0, (nowMs - startedAtMs) / (DEMO_NEW_MAP_SECONDS * 1000)));
  const pct = Math.floor(ratio * 100);
  const stage =
    pct >= 100
      ? 'COMPLETED'
      : (WAITING_STAGES.find((def) => pct < def.to) ?? WAITING_STAGES[WAITING_STAGES.length - 1]!)
          .stage;
  const backgroundPct = Math.min(100, (pct / WAITING_STAGES[0]!.to) * 100);
  return {
    ...session,
    mode: 'NEW',
    requested_mode: 'NEW',
    reuse_source: null,
    status: stage,
    stage,
    progress_pct: pct,
    started_at_ms: startedAtMs,
    updated_at_ms: nowMs,
    background_collection_pct: Object.fromEntries(
      Object.keys(session.camera_heights_m).map((cameraId) => [cameraId, backgroundPct]),
    ),
  };
}

/** 보정·생성 화면 모델. 서버 세션은 처음부터 구역 단계로 갈 수 있으므로 막대가 다 차면 '다음' 을 연다. */
export function pacedDemoWaitingView(
  session: SetupSessionResponse,
  startedAtMs: number,
  nowMs: number,
): SetupWaitingView {
  const view = deriveWaitingView(pacedDemoSession(session, startedAtMs, nowMs));
  return { ...view, mapComplete: view.progressPct >= 100 };
}

/** endMs 까지 TICK_MS 마다 바뀌는 지금 시각. endMs 가 없거나 지났으면 멈춘다. */
function useNowUntil(endMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endMs === null || Date.now() >= endMs + TICK_MS) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endMs) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [endMs]);
  return now;
}

/** 세팅 보정·생성 화면 모델. 시연 계정의 새 맵 세션이면 10초 진행으로 보인다. */
export function useSetupWaitingView(session: SetupSessionResponse | null): SetupWaitingView {
  const startedAt = demoNewMapStartedAt(session?.setup_session_id);
  const now = useNowUntil(startedAt === null ? null : startedAt + DEMO_NEW_MAP_SECONDS * 1000);
  return useMemo(
    () =>
      session && startedAt !== null && session.status !== 'FAILED'
        ? pacedDemoWaitingView(session, startedAt, now)
        : deriveWaitingView(session),
    [session, startedAt, now],
  );
}

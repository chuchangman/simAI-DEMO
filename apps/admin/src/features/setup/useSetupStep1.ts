import {
  COVERAGE_GUIDE_POLL_MS,
  createSetupSession,
  requestCameraHeightDefaults,
  requestCoverageGuides,
  requestSetupSession,
  requestSetupZoneDrafts,
  resumeSetupSession,
  retrySetupSession,
  SETUP_COVERAGE_GUIDES_KEY,
  SETUP_HEIGHT_DEFAULTS_KEY,
  SETUP_SESSION_POLL_MS,
  setupSessionKey,
  setupZoneDraftsKey,
  startCameraCheck,
} from '@/features/setup/api';
import { coverageFreshUntil, coverageHelperLost } from '@/features/setup/cameraBadge';
import { setActiveSetupSessionId } from '@/features/setup/setup.store';
import { setupErrorMessage } from '@/features/setup/setupErrorMessage';
import { rebakeRunning } from '@/features/setup/supplement';
import type {
  CreateSetupSessionBody,
  ResumeSetupSessionBody,
  RetrySetupSessionBody,
  SetupSessionResponse,
  SetupZoneDraftsResponse,
} from '@/features/setup/types';
import { api } from '@/lib/api';
import { useCameraOrderStore } from '@/lib/cameraNames';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

// 세팅 1단계 및 2단계 이후 서버 데이터 훅(각도 헬퍼 폴링, 카메라 높이 기본값, 세팅 세션 시작·2초 주기 조회·재시도, AI 구역 초안 조회).

/** 각도 헬퍼. poll 이면 주기로 다시 받고, 아니면 한 번 받아 둔 값을 쓴다(보정·생성의 카메라 시야 칸). */
export function useCoverageGuides(enabled = true, poll = enabled) {
  const query = useQuery({
    queryKey: SETUP_COVERAGE_GUIDES_KEY,
    queryFn: async ({ signal }) => {
      const data = await requestCoverageGuides(api, signal);
      const ids = data.latest?.cameras.map((c) => c.camera_id) ?? [];
      if (ids.length) useCameraOrderStore.getState().set(ids);
      return data;
    },
    enabled,
    refetchInterval: enabled && poll ? COVERAGE_GUIDE_POLL_MS : false,
  });
  return {
    data: query.data,
    pending: query.isPending,
    error: query.isError,
    /** 마지막으로 받은 시각(이 브라우저 시계, 받은 적 없으면 0). */
    receivedAt: query.dataUpdatedAt,
  };
}

/**
 * 받아 둔 각도 안내가 이 브라우저에서 오래됐는지(S15P31A101-691). 서버 기준(stale_after_ms)에서 받을 때의 나이(age_ms)를 뺀 때가
 * 지나면 true 다. 조회를 쉬거나 실패해 새 응답이 오지 않으면 카메라 배지가 「확인 중」으로 바뀐다. 만료 시각에 한 번만 다시 그린다.
 */
export function useCoverageExpired(
  data: { age_ms: number | null; stale_after_ms?: number } | undefined,
  receivedAt: number,
): boolean {
  const until =
    data && receivedAt > 0
      ? coverageFreshUntil(receivedAt, data.age_ms, data.stale_after_ms)
      : null;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (until === null) return;
    const timer = window.setTimeout(() => setExpiredAt(until), Math.max(0, until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [until]);
  return until !== null && expiredAt === until;
}

/**
 * 현장 게이트웨이의 카메라 헬퍼가 오래 답하지 않는지(S15P31A101-719). 1단계는 각도 안내를 2.5 초마다 받으므로 응답마다 다시 판단한다.
 * 서버가 헬퍼 결과를 한 번도 받지 못한 동안(age_ms 없음)은 처음 빈 응답을 받은 시각부터 잰다.
 */
export function useCoverageHelperLost(
  data: { age_ms: number | null } | undefined,
  receivedAt: number,
  fetchError: boolean,
): boolean {
  const empty = data !== undefined && data.age_ms === null && receivedAt > 0;
  const [emptySince, setEmptySince] = useState<number | null>(null);
  // 받은 응답에서 이어 가는 값이라 렌더 중에 맞춘다(효과로 미루면 한 박자 늦게 그린다)
  if (empty && emptySince === null) setEmptySince(receivedAt);
  if (!empty && emptySince !== null) setEmptySince(null);
  return !fetchError && coverageHelperLost(data, receivedAt, empty ? emptySince : null);
}

export function useCameraHeightDefaults(enabled = true) {
  const query = useQuery({
    queryKey: SETUP_HEIGHT_DEFAULTS_KEY,
    queryFn: ({ signal }) => requestCameraHeightDefaults(api, signal),
    enabled,
  });
  return {
    data: query.data,
    pending: query.isPending,
    error: query.isError,
  };
}

export function submitErrorText(error: unknown): string | null {
  if (!error) return null;
  return setupErrorMessage(error);
}

export function useCreateSetupSession(onCreated?: (session: SetupSessionResponse) => void) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: CreateSetupSessionBody) => createSetupSession(api, body),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
      setActiveSetupSessionId(session.setup_session_id);
      onCreated?.(session);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETUP_HEIGHT_DEFAULTS_KEY });
    },
  });

  return {
    submit: mutation.mutate,
    pending: mutation.isPending,
    error: submitErrorText(mutation.error),
    rawError: mutation.error,
    session: mutation.data ?? null,
    reset: mutation.reset,
  };
}

function isTerminalSession(session: SetupSessionResponse | undefined): boolean {
  if (!session) return false;
  // 끝난 세션이어도 맵 다시 굽기(S15P31A101-607)가 진행 중이면 계속 조회한다
  if (rebakeRunning(session)) return false;
  const stage = session.stage ?? session.status;
  return (
    session.status === 'COMPLETED' ||
    session.status === 'FAILED' ||
    stage === 'COMPLETED' ||
    stage === 'FAILED'
  );
}

/**
 * 세팅 시작 뒤 GET /api/setup-sessions/{id} 를 2초 주기로 조회한다.
 * 미리보기 Scene(preview_scene_version)·정식 고화질 Scene(scene_version)이 도착하면 세팅 화면은 그 버전을
 * GET /api/scenes/{scene_version}/view 로 새로 받아 뷰어를 자동 교체한다(편집 중인 초안은 유지). 지금 관제 Scene 은 보지 않는다.
 * 끝난 세션은 조회를 멈추지만 keepPolling 이면 계속 받는다(맵 보강 창이 열려 있는 동안 휴대폰으로 올린 파일·다시 굽기 판정을 따라간다).
 */
export function useSetupSession(sessionId: string | null, enabled = true, keepPolling = false) {
  const active = Boolean(sessionId) && enabled;
  const query = useQuery({
    queryKey: setupSessionKey(sessionId ?? ''),
    queryFn: ({ signal }) => requestSetupSession(api, sessionId!, signal),
    enabled: active,
    refetchInterval: (q) => {
      if (!active) return false;
      return isTerminalSession(q.state.data) && !keepPolling ? false : SETUP_SESSION_POLL_MS;
    },
  });

  return {
    data: query.data ?? null,
    pending: query.isPending,
    error: query.isError,
    refetch: query.refetch,
  };
}

export interface RetrySetupSessionVars {
  setupSessionId: string;
  body?: RetrySetupSessionBody;
}

export function useRetrySetupSession(onRetried?: (session: SetupSessionResponse) => void) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ setupSessionId, body }: RetrySetupSessionVars) =>
      retrySetupSession(api, setupSessionId, body),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
      setActiveSetupSessionId(session.setup_session_id);
      onRetried?.(session);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETUP_HEIGHT_DEFAULTS_KEY });
    },
  });

  return {
    retry: mutation.mutate,
    pending: mutation.isPending,
    error: submitErrorText(mutation.error),
    rawError: mutation.error,
    session: mutation.data ?? null,
    reset: mutation.reset,
  };
}

/** 멈춘 세팅(paused_reason)을 고친 높이로 이어 가기. 같은 세션이 멈춘 단계부터 다시 돈다. */
export function useResumeSetupSession(onResumed?: (session: SetupSessionResponse) => void) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      setupSessionId,
      body,
    }: {
      setupSessionId: string;
      body: ResumeSetupSessionBody;
    }) => resumeSetupSession(api, setupSessionId, body),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
      onResumed?.(session);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SETUP_HEIGHT_DEFAULTS_KEY });
    },
  });

  return {
    resume: mutation.mutate,
    pending: mutation.isPending,
    error: submitErrorText(mutation.error),
    rawError: mutation.error,
  };
}

/** 카메라 확인 걷기 창의 「걷기 시작」·「확인만 다시」(-687). 응답 세션을 바로 캐시에 넣어 창이 「시작하는 중」으로 바뀐다. */
export function useStartCameraCheck() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ setupSessionId, attempt }: { setupSessionId: string; attempt: number }) =>
      startCameraCheck(api, setupSessionId, attempt),
    onSuccess: (session) => {
      queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);
    },
  });

  return {
    start: mutation.mutate,
    pending: mutation.isPending,
    error: submitErrorText(mutation.error),
  };
}

function isDraftRunPending(data: SetupZoneDraftsResponse | undefined): boolean {
  if (!data) return true;
  return data.status === 'NOT_REQUESTED' || data.status === 'QUEUED';
}

/** GET /api/setup-sessions/{id}/zone-drafts 조회 훅. 아직 QUEUED/NOT_REQUESTED 면 2초 주기로 다시 확인한다. */
export function useSetupZoneDrafts(sessionId: string | null, enabled = true) {
  const active = Boolean(sessionId) && enabled;
  const query = useQuery({
    queryKey: setupZoneDraftsKey(sessionId ?? ''),
    queryFn: ({ signal }) => requestSetupZoneDrafts(api, sessionId!, signal),
    enabled: active,
    refetchInterval: (q) => {
      if (!active) return false;
      return isDraftRunPending(q.state.data) ? SETUP_SESSION_POLL_MS : false;
    },
  });

  return {
    data: query.data ?? null,
    pending: query.isPending,
    error: query.isError,
    refetch: query.refetch,
  };
}

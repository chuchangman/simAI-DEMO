import {
  isSceneRegenerateInProgress,
  requestCommitScene,
  requestCreateSceneRegenerate,
  requestLatestSceneRegenerate,
  requestSceneRegenerateById,
  SCENE_REGENERATE_LATEST_KEY,
  SCENE_REGENERATE_MAX_REASON_LENGTH,
  SCENE_REGENERATE_POLL_INTERVAL_MS,
  type SceneRegenerateView,
} from '@/features/layout/api';
import { requestTbmWorks, TBM_WORKS_KEY } from '@/features/tbm/api';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

export const LIVE_WORK_NOTICE =
  '작업이 진행 중(LIVE 관제)이라 맵을 다시 만들 수 없습니다. 작업을 끝낸 뒤 눌러 주세요.';

export interface UseSceneRegenerateResult {
  current: SceneRegenerateView | null;
  isInProgress: boolean;
  /** 진행 중(LIVE 관제)인 작업이 있다. 서버가 재생성을 거부하므로 버튼을 막는다. */
  liveWorkInProgress: boolean;
  isSubmitting: boolean;
  isActivating: boolean;
  activatedSceneVersion: string | null;
  requestError: string | null;
  regenerate: (reason?: string) => Promise<void>;
  activateCandidate: () => Promise<void>;
  clearError: () => void;
}

/** 맵 재생성 요청·진행 상태·후보 활성화. 관리자 도구에서만 쓰므로 역할 확인은 부르는 쪽이 한다. */
export function useSceneRegenerate(): UseSceneRegenerateResult {
  const queryClient = useQueryClient();
  const [polledView, setPolledView] = useState<SceneRegenerateView | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [activatedSceneVersion, setActivatedSceneVersion] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const latestQuery = useQuery({
    queryKey: SCENE_REGENERATE_LATEST_KEY,
    queryFn: ({ signal }) => requestLatestSceneRegenerate(api, signal),
    retry: false,
  });

  // LIVE 관제(작업 IN_PROGRESS) 중에는 GPU 를 Tier 0 가 써서 재생성이 대여되지 않는다. 작업 목록을 못 읽으면 막지 않고 서버(409)에 맡긴다.
  const worksQuery = useQuery({
    queryKey: TBM_WORKS_KEY,
    queryFn: ({ signal }) => requestTbmWorks(api, signal),
    retry: false,
  });
  const liveWorkInProgress = (worksQuery.data ?? []).some((w) => w.status === 'IN_PROGRESS');

  const current: SceneRegenerateView | null = polledView ?? latestQuery.data ?? null;
  const activeRequestId =
    current && isSceneRegenerateInProgress(current.status) ? current.request_id : null;

  const pollOnce = useCallback(
    async (requestId: number) => {
      try {
        const next = await requestSceneRegenerateById(api, requestId);
        setPolledView(next);
        if (!isSceneRegenerateInProgress(next.status)) {
          queryClient.setQueryData(SCENE_REGENERATE_LATEST_KEY, next);
        }
      } catch {
        // 폴링 중 일시 오류는 다음 2초 주기에 재시도한다.
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (activeRequestId === null) return;
    const timer = window.setInterval(() => {
      void pollOnce(activeRequestId);
    }, SCENE_REGENERATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeRequestId, pollOnce]);

  const regenerate = useCallback(
    async (reason?: string) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      setRequestError(null);
      try {
        const accepted = await requestCreateSceneRegenerate(api, reason);
        const initial: SceneRegenerateView = {
          request_id: accepted.request_id,
          status: accepted.status,
          failure_reason: null,
          scene_version: null,
          reason: reason?.trim() || null,
          requested_at_ms: Date.now(),
          updated_at_ms: Date.now(),
        };
        setPolledView(initial);
        queryClient.setQueryData(SCENE_REGENERATE_LATEST_KEY, initial);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'REGENERATE_IN_PROGRESS') {
          setRequestError('이미 진행 중인 맵 재생성 요청이 있습니다.');
          if (err.requestId) {
            await pollOnce(err.requestId);
          } else {
            await queryClient.invalidateQueries({ queryKey: SCENE_REGENERATE_LATEST_KEY });
          }
        } else if (err instanceof ApiError && err.code === 'REGENERATE_WORK_IN_PROGRESS') {
          setRequestError(LIVE_WORK_NOTICE);
          void queryClient.invalidateQueries({ queryKey: TBM_WORKS_KEY });
        } else if (err instanceof ApiError && err.code === 'INVALID_REGENERATE_REQUEST') {
          setRequestError(
            `재생성 사유는 ${SCENE_REGENERATE_MAX_REASON_LENGTH}자 이하로 입력해 주세요.`,
          );
        } else {
          setRequestError('맵 재생성 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, pollOnce, queryClient],
  );

  const activateCandidate = useCallback(async () => {
    const candidateVersion = current?.scene_version;
    if (!candidateVersion || current?.status !== 'CANDIDATE_READY' || isActivating) return;
    setIsActivating(true);
    setRequestError(null);
    try {
      await requestCommitScene(api, candidateVersion);
      setActivatedSceneVersion(candidateVersion);
      await queryClient.invalidateQueries({ queryKey: ['scenes', 'current'] });
    } catch {
      setRequestError('새 3D 배경 후보 활성화에 실패했습니다.');
    } finally {
      setIsActivating(false);
    }
  }, [current?.scene_version, current?.status, isActivating, queryClient]);

  const clearError = useCallback(() => {
    setRequestError(null);
  }, []);

  return {
    current,
    isInProgress: isSceneRegenerateInProgress(current?.status),
    liveWorkInProgress,
    isSubmitting,
    isActivating,
    activatedSceneVersion,
    requestError,
    regenerate,
    activateCandidate,
    clearError,
  };
}

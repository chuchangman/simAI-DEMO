import {
  completeSetupSession,
  requestSetupZonePlan,
  setupSessionKey,
  setupZonePlanKey,
} from '@/features/setup/api';
import { emptyZonePlanConfirm } from '@/features/setup/SetupCompleteCard';
import { setupCompleteErrorMessage } from '@/features/setup/setupErrorMessage';
import { pendingReviewCount } from '@/features/setup/setupZonePlan';
import type { AppliedZones, SetupSessionResponse } from '@/features/setup/types';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { ZONES_KEY } from '@/features/zones/api';
import type { ZonesResponse } from '@/features/zones/types';
import { readZones } from '@/features/zones/zones';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { WORK_KEY } from '@/lib/queryKeys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

// 세팅 구역 단계의 「세팅 완료」(C17, S15P31A101-615). 서버가 한 번에 구역 목록을 관제 구역으로 적용하고, 완료를 기록하고,
// (새 모델이면) 이 세션 맵을 관제 맵으로 켜고, 구성 묶음을 Tier 0 에 보낸다. 완료 뒤에는 이 세팅으로 구역·보강을 고치지 않는다(하루 1회).

export interface CompleteSetup {
  /** 세팅을 완료한다. 완료했으면 true, 취소했거나 거부·실패했으면 false(이유는 error). */
  run: () => Promise<boolean>;
  /** 구역 목록을 확인하거나 완료를 요청하는 중. */
  pending: boolean;
  /** 마지막 시도의 실패 안내(없으면 null). 다시 시도하면 지운다. */
  error: string | null;
  /** 완료 응답의 구역 적용 결과(완료하기 전이거나 다른 화면에서 이미 완료했으면 null). */
  applied: AppliedZones | null;
}

/** 세팅 완료를 부르는 훅. 저장한 구역 목록이 비었으면 관제 구역이 모두 보관되므로 먼저 확인창으로 묻는다. */
export function useCompleteSetup(session: SetupSessionResponse | null): CompleteSetup {
  const queryClient = useQueryClient();
  const id = session?.setup_session_id ?? null;
  const [applied, setApplied] = useState<AppliedZones | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: (sessionId: string) => completeSetupSession(api, sessionId),
    onSuccess: (response, sessionId) => {
      const { applied_zones: zones, ...view } = response;
      setApplied(zones);
      queryClient.setQueryData(setupSessionKey(sessionId), view);
      void queryClient.invalidateQueries({ queryKey: setupSessionKey(sessionId) });
      // 관제가 보는 작업 목록(대기 화면 판정)도 15초 주기를 기다리지 않고 바로 다시 받는다(-637)
      void queryClient.invalidateQueries({ queryKey: TBM_WORKS_KEY });
      // 완료가 세션 구역을 관제 구역에 적용했으니 작업 전 확인·관제가 보는 구역 목록을 다시 받는다(로그인마다 한 번만 받는 목록이다)
      void queryClient.invalidateQueries({ queryKey: ZONES_KEY });
      // 작업 관리의 진행(SETUP_DONE)·보고서 초안 상태를 다시 받는다. 돌려준 약속을 mutateAsync 가 기다리므로 완료(run)가 끝날 때
      // 날짜 화면은 이미 SETUP_DONE 을 받아 작업 전 확인(작업 시작)으로 넘어가 있다(-642: 그 단계는 서버 progress 로만 연다)
      return queryClient.invalidateQueries({ queryKey: WORK_KEY });
    },
    onError: (e, sessionId) => {
      setError(setupCompleteErrorMessage(e));
      // 확인 필요가 남았으면(다른 곳에서 목록을 고친 사이) 목록을 다시 받아 카드·단추가 남은 개수를 보이게 한다
      if (e instanceof ApiError && e.code === 'SETUP_ZONES_UNCONFIRMED') {
        void queryClient.invalidateQueries({ queryKey: setupZonePlanKey(sessionId) });
      }
      // 목록의 기존 구역이 그 사이 바뀌었거나 이미 완료됐으면 목록·관제 구역·세션을 다시 받는다
      if (
        e instanceof ApiError &&
        (e.code === 'SETUP_ZONE_STALE' || e.code === 'SETUP_ALREADY_COMPLETED')
      ) {
        void queryClient.invalidateQueries({ queryKey: setupZonePlanKey(sessionId) });
        void queryClient.invalidateQueries({ queryKey: ZONES_KEY });
        void queryClient.invalidateQueries({ queryKey: setupSessionKey(sessionId) });
      }
    },
  });

  const pending = checking || complete.isPending;
  const { mutateAsync } = complete;

  const run = useCallback(async (): Promise<boolean> => {
    if (id === null || pending) return false;
    setError(null);
    setChecking(true);
    try {
      const plan = await requestSetupZonePlan(api, id);
      queryClient.setQueryData(setupZonePlanKey(id), plan);
      // 확인 필요 구역이 남았으면 서버도 거부한다(409 SETUP_ZONES_UNCONFIRMED). 보내지 않고 같은 안내를 보인다
      const unconfirmed = pendingReviewCount(plan);
      if (unconfirmed > 0) {
        setError(
          `확인이 필요한 구역 ${unconfirmed}개가 남아 있습니다. 구역마다 확인·수정·삭제한 뒤 세팅을 완료하세요`,
        );
        return false;
      }
      if (plan.items.length === 0) {
        // 보관될 지금 관제 구역(앱 틀이 받아 둔 캐시). 받기 전이면 개수 없이 묻는다(S15P31A101-691)
        const live = queryClient.getQueryData<ZonesResponse>(ZONES_KEY);
        const names = live ? readZones(live).map((zone) => zone.name) : null;
        if (!window.confirm(emptyZonePlanConfirm(names))) return false;
      }
    } catch (e) {
      setError(setupCompleteErrorMessage(e));
      return false;
    } finally {
      setChecking(false);
    }
    try {
      await mutateAsync(id);
      return true;
    } catch {
      // 실패 안내와 목록 다시 받기는 변이의 onError 가 이미 했다
      return false;
    }
  }, [id, pending, mutateAsync, queryClient]);

  return { run, pending, error, applied };
}

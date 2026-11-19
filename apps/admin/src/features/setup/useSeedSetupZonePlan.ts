import {
  importPreviousSetupZones,
  seedSetupZonePlan,
  setupZonePlanKey,
} from '@/features/setup/api';
import type { SetupZonePlanView } from '@/features/setup/setupZonePlan';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useSetupZonePlanQuery } from '@/features/setup/useSetupZonePlan';
import { commitErrorText } from '@/features/zones/commitErrors';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

// 구역 단계의 세션 구역 목록 채우기(S15P31A101-615, -629, -758). 구역 단계의 구역 편집·AI 초안 수락은 관제 구역이 아니라 세션 구역
// 목록(-612)에 저장하고 세팅 완료가 그 목록으로 관제 구역을 맞춘다(목록에 없는 지금 관제 구역은 보관된다). 채우기는 서버가 한다:
// - 이전 모델 재사용(REUSE): 구역 단계에 처음 들어올 때 빈 목록(revision 0)을 확인 표시 없이 한 번 채운다(POST .../zones/seed).
// - 새 모델 + World 이어짐(world_anchor.accepted): 이전 구역을 기본으로 이어 오지 않는다(S15P31A101-758, 시연은 AI 초안 개구부 하나만).
//   관리자가 「이전 구역 불러오기」를 누를 때만 지금 관제 구역을 '확인 필요'로 더하고(POST .../zones/import-previous) 사람이
//   확인·수정·삭제한다(SetupZoneReviewCard). 목록의 AI 초안 구역과 같은 자리인 이전 구역은 서버가 빼고 이름을 알린다.
// - 새 모델 + World 끊김: 기존 구역 좌표가 새 3D 와 맞지 않아 불러오지 못한다(빈 목록에서 새로 그린다).

/** 새 모델 + World 이어짐: 이전 구역을 불러와 사람이 하나씩 확인할 수 있는 세팅(재사용은 확인 표시 없이 그대로 잇는다). */
export function reviewsCarriedZones(session: SetupSessionResponse | null | undefined): boolean {
  return session != null && session.mode !== 'REUSE' && session.world_anchor?.accepted === true;
}

/** 이 세션 목록을 처음 채워야 하는 때의 목록(재사용이고 아직 아무것도 저장하지 않은 목록). 아니면 null. */
function emptyReusePlan(
  session: SetupSessionResponse | null,
  plan: SetupZonePlanView | undefined,
): SetupZonePlanView | null {
  if (session?.mode !== 'REUSE' || !plan) return null;
  return plan.revision === 0 && plan.items.length === 0 ? plan : null;
}

/**
 * 구역 단계에서 재사용 세션의 빈 구역 목록을 채운다(세션마다 한 번). session 이 null 이면 아무것도 하지 않는다(구역 단계가 아니거나
 * 이미 완료). 채우지 못하면 목록을 다시 받고 다시 시도하지 않는다.
 */
export function useSeedSetupZonePlan(session: SetupSessionResponse | null): void {
  const queryClient = useQueryClient();
  const sessionId = session?.setup_session_id ?? null;
  const plan = useSetupZonePlanQuery(sessionId);
  const seeded = useRef<string | null>(null);

  const seed = useMutation({
    mutationFn: (id: string) => seedSetupZonePlan(api, id),
    onSuccess: (saved, id) => {
      queryClient.setQueryData(setupZonePlanKey(id), saved);
    },
    onError: (_error, id) => {
      void queryClient.invalidateQueries({ queryKey: setupZonePlanKey(id) });
    },
  });

  const emptyPlan = emptyReusePlan(session, plan.data);
  const { mutate } = seed;
  useEffect(() => {
    if (sessionId === null || emptyPlan === null || seeded.current === sessionId) return;
    seeded.current = sessionId;
    mutate(sessionId);
  }, [sessionId, emptyPlan, mutate]);
}

export interface ImportPreviousZones {
  /** 이전 구역을 불러온다(서버가 목록에 더한다). */
  run: () => void;
  busy: boolean;
  /** 마지막 불러오기 결과: 더한 수와 AI 초안과 같은 자리라 뺀 이름. 아직 누르지 않았으면 null. */
  result: { added: number; skipped: string[] } | null;
  error: string | null;
}

/** 「이전 구역 불러오기」(S15P31A101-758). 응답 목록으로 세션 구역 목록을 바꾼다. */
export function useImportPreviousZones(sessionId: string): ImportPreviousZones {
  const queryClient = useQueryClient();
  const plan = useSetupZonePlanQuery(sessionId);
  const before = plan.data?.items.length ?? 0;
  const mutation = useMutation({
    mutationFn: async () => ({ before, view: await importPreviousSetupZones(api, sessionId) }),
    onSuccess: ({ view }) => {
      queryClient.setQueryData(setupZonePlanKey(sessionId), view);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: setupZonePlanKey(sessionId) });
    },
  });
  const { mutate, isPending, data, error } = mutation;
  return {
    run: () => {
      if (!isPending) mutate();
    },
    busy: isPending,
    result: data
      ? {
          added: Math.max(data.view.items.length - data.before, 0),
          skipped: data.view.import_skipped,
        }
      : null,
    error: error ? commitErrorText(error) : null,
  };
}

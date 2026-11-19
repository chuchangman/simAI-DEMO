import { acceptedByZones, draftCreateRequest } from '@/features/setup/draftZone';
import { markSetupZoneDraftAccepted, useSetupFlowStore } from '@/features/setup/setup.store';
import { draftPublishFailure } from '@/features/setup/setupUx';
import type { ZoneDraftItem } from '@/features/setup/types';
import { useSetupZonePlanQuery } from '@/features/setup/useSetupZonePlan';
import { commitErrorText, CommitInFlightError } from '@/features/zones/commitErrors';
import { useZoneCommitMutation } from '@/features/zones/useZoneCommitMutation';
import { useZones } from '@/features/zones/useZones';
import type { SetupZoneSource } from '@/features/zones/zoneSource';
import { useMemo, useRef, useState } from 'react';

/** 수락하지 못한 초안과 그 문구. */
export interface DraftAcceptFailure {
  candidateId: string;
  text: string;
}

/**
 * 세팅 AI 구역 초안 수락. 세팅 구역 단계(source 있음, -615)는 세션 구역 목록에 AI 항목(candidate_id)으로 넣고, 그 밖에는 관제의
 * 구역 추가와 같은 저장(POST /api/zones/commit)으로 구역(고소 작업면 초안이면 작업면도)을 만든다. 한 번에 하나만 보내고, 이미
 * 구역으로 만든 초안(이 화면에서 수락했거나, 목록에 그 후보가 있거나, 같은 모양의 구역이 있다)은 다시 보내지 않는다.
 * acceptedIds 는 그렇게 구역이 된 초안 ID 다.
 */
export function useAcceptZoneDraft(
  drafts: readonly ZoneDraftItem[],
  setupLayoutSync?: import('@/features/setup/useSetupLayoutSync').SetupLayoutSync,
  source?: SetupZoneSource | null,
) {
  const commit = useZoneCommitMutation(setupLayoutSync, source);
  const { zones } = useZones(source);
  const plan = useSetupZonePlanQuery(source?.sessionId ?? null);
  const recorded = useSetupFlowStore((s) => s.acceptedDraftIds);
  const matched = useMemo(() => {
    const inPlan = new Set((source ? plan.data?.items : undefined)?.map((i) => i.candidate_id));
    const byShape = acceptedByZones(drafts, zones);
    return [
      ...new Set([...byShape, ...drafts.map((d) => d.candidate_id).filter((id) => inPlan.has(id))]),
    ];
  }, [drafts, zones, plan.data, source]);
  const acceptedIds = useMemo(() => [...new Set([...recorded, ...matched])], [recorded, matched]);
  // 두 번 누름은 화면이 다시 그려지기 전에 들어올 수 있어 상태 대신 ref 로 막는다.
  const sending = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<DraftAcceptFailure | null>(null);

  const accept = async (item: ZoneDraftItem) => {
    const id = item.candidate_id;
    const done = useSetupFlowStore.getState().acceptedDraftIds.includes(id) || matched.includes(id);
    if (sending.current || done) return;
    sending.current = true;
    setPendingId(id);
    setFailure(null);
    try {
      const result = await commit.mutateAsync({
        request: draftCreateRequest(item, zones),
        zone: null,
        linked: null,
        origin: { source: 'AI', candidateId: id },
      });
      markSetupZoneDraftAccepted(id);
      if (result.publishError) {
        setFailure({
          candidateId: id,
          text: draftPublishFailure(result.publishError),
        });
      }
    } catch (error) {
      // 다른 저장이 아직 끝나지 않아 보내지 않았다(두 번 누름). 실패로 보이지 않는다.
      if (!(error instanceof CommitInFlightError))
        setFailure({ candidateId: id, text: commitErrorText(error) });
    } finally {
      sending.current = false;
      setPendingId(null);
    }
  };

  return { acceptedIds, accept, pendingId, failure };
}

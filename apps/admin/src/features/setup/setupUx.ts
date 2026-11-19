import type { ZoneDraftItem } from '@/features/setup/types';
import type { ZoneAiOpinion } from '@/features/zones/types';
import { ApiError } from '@/lib/http';

/** AI 의견은 제안으로만 표시한다. 높이 판정이나 현장 구역은 바꾸지 않는다. */
export function hasChangeOpinion(opinion: ZoneAiOpinion | null | undefined): boolean {
  return (
    opinion?.status === 'OPINION' &&
    (opinion.recommended_action === 'MODIFY' || opinion.recommended_action === 'REMOVE')
  );
}

const DRAFT_REASON: Record<ZoneDraftItem['candidate_kind'], string> = {
  OPENING: '사진과 맵에서 바닥이 뚫린 곳으로 보여 위험 구역으로 제안했어요.',
  ELEVATED_WORK_SURFACE: '사진과 맵에서 주변보다 높은 작업면으로 보여 위험 구역으로 제안했어요.',
  FLOOR_EDGE: '사진과 맵에서 바닥 높이가 달라지거나 끝나는 곳으로 보여 위험 구역으로 제안했어요.',
};

/** 원문 수치를 요약해 확정하지 않고, 후보 종류에 따른 제안 근거와 사람이 할 일을 말한다. */
export function draftReason(item: ZoneDraftItem): string {
  return item.no_opinion
    ? 'AI가 사진에서 확인하지 못한 후보이므로 현장과 비교해 주세요.'
    : DRAFT_REASON[item.candidate_kind];
}

/** 저장 후 발행 실패의 원인과 실제 재발행 시점을 함께 알린다. */
export function draftPublishFailure(error: unknown): string {
  const reasons: Record<string, string> = {
    CURRENT_CALIBRATION_MISSING: '유효한 카메라 보정이 없어요.',
    CALIBRATION_MISSING: '카메라 보정 문서가 없어요.',
    RULES_MISSING: '적용할 위험 판정 규칙이 없어요.',
    PUBLIC_URL_NOT_SET: '현장으로 보낼 서버 주소가 설정되지 않았어요.',
  };
  const cause =
    error instanceof ApiError && error.kind === 'NETWORK'
      ? '서버 연결이 끊겼어요.'
      : error instanceof ApiError && error.kind === 'TIMEOUT'
        ? '서버 응답 시간이 지났어요.'
        : (error instanceof ApiError && reasons[error.code ?? '']) ||
          '서버에서 전송을 마치지 못했어요.';
  return `구역은 저장했지만 현장 판정으로 보내지 못했습니다. ${cause} 세팅 완료와 작업 시작 때 다시 보냅니다. 같은 오류가 계속되면 완료·시작도 멈추므로 관리자에게 원인을 확인해 주세요.`;
}

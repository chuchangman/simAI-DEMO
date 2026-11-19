import { isWorkError, WORK_ERROR } from '@/features/work/api';

// 작업 종료 단계의 실패 안내 글. 서버가 준 문구는 보이지 않고 오류 코드로 가른다.

/** 보고서 보내기가 거절됐을 때: 보고서(초안·종료 미팅)를 쓰는 중·이미 제출함·작업이 아직 안 끝남, 그 밖. */
export function sendErrorMessage(error: unknown): string {
  if (isWorkError(error, WORK_ERROR.REPORT_NOT_READY)) {
    return '보고서를 쓰는 중이에요. 잠시 뒤 다시 보내 주세요';
  }
  if (isWorkError(error, WORK_ERROR.REPORT_LOCKED)) return '이미 제출한 보고서예요';
  if (isWorkError(error, WORK_ERROR.INVALID_STATE)) return '작업이 아직 끝나지 않았어요';
  return '보고서를 보내지 못했습니다. 다시 시도해 주세요.';
}

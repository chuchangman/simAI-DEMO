import { WORK_ERROR } from '@/features/work/api';
import { sendErrorMessage } from '@/features/work/run/runErrors';
import { ApiError } from '@/lib/http';
import { describe, expect, it } from 'vitest';

const GENERIC = '보고서를 보내지 못했습니다. 다시 시도해 주세요.';
const httpError = (code: string) => new ApiError(409, { code });

describe('sendErrorMessage', () => {
  it('종료 미팅을 쓰는 중·이미 제출함·작업이 안 끝남을 각각 알려 준다', () => {
    expect(sendErrorMessage(httpError(WORK_ERROR.REPORT_NOT_READY))).toBe(
      '보고서를 쓰는 중이에요. 잠시 뒤 다시 보내 주세요',
    );
    expect(sendErrorMessage(httpError(WORK_ERROR.REPORT_LOCKED))).toBe('이미 제출한 보고서예요');
    expect(sendErrorMessage(httpError(WORK_ERROR.INVALID_STATE))).toBe(
      '작업이 아직 끝나지 않았어요',
    );
  });

  it('그 밖의 오류·연결 실패는 일반 글이다', () => {
    expect(sendErrorMessage(httpError(WORK_ERROR.REPORT_VERSION_STALE))).toBe(GENERIC);
    expect(sendErrorMessage(httpError('SOMETHING_ELSE'))).toBe(GENERIC);
    expect(sendErrorMessage(new ApiError(0))).toBe(GENERIC);
    expect(sendErrorMessage(new Error('x'))).toBe(GENERIC);
  });
});

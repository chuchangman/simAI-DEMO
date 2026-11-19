import { ApiError } from '@/lib/http';

export const SETUP_LIVE_WORK_BLOCKED_TEXT =
  '진행 중인 작업이 있어 세팅을 시작할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요';

export const SETUP_WORKER_UNAVAILABLE_TEXT =
  'GPU 서버(분석 워커)가 연결돼 있지 않아 세팅을 시작할 수 없습니다. 서버 연결을 확인한 뒤 다시 시도하세요';

/** 세팅 시작·재시도가 진행 중 작업(409 SETUP_BLOCKED_BY_LIVE_WORK) 때문에 거절됐는지 판정한다. */
export function isSetupBlockedByLiveWork(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'SETUP_BLOCKED_BY_LIVE_WORK';
}

/** 서버 409 응답 본문에 진행 중 작업 식별자(work_id)가 실려 있으면 돌려준다. */
export function blockedLiveWorkId(error: unknown): number | null {
  if (!isSetupBlockedByLiveWork(error) || !(error instanceof ApiError)) return null;
  return error.workId ?? null;
}

/** 세팅 시작(POST /api/setup-sessions)·재시도·취소 실패를 화면 안내 문구로 바꾼다. */
export function setupErrorMessage(error: unknown): string {
  if (isSetupBlockedByLiveWork(error)) {
    const workName = error instanceof ApiError ? error.workName?.trim() : undefined;
    return workName
      ? `진행 중인 작업(${workName})이 있어 세팅을 시작할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요`
      : SETUP_LIVE_WORK_BLOCKED_TEXT;
  }
  if (error instanceof ApiError && error.code === 'SETUP_WORKER_UNAVAILABLE') {
    return SETUP_WORKER_UNAVAILABLE_TEXT;
  }
  if (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.serverMessage
  ) {
    return error.serverMessage;
  }
  return '현장 세팅을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요';
}

/** 진행 중인 세팅 취소(POST /api/setup-sessions/{id}/cancel) 실패를 화면 안내 문구로 바꾼다. 모르는 4xx 는 서버 문구, 그 밖에는 기본 문구. */
export function setupCancelErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.serverMessage
  ) {
    return error.serverMessage;
  }
  return '세팅을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요';
}

/** 세팅 완료(POST /api/setup-sessions/{id}/complete, -615) 거부 코드별 안내. */
export const SETUP_COMPLETE_ERROR_TEXT: Record<string, string> = {
  SETUP_ALREADY_COMPLETED:
    '이 작업은 세팅을 이미 완료했습니다(하루 1회). 구역 수정은 관제 화면에서 하세요',
  // 세션 쪽 완료 조건(서버 SetupCompletionGate, S15P31A101-688). 서버 문구와 같은 뜻이다
  SETUP_NOT_READY_TO_COMPLETE:
    '세팅이 아직 끝나지 않았거나 실패했습니다. 새 맵은 정밀 3D 맵까지, 이전 맵 재사용은 기존 맵 맞추기까지 끝나야 완료할 수 있습니다',
  SETUP_FINAL_MAP_NOT_READY:
    '정밀 3D 맵을 만드는 중입니다. 정밀 맵이 다 만들어진 뒤에 세팅을 완료할 수 있습니다',
  SETUP_FINAL_MAP_SKIPPED:
    '다른 작업이 시작돼 정밀 3D 맵 굽기가 멈췄습니다. 이 세팅으로는 완료할 수 없으니 작업이 끝난 뒤 세팅을 다시 하세요',
  SETUP_CAMERA_CHECK_NOT_PASSED:
    '카메라 확인을 통과하지 않았습니다. 걷기 창에서 한 사람이 30초 걸어 카메라 확인을 마치세요',
  SETUP_SESSION_NOT_ACTIVE: '이 작업에 더 새로운 세팅이 있어 이 세팅으로는 완료할 수 없습니다',
  WORK_NOT_TODAY: '작업 날짜가 오늘일 때만 세팅을 완료할 수 있습니다',
  WORK_INVALID_STATE: '작업이 이미 시작됐거나 끝나 세팅을 완료할 수 없습니다',
  SETUP_COMPLETE_BLOCKED_BY_LIVE_WORK:
    '진행 중인 작업이 있어 세팅을 완료할 수 없습니다. 작업을 종료한 뒤 다시 시도하세요',
  SETUP_ZONE_WORLD_MISMATCH:
    '3D 좌표가 새로 정해진 세팅이라 기존 구역을 그대로 쓸 수 없습니다. 구역 목록에서 기존 구역을 빼고 새로 그려 주세요',
  SETUP_ZONE_STALE:
    '구역 목록의 기존 구역이 더 이상 관제 구역이 아니어서 목록을 다시 받았습니다. 확인한 뒤 다시 완료하세요',
  SETUP_ZONES_CLOSED: '세팅이 끝났거나 작업이 시작돼 구역을 적용할 수 없습니다',
  SETUP_ZONES_UNCONFIRMED:
    '확인이 필요한 구역이 남아 있습니다. 구역마다 확인·수정·삭제한 뒤 세팅을 완료하세요',
  SUPPLEMENT_SETUP_COMPLETED: '세팅을 완료한 뒤에는 맵 보강 촬영·다시 굽기를 할 수 없습니다',
};

/** 세팅 완료 실패를 화면 안내 문구로 바꾼다. 모르는 4xx 는 서버 문구, 그 밖에는 기본 문구. */
export function setupCompleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 확인 필요 거부는 서버 문구에 남은 개수가 있다(S15P31A101-629)
    if (error.code === 'SETUP_ZONES_UNCONFIRMED' && error.serverMessage) return error.serverMessage;
    const known = error.code ? SETUP_COMPLETE_ERROR_TEXT[error.code] : undefined;
    if (known) return known;
    if (error.status >= 400 && error.status < 500 && error.serverMessage)
      return error.serverMessage;
  }
  return '세팅을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요';
}

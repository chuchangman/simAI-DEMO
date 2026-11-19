import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { ACK_ERROR_CODE } from '@/features/events/constants';
import { ApiError, NETWORK_ERROR } from '@/lib/http';

// 경보 확인(ACK) 권한과 실패 문구. import.meta.env 를 읽는 api 인스턴스(useAckEvent)와 나눠, 시험과 경보음 훅이 env 없이 부른다.

/** 서버가 ProblemDetail 의 code 로 알리는 ACK 실패의 문구. 서버 문구 대신 화면 문구를 쓴다. */
const ACK_ERROR_TEXT: Record<string, string> = {
  [ACK_ERROR_CODE.NOT_FOUND]: '이벤트를 찾을 수 없습니다',
  [ACK_ERROR_CODE.RESOLVED]: '이미 해소된 이벤트입니다',
  [ACK_ERROR_CODE.INVALID_SEQUENCE]:
    '이벤트 상태가 바뀌었습니다. 새 상태를 받은 뒤 다시 확인하세요',
  [ACK_ERROR_CODE.INVALID_CHANNEL]: '확인 경로가 올바르지 않습니다',
};

const ACK_FAILED_TEXT = '확인하지 못했습니다';

export function ackErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return ACK_FAILED_TEXT;
  if (error.status === NETWORK_ERROR) return '서버에 연결할 수 없습니다';
  const text = error.code === undefined ? undefined : ACK_ERROR_TEXT[error.code];
  if (text) return text;
  // 4xx 서버 문구만 보여 준다. 5xx 문구에는 서버 내부 정보가 섞일 수 있다.
  if (error.status >= 400 && error.status < 500 && error.serverMessage) return error.serverMessage;
  return ACK_FAILED_TEXT;
}

/**
 * 확인 뒤 목록을 다시 받아야 하는 실패. 서버의 이벤트 상태가 화면과 다르다는 뜻이라, 카드가 새 상태를 보이게 한다.
 * - RESOLVED: 그 사이 해소됐다.
 * - INVALID_SEQUENCE: 화면이 모르는 상태가 서버에 있다(STOMP 를 놓쳤다).
 */
export function isStaleAckError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ACK_ERROR_CODE.RESOLVED || error.code === ACK_ERROR_CODE.INVALID_SEQUENCE)
  );
}

/** 경보 확인 권한: 반장·관리자(명세 12.6). 열람 계정에는 확인 버튼이 없고, 끌 수 없는 경보음도 내지 않는다. */
export function useCanAck() {
  const role = useCurrentRole();
  return role === 'ADMIN' || role === 'FOREMAN';
}

import { ApiError, NETWORK_ERROR } from '@/lib/http';

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '아이디 또는 비밀번호가 맞지 않습니다';
    if (error.status === NETWORK_ERROR) return '서버에 연결할 수 없습니다';
    // 4xx 서버 문구만 보여 준다. 5xx 문구에는 서버 내부 정보가 섞일 수 있다.
    if (error.status < 500 && error.serverMessage) return error.serverMessage;
  }
  return '로그인하지 못했습니다';
}

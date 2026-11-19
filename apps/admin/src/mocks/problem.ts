import { readMockUser, type MockUser } from '@/mocks/mockUser';
import { HttpResponse } from 'msw/http';

// 서버가 오류를 돌려주는 본문(ProblemDetail + code). 서버 보안 필터의 401 도 같은 모양이다.
export const problem = (status: number, code: string, detail: string) =>
  HttpResponse.json({ status, detail, code }, { status });

export const unauthorized = () => problem(401, 'UNAUTHORIZED', '로그인이 필요합니다');

/** 요청의 계정. 없거나 만료된 실서버 토큰(혼합 모드)이면 서버처럼 거절하도록 undefined. */
export function readLiveUser(request: Request, now: number): MockUser | undefined {
  const user = readMockUser(request.headers.get('Authorization'));
  if (!user || (user.expiresAt !== undefined && user.expiresAt <= now)) return undefined;
  return user;
}

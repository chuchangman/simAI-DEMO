import { type LoginForm, loginResponseSchema } from '@/features/auth/types';
import type { Http } from '@/lib/http';
import type { Session } from '@/store/session.store';
import { z } from 'zod';

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.
// 셋 다 갱신 쿠키(simai_refresh, HttpOnly)를 주고받으므로 쿠키를 싣는다. 토큰을 싣지 않는 http 로 부른다
// (만료된 Bearer 를 실으면 서버 보안 필터가 쿠키를 보기 전에 401 로 거절한다).

// 유효 시간(초)을 받은 시각 기준 만료 시각(ms)으로 바꿔 둔다. 실시간 연결이 만료 전에 갱신하는 데 쓴다.
function toSession({ expiresIn, ...session }: z.infer<typeof loginResponseSchema>): Session {
  return expiresIn === undefined
    ? session
    : { ...session, expiresAt: Date.now() + expiresIn * 1000 };
}

export async function requestLogin(http: Http, input: LoginForm): Promise<Session> {
  return toSession(
    await http('/api/auth/login', {
      method: 'POST',
      body: input,
      schema: loginResponseSchema,
      credentials: 'include',
    }),
  );
}

/** 갱신 쿠키로 새 access 토큰을 받는다. 쿠키도 새것으로 바뀐다. */
export async function requestRefresh(http: Http): Promise<Session> {
  return toSession(
    await http('/api/auth/refresh', {
      method: 'POST',
      schema: loginResponseSchema,
      credentials: 'include',
    }),
  );
}

/** 갱신 쿠키를 폐기하고 지운다. 쿠키가 없거나 모르는 쿠키여도 204 다. */
export function requestLogout(http: Http) {
  return http('/api/auth/logout', {
    method: 'POST',
    schema: z.undefined(),
    credentials: 'include',
  });
}

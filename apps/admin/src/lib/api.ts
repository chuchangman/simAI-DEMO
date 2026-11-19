import { createAuthSession } from '@/features/auth/authSession';
import { env } from '@/lib/env';
import { createHttp } from '@/lib/http';
import { useSessionStore } from '@/store/session.store';

// 로그인·갱신·로그아웃 전용이라 토큰을 싣지 않는다(만료된 Bearer 를 실으면 서버가 갱신 쿠키를 보기 전에 401 로 거절한다).
// 갱신은 끊지 않고 기다리므로 시간 제한을 길게 둔다.
const authApi = createHttp({ baseUrl: env.VITE_API_BASE_URL, timeoutMs: 30_000 });

export const authSession = createAuthSession({ http: authApi, store: useSessionStore });

// 앱의 REST 요청은 이 인스턴스를 거친다. 토큰이 거부되면(401) 갱신해 한 번 다시 보내고,
// 갱신 쿠키도 거부되면 세션을 끝낸다. 라우트 가드가 로그인 화면으로 보낸다.
export const api = createHttp({
  baseUrl: env.VITE_API_BASE_URL,
  getToken: () => useSessionStore.getState().session?.accessToken,
  refreshToken: authSession.refresh,
  onUnauthorized: (token) => useSessionStore.getState().signOutIfCurrent(token),
});

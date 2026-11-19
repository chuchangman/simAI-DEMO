import { requestLogin, requestLogout, requestRefresh } from '@/features/auth/api';
import type { LoginForm } from '@/features/auth/types';
import { ApiError, type Http, NETWORK_ERROR } from '@/lib/http';
import type { Session, SessionState } from '@/store/session.store';
import type { StoreApi } from 'zustand';

/** 409 REFRESH_TOKEN_ROTATED 뒤 다시 갱신하기 전에 기다리는 시간(ms). 먼저 끝난 요청의 새 쿠키가 저장될 틈을 준다. */
const ROTATED_RETRY_MS = [300, 1000] as const;

/** 만료까지 이만큼(ms) 남으면 실시간 연결 전에 먼저 갱신한다. */
const REFRESH_AHEAD_MS = 60_000;

/** 서버에 로그아웃을 아직 알리지 못했다는 표식. 다음에 앱을 켤 때 복구 대신 로그아웃을 다시 보낸다. */
export const LOGOUT_PENDING_KEY = 'simai.logoutPending';

type Mark = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AuthSessionDeps {
  /** 토큰을 싣지 않는 http. */
  http: Http;
  store: StoreApi<SessionState>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 로그아웃 표식을 둘 곳. 기본은 localStorage(못 쓰면 표식 없이 동작한다). */
  storage?: Mark;
}

export type AuthSession = ReturnType<typeof createAuthSession>;

/**
 * 로그인·갱신·로그아웃(/api/auth/*). 갱신 쿠키는 브라우저에 하나라 요청을 한 줄로 세운다.
 * - 로그아웃은 진행 중인 갱신 뒤에 간다. 갱신이 바꾼 새 쿠키를 폐기해야 한다(옛 쿠키를 폐기하면 새 쿠키가 14일 남는다).
 * - 로그인은 진행 중인 로그아웃 뒤에 간다. 로그아웃 응답의 쿠키 지우기가 새 로그인 쿠키를 지우지 않게 한다.
 */
export function createAuthSession({
  http,
  store,
  sleep = wait,
  now = Date.now,
  storage = safeLocalStorage(),
}: AuthSessionDeps) {
  let tail: Promise<unknown> = Promise.resolve();
  let refreshing: Promise<string | undefined> | undefined;
  // 마지막 갱신의 옛 토큰과 새 토큰. 갱신이 끝난 뒤 옛 토큰으로 401 을 받은 요청에 새 토큰을 준다.
  let renewed: { from: string; to: string } | undefined;
  // 로그인을 시도할 때마다 올린다. 그 전에 시작한 복구는 결과를 버린다.
  let loginAttempts = 0;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  // 409 면 다른 탭·요청이 먼저 갱신했다. 그 응답의 새 쿠키가 저장될 때까지 조금 기다렸다가 다시 한다.
  async function refreshWithRetry(): Promise<Session> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestRefresh(http);
      } catch (error) {
        const delay = ROTATED_RETRY_MS[attempt];
        if (!isRotated(error) || delay === undefined) throw error;
        await sleep(delay);
      }
    }
  }

  async function renew(current: Session): Promise<string | undefined> {
    // 큐에서 기다리는 사이 로그아웃했거나 다른 계정으로 로그인했으면 갱신하지 않는다(그 계정의 쿠키를 회전시킨다).
    if (store.getState().session !== current) return undefined;
    try {
      const next = await refreshWithRetry();
      const { session, signIn, signOutIfCurrent } = store.getState();
      // 기다리는 사이 로그아웃했거나 다시 로그인했으면 그 세션을 건드리지 않는다.
      if (session !== current) return undefined;
      // 다른 탭이 다른 계정으로 로그인해 쿠키가 바뀌었다. 이 탭의 계정으로는 이어 갈 수 없다.
      if (next.user.id !== current.user.id) {
        signOutIfCurrent(current.accessToken);
        return undefined;
      }
      renewed = { from: current.accessToken, to: next.accessToken };
      signIn(next);
      return next.accessToken;
    } catch (error) {
      // 서버가 꺼졌거나(5xx·연결 실패·시간 초과) 다른 탭과 계속 겹친 것(409)은 세션을 둔다. 곧 다시 시도할 수 있다.
      // 그 밖의 실패(401 쿠키 거부, 403·404, 본문이 틀림)는 다시 해도 같으므로 로그인 화면으로 보낸다.
      if (!isTransient(error)) store.getState().signOutIfCurrent(current.accessToken);
      return undefined;
    }
  }

  /**
   * 401 을 받은 토큰으로 새 토큰을 받는다(lib/http 의 refreshToken). 동시에 온 401 은 갱신 하나를 같이 기다린다.
   * 세션이 없거나 큐에서 기다리는 사이 세션이 바뀌면 갱신하지 않는다(아무도 쓰지 않는 새 쿠키가 생긴다).
   */
  function refresh(failedToken: string): Promise<string | undefined> {
    const current = store.getState().session;
    if (!current) return Promise.resolve(undefined);
    if (current.accessToken !== failedToken) {
      // 이미 이 토큰을 갱신했다. 다른 계정의 토큰은 주지 않는다.
      const done = renewed?.from === failedToken && renewed.to === current.accessToken;
      return Promise.resolve(done ? current.accessToken : undefined);
    }
    refreshing ??= enqueue(() => renew(current)).finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  // 표식은 큐 안에서 지운다. 표식을 남긴 로그아웃이 끝나기 전에 로그인 성공이 표식을 지우지 않게 한다.
  function sendLogout() {
    return enqueue(async () => {
      await requestLogout(http);
      mark(storage, false);
    });
  }

  return {
    login(input: LoginForm): Promise<Session> {
      loginAttempts += 1;
      return enqueue(async () => {
        const session = await requestLogin(http, input);
        // 새 로그인 쿠키가 옛 쿠키를 바꿨으니 못 보낸 로그아웃은 더 보내지 않는다(보내면 새 쿠키를 폐기한다).
        mark(storage, false);
        return session;
      });
    },

    refresh,

    /**
     * 실시간 연결이 연결·재연결 직전에 부른다. 만료가 가까우면 먼저 갱신한 토큰을 준다.
     * STOMP 는 REST 처럼 401 을 받아 갱신할 길이 없다. 갱신에 실패하면 지금 토큰을 준다(다음 재연결에서 다시 시도).
     */
    async freshToken(): Promise<string | undefined> {
      const session = store.getState().session;
      if (!session) return undefined;
      if (session.expiresAt === undefined || session.expiresAt - now() > REFRESH_AHEAD_MS) {
        return session.accessToken;
      }
      return (await refresh(session.accessToken)) ?? store.getState().session?.accessToken;
    },

    /**
     * 앱을 켤 때 갱신 쿠키로 로그인을 되살린다. 부르는 쪽은 기다리다 그만둬도 요청은 끊지 않는다(요청 시간 제한만 둔다).
     * 끊으면 교체된 새 쿠키를 잃고, 서버가 옛 쿠키 재사용으로 보고 그 계정의 갱신 토큰을 모두 폐기할 수 있다.
     * 지난번 로그아웃을 서버에 알리지 못했으면 되살리지 않고 로그아웃을 다시 보낸다(공용 PC 에서 이전 사용자로 들어가지 않게).
     */
    restore(): Promise<void> {
      if (mark(storage)) return sendLogout().catch(() => undefined);
      const attempts = loginAttempts;
      return enqueue(refreshWithRetry).then(
        (next) => {
          // 기다리는 사이 로그인을 시도했으면 그 결과를 따른다(틀린 비밀번호 오류도 그대로 보인다).
          if (attempts === loginAttempts && !store.getState().session)
            store.getState().signIn(next);
        },
        () => undefined,
      );
    },

    /**
     * 화면은 바로 로그아웃하고, 서버에 갱신 쿠키 폐기를 부탁한다.
     * 실패하거나 탭을 닫아 끊겨도 표식이 남아 다음에 앱을 켤 때 다시 보낸다.
     */
    logout() {
      mark(storage, true);
      store.getState().signOut();
      void sendLogout().catch(() => undefined);
    },
  };
}

function isRotated(error: unknown) {
  return (
    error instanceof ApiError && error.status === 409 && error.code === 'REFRESH_TOKEN_ROTATED'
  );
}

function isTransient(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return error.status === NETWORK_ERROR || error.status >= 500 || isRotated(error);
}

/** 표식을 읽거나(값 없이) 쓴다. 저장소를 못 쓰면(사생활 보호 모드 등) 표식 없이 동작한다. */
function mark(storage: Mark | undefined, value?: boolean): boolean {
  try {
    if (value === undefined) return storage?.getItem(LOGOUT_PENDING_KEY) === '1';
    if (value) storage?.setItem(LOGOUT_PENDING_KEY, '1');
    else storage?.removeItem(LOGOUT_PENDING_KEY);
  } catch {
    // 표식은 보조 수단이다. 못 쓰면 다음 복구가 쿠키를 따른다.
  }
  return false;
}

function safeLocalStorage(): Mark | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

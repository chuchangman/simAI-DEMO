import { createAuthSession, LOGOUT_PENDING_KEY } from '@/features/auth/authSession';
import { createHttp } from '@/lib/http';
import { type Session, useSessionStore } from '@/store/session.store';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://api.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const t0: Session = { accessToken: 't0', user: { id: 'u-1', role: 'ADMIN' } };

// 서버 TokenResponse 그대로(쓰지 않는 칸 포함).
const tokenResponse = (accessToken: string, id = 'u-1') =>
  HttpResponse.json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: 1800,
    user: { id, role: 'ADMIN', displayLabel: null },
  });

const problem = (status: number, code: string) =>
  HttpResponse.json({ status, detail: '실패', code }, { status });

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    has: (key: string) => values.has(key),
  };
}

function setup({ now = Date.now } = {}) {
  const sleeps: number[] = [];
  const storage = memoryStorage();
  const auth = createAuthSession({
    http: createHttp({ baseUrl: BASE }),
    store: useSessionStore,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now,
    storage,
  });
  return { auth, sleeps, storage };
}

/** 호출마다 t1, t2… 를 주는 갱신 서버. 받은 횟수를 센다. */
function countingRefresh(reply?: (n: number) => Response | Promise<Response>) {
  const calls = { n: 0 };
  server.use(
    http.post(`${BASE}/api/auth/refresh`, async () => {
      calls.n += 1;
      return reply ? reply(calls.n) : tokenResponse(`t${calls.n}`);
    }),
  );
  return calls;
}

describe('createAuthSession', () => {
  beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true));

  describe('refresh', () => {
    it('동시에 온 401 은 갱신 하나를 같이 기다리고, 새 토큰으로 세션을 바꾼다', async () => {
      const calls = countingRefresh(async () => {
        await delay(20);
        return tokenResponse('t1');
      });
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      await expect(Promise.all([auth.refresh('t0'), auth.refresh('t0')])).resolves.toEqual([
        't1',
        't1',
      ]);
      expect(calls.n).toBe(1);
      expect(useSessionStore.getState().session).toEqual({
        accessToken: 't1',
        expiresAt: expect.any(Number),
        user: { id: 'u-1', role: 'ADMIN' },
      });

      // 갱신이 끝난 뒤 옛 토큰으로 401 을 받은 요청에는 새 토큰을 준다. 모르는 토큰에는 주지 않는다.
      await expect(auth.refresh('t0')).resolves.toBe('t1');
      await expect(auth.refresh('other')).resolves.toBeUndefined();
      expect(calls.n).toBe(1);
    });

    it('갱신이 끝나면 다음 갱신을 새로 한다(t0 → t1 → t2)', async () => {
      const calls = countingRefresh();
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      await expect(auth.refresh('t0')).resolves.toBe('t1');
      await expect(auth.refresh('t1')).resolves.toBe('t2');
      expect(calls.n).toBe(2);
      expect(useSessionStore.getState().session?.accessToken).toBe('t2');
    });

    it('실패한 갱신 뒤 같은 토큰으로 다시 부르면 새로 요청한다', async () => {
      const calls = countingRefresh((n) =>
        n === 1 ? new HttpResponse(null, { status: 503 }) : tokenResponse('t1'),
      );
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      await expect(auth.refresh('t0')).resolves.toBeUndefined();
      await expect(auth.refresh('t0')).resolves.toBe('t1');
      expect(calls.n).toBe(2);
    });

    it('갱신 뒤 다른 계정으로 로그인했으면 옛 토큰의 401 에 그 계정 토큰을 주지 않는다', async () => {
      countingRefresh();
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      await expect(auth.refresh('t0')).resolves.toBe('t1');
      useSessionStore.getState().signOut();
      useSessionStore
        .getState()
        .signIn({ accessToken: 'b-1', user: { id: 'u-2', role: 'VIEWER' } });
      await expect(auth.refresh('t0')).resolves.toBeUndefined();
    });

    it('세션이 없으면 갱신하지 않는다(로그아웃 뒤 새 쿠키를 만들지 않는다)', async () => {
      const calls = countingRefresh();
      const { auth } = setup();

      await expect(auth.refresh('t0')).resolves.toBeUndefined();
      expect(calls.n).toBe(0);
    });

    it('큐에서 기다리는 사이 세션이 바뀌면 갱신 요청을 보내지 않는다', async () => {
      const calls = countingRefresh();
      server.use(
        http.post(`${BASE}/api/auth/login`, async () => {
          await delay(20);
          return tokenResponse('b-1', 'u-2');
        }),
      );
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      const login = auth.login({ username: 'bob', password: 'pw' });
      const refreshed = auth.refresh('t0');
      useSessionStore
        .getState()
        .signIn({ accessToken: 'b-1', user: { id: 'u-2', role: 'VIEWER' } });

      await login;
      await expect(refreshed).resolves.toBeUndefined();
      expect(calls.n).toBe(0);
    });

    it('409 REFRESH_TOKEN_ROTATED 면 기다렸다가 다시 갱신한다', async () => {
      countingRefresh((n) =>
        n === 1 ? problem(409, 'REFRESH_TOKEN_ROTATED') : tokenResponse('t1'),
      );
      useSessionStore.getState().signIn(t0);
      const { auth, sleeps } = setup();

      await expect(auth.refresh('t0')).resolves.toBe('t1');
      expect(sleeps).toEqual([300]);
    });

    it('409 가 이어지면 세션을 두고 새 토큰 없이 끝낸다', async () => {
      const calls = countingRefresh(() => problem(409, 'REFRESH_TOKEN_ROTATED'));
      useSessionStore.getState().signIn(t0);
      const { auth, sleeps } = setup();

      await expect(auth.refresh('t0')).resolves.toBeUndefined();
      expect(calls.n).toBe(3);
      expect(sleeps).toEqual([300, 1000]);
      expect(useSessionStore.getState().session).toBe(t0);
    });

    it('서버가 꺼졌으면(5xx·연결 실패) 세션을 둔다', async () => {
      for (const reply of [
        () => new HttpResponse(null, { status: 500 }),
        () => new HttpResponse(null, { status: 503 }),
        () => HttpResponse.error(),
      ]) {
        countingRefresh(reply);
        useSessionStore.getState().signIn(t0);
        const { auth } = setup();

        await expect(auth.refresh('t0')).resolves.toBeUndefined();
        expect(useSessionStore.getState().session).toBe(t0);
      }
    });

    it('다시 해도 같을 실패(401·403·404·다른 409·본문 틀림)면 세션을 끝낸다', async () => {
      for (const reply of [
        () => problem(401, 'INVALID_REFRESH_TOKEN'),
        () => problem(403, 'FORBIDDEN'),
        () => new HttpResponse(null, { status: 404 }),
        () => problem(409, 'SOMETHING_ELSE'),
        () => HttpResponse.html('<html>프록시 설정이 틀렸다</html>'),
      ]) {
        const calls = countingRefresh(reply);
        useSessionStore.getState().signIn(t0);
        const { auth, sleeps } = setup();

        await expect(auth.refresh('t0')).resolves.toBeUndefined();
        expect(useSessionStore.getState().session).toBeUndefined();
        expect(calls.n).toBe(1);
        expect(sleeps).toEqual([]);
      }
    });

    it('다른 계정의 쿠키로 갱신되면(다른 탭 로그인) 이 탭의 세션을 끝낸다', async () => {
      countingRefresh(() => tokenResponse('t1', 'u-2'));
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      await expect(auth.refresh('t0')).resolves.toBeUndefined();
      expect(useSessionStore.getState().session).toBeUndefined();
    });
  });

  describe('freshToken(실시간 연결 직전)', () => {
    const soon = (session: Session, msLeft: number) => () => (session.expiresAt ?? 0) - msLeft;

    it('세션이 없으면 토큰이 없고, 만료가 멀거나 만료 시각이 없으면 지금 토큰을 준다', async () => {
      const calls = countingRefresh();
      const { auth } = setup();
      await expect(auth.freshToken()).resolves.toBeUndefined();

      useSessionStore.getState().signIn(t0);
      await expect(auth.freshToken()).resolves.toBe('t0');

      const far = { ...t0, expiresAt: 1_000_000 };
      useSessionStore.getState().signIn(far);
      await expect(setup({ now: soon(far, 120_000) }).auth.freshToken()).resolves.toBe('t0');
      expect(calls.n).toBe(0);
    });

    it('만료 1분 전부터는 먼저 갱신한 토큰을 준다', async () => {
      const calls = countingRefresh();
      const near = { ...t0, expiresAt: 1_000_000 };
      useSessionStore.getState().signIn(near);
      const { auth } = setup({ now: soon(near, 30_000) });

      await expect(auth.freshToken()).resolves.toBe('t1');
      expect(calls.n).toBe(1);
    });

    it('갱신이 잠깐 실패하면 지금 토큰을 주고(다음 재연결에서 다시), 쿠키가 거부되면 토큰이 없다', async () => {
      const near = { ...t0, expiresAt: 1_000_000 };
      countingRefresh(() => new HttpResponse(null, { status: 503 }));
      useSessionStore.getState().signIn(near);
      await expect(setup({ now: soon(near, 30_000) }).auth.freshToken()).resolves.toBe('t0');

      countingRefresh(() => problem(401, 'INVALID_REFRESH_TOKEN'));
      await expect(setup({ now: soon(near, 30_000) }).auth.freshToken()).resolves.toBeUndefined();
    });
  });

  describe('요청 순서', () => {
    it('갱신 중 로그아웃하면 새 세션을 넣지 않고, 로그아웃은 갱신이 끝난 뒤 보낸다', async () => {
      const log: string[] = [];
      // 갱신 응답은 시험이 연다. 로그아웃을 누른 뒤에 갱신이 끝나게 한다.
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(`${BASE}/api/auth/refresh`, async () => {
          log.push('refresh');
          await gate;
          log.push('refresh-done');
          return tokenResponse('t1');
        }),
        http.post(`${BASE}/api/auth/logout`, () => {
          log.push('logout');
          return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${BASE}/api/auth/login`, () => tokenResponse('t2')),
      );
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      const refreshed = auth.refresh('t0');
      await vi.waitFor(() => expect(log).toContain('refresh'));
      auth.logout();
      expect(useSessionStore.getState().session).toBeUndefined();
      release();

      await expect(refreshed).resolves.toBeUndefined();
      // 같은 큐의 마지막 요청을 기다려 앞선 요청이 모두 끝났음을 확인한다.
      await auth.login({ username: 'admin', password: 'pw' });
      expect(log).toEqual(['refresh', 'refresh-done', 'logout']);
      expect(useSessionStore.getState().session).toBeUndefined();
    });

    it('로그인은 진행 중인 로그아웃 뒤에 보낸다', async () => {
      const log: string[] = [];
      server.use(
        http.post(`${BASE}/api/auth/logout`, async () => {
          log.push('logout');
          await delay(30);
          log.push('logout-done');
          return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${BASE}/api/auth/login`, () => {
          log.push('login');
          return tokenResponse('t2');
        }),
      );
      useSessionStore.getState().signIn(t0);
      const { auth } = setup();

      auth.logout();
      await expect(auth.login({ username: 'admin', password: 'pw' })).resolves.toMatchObject({
        accessToken: 't2',
      });
      expect(log).toEqual(['logout', 'logout-done', 'login']);
    });
  });

  describe('logout', () => {
    it('서버에 알리면 표식을 지운다', async () => {
      let calls = 0;
      server.use(
        http.post(`${BASE}/api/auth/logout`, () => {
          calls += 1;
          return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${BASE}/api/auth/login`, () => tokenResponse('t2')),
      );
      useSessionStore.getState().signIn(t0);
      const { auth, storage } = setup();

      auth.logout();
      expect(storage.has(LOGOUT_PENDING_KEY)).toBe(true);
      await vi.waitFor(() => expect(storage.has(LOGOUT_PENDING_KEY)).toBe(false));
      expect(calls).toBe(1);
    });

    it('요청이 실패해도 화면은 로그아웃된 채이고, 표식이 남고, 다음 요청은 막히지 않는다', async () => {
      let calls = 0;
      server.use(
        http.post(`${BASE}/api/auth/logout`, () => {
          calls += 1;
          return HttpResponse.error();
        }),
        http.post(`${BASE}/api/auth/login`, () => tokenResponse('t2')),
      );
      useSessionStore.getState().signIn(t0);
      const { auth, storage } = setup();

      auth.logout();
      expect(useSessionStore.getState().session).toBeUndefined();
      await vi.waitFor(() => expect(calls).toBe(1));
      expect(storage.has(LOGOUT_PENDING_KEY)).toBe(true);

      // 새로 로그인하면 옛 쿠키가 바뀌었으니 표식을 지운다(남기면 다음 부팅에 새 쿠키를 폐기한다).
      await expect(auth.login({ username: 'admin', password: 'pw' })).resolves.toMatchObject({
        accessToken: 't2',
      });
      expect(storage.has(LOGOUT_PENDING_KEY)).toBe(false);
    });
  });

  describe('restore', () => {
    it('갱신 쿠키로 로그인을 되살린다', async () => {
      countingRefresh();
      const { auth } = setup();

      await auth.restore();
      expect(useSessionStore.getState().session?.accessToken).toBe('t1');
    });

    it('409 면 기다렸다가 다시 갱신해 되살린다', async () => {
      countingRefresh((n) =>
        n === 1 ? problem(409, 'REFRESH_TOKEN_ROTATED') : tokenResponse('t1'),
      );
      const { auth, sleeps } = setup();

      await auth.restore();
      expect(useSessionStore.getState().session?.accessToken).toBe('t1');
      expect(sleeps).toEqual([300]);
    });

    it('기다리는 사이 로그인을 시도했으면 복구 결과를 버리고, 로그인은 복구 뒤에 보낸다', async () => {
      const log: string[] = [];
      server.use(
        http.post(`${BASE}/api/auth/refresh`, async () => {
          log.push('refresh');
          await delay(20);
          log.push('refresh-done');
          return tokenResponse('t1');
        }),
        http.post(`${BASE}/api/auth/login`, () => {
          log.push('login');
          return problem(401, 'LOGIN_FAILED');
        }),
      );
      const { auth } = setup();

      const restored = auth.restore();
      const login = auth.login({ username: 'admin', password: 'wrong' });
      await restored;
      await expect(login).rejects.toMatchObject({ status: 401 });
      expect(log).toEqual(['refresh', 'refresh-done', 'login']);
      // 틀린 비밀번호면 로그인 화면에 남는다(쿠키 주인으로 몰래 들어가지 않는다).
      expect(useSessionStore.getState().session).toBeUndefined();
    });

    it('이미 로그인했으면 그 세션을 덮지 않는다', async () => {
      server.use(
        http.post(`${BASE}/api/auth/refresh`, async () => {
          await delay(20);
          return tokenResponse('t1');
        }),
      );
      const { auth } = setup();

      const restored = auth.restore();
      useSessionStore.getState().signIn(t0);
      await restored;
      expect(useSessionStore.getState().session).toBe(t0);
    });

    it('갱신 쿠키가 없거나 서버가 꺼졌으면 조용히 끝난다', async () => {
      for (const reply of [
        () => problem(401, 'INVALID_REFRESH_TOKEN'),
        () => new HttpResponse(null, { status: 500 }),
      ]) {
        countingRefresh(reply);
        const { auth } = setup();

        await expect(auth.restore()).resolves.toBeUndefined();
        expect(useSessionStore.getState().session).toBeUndefined();
      }
    });

    it('지난 로그아웃을 알리지 못했으면 되살리지 않고 로그아웃을 다시 보낸다', async () => {
      const calls = countingRefresh();
      let logouts = 0;
      server.use(
        http.post(`${BASE}/api/auth/logout`, () => {
          logouts += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { auth, storage } = setup();
      storage.setItem(LOGOUT_PENDING_KEY, '1');

      await auth.restore();
      expect(useSessionStore.getState().session).toBeUndefined();
      expect(calls.n).toBe(0);
      expect(logouts).toBe(1);
      expect(storage.has(LOGOUT_PENDING_KEY)).toBe(false);
    });
  });
});

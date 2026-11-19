import { ApiError, createHttp, NETWORK_ERROR } from '@/lib/http';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const BASE = 'http://api.test';
const okSchema = z.object({ ok: z.literal(true) });

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('createHttp', () => {
  it('토큰이 있으면 Bearer 헤더를 붙이고 응답을 스키마로 검사해 돌려준다', async () => {
    let authorization: string | null = null;
    server.use(
      http.get(`${BASE}/api/ping`, ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );
    const request = createHttp({ baseUrl: `${BASE}/`, getToken: () => 'token-1' });

    await expect(request('/api/ping', { schema: okSchema })).resolves.toEqual({ ok: true });
    expect(authorization).toBe('Bearer token-1');
  });

  it('토큰이 없으면 Authorization 을 붙이지 않고, 본문은 JSON 으로 보낸다', async () => {
    let received: { authorization: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${BASE}/api/echo`, async ({ request }) => {
        received = {
          authorization: request.headers.get('Authorization'),
          body: await request.json(),
        };
        return HttpResponse.json({ ok: true });
      }),
    );
    const request = createHttp({ baseUrl: BASE });

    await request('/api/echo', { method: 'POST', body: { a: 1 }, schema: okSchema });
    expect(received).toEqual({ authorization: null, body: { a: 1 } });
  });

  it('204 처럼 본문이 없으면 undefined 를 스키마로 검사한다', async () => {
    server.use(http.post(`${BASE}/api/ack`, () => new HttpResponse(null, { status: 204 })));
    const request = createHttp({ baseUrl: BASE });

    await expect(request('/api/ack', { method: 'POST', schema: z.undefined() })).resolves.toBe(
      undefined,
    );
  });

  it('성공 상태인데 본문이 스키마와 다르거나 JSON 이 아니면 INVALID_RESPONSE 다', async () => {
    server.use(
      http.get(`${BASE}/api/shape`, () => HttpResponse.json({ ok: 'yes' })),
      http.get(`${BASE}/api/html`, () => HttpResponse.html('<html>점검 중</html>')),
      http.get(`${BASE}/api/empty`, () => new HttpResponse(null, { status: 200 })),
    );
    const request = createHttp({ baseUrl: BASE });

    for (const path of ['/api/shape', '/api/html', '/api/empty']) {
      const error = await failure(request(path, { schema: okSchema }));
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 200, kind: 'INVALID_RESPONSE' });
      expect((error as ApiError).cause).toBeDefined();
    }
  });

  it('오류 응답은 상태와 서버 문구를 담은 ApiError 이고, 서버 문구는 message 에 넣지 않는다', async () => {
    server.use(
      http.get(`${BASE}/api/message`, () =>
        HttpResponse.json({ message: '이미 있다' }, { status: 409 }),
      ),
      http.get(`${BASE}/api/detail`, () =>
        HttpResponse.json({ detail: '형식이 틀렸다' }, { status: 400 }),
      ),
      http.get(`${BASE}/api/crash`, () =>
        HttpResponse.json({ message: 'NullPointerException at Foo.java:12' }, { status: 500 }),
      ),
      http.get(`${BASE}/api/empty`, () => new HttpResponse(null, { status: 500 })),
    );
    const request = createHttp({ baseUrl: BASE });

    await expect(request('/api/message', { schema: okSchema })).rejects.toMatchObject({
      status: 409,
      kind: 'HTTP',
      serverMessage: '이미 있다',
    });
    await expect(request('/api/detail', { schema: okSchema })).rejects.toMatchObject({
      status: 400,
      serverMessage: '형식이 틀렸다',
    });
    const crash = await failure(request('/api/crash', { schema: okSchema }));
    expect(crash).toBeInstanceOf(ApiError);
    expect((crash as ApiError).message).not.toContain('NullPointerException');
    await expect(request('/api/empty', { schema: okSchema })).rejects.toMatchObject({
      status: 500,
      serverMessage: undefined,
    });
  });

  it('연결이 안 되면 status 0, kind NETWORK 이고 원인을 cause 에 남긴다', async () => {
    server.use(http.get(`${BASE}/api/ping`, () => HttpResponse.error()));
    const request = createHttp({ baseUrl: BASE });

    const error = await failure(request('/api/ping', { schema: okSchema }));
    expect(error).toMatchObject({ status: NETWORK_ERROR, kind: 'NETWORK' });
    expect((error as ApiError).cause).toBeDefined();
  });

  it('정한 시간 안에 답이 없으면 TIMEOUT 이다', async () => {
    // Node 의 msw 가로채기는 시간 초과로 끊긴 요청을 500 응답으로 바꿔 돌려준다(브라우저 fetch 와 다르다).
    // 그래서 신호가 끊기면 실패하는 fetch 로 바꿔 시험한다.
    vi.stubGlobal(
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    try {
      const request = createHttp({ baseUrl: BASE, timeoutMs: 30 });

      await expect(request('/api/slow', { schema: okSchema })).rejects.toMatchObject({
        status: NETWORK_ERROR,
        kind: 'TIMEOUT',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('부르는 쪽이 취소하면 ApiError 로 바꾸지 않고 그대로 던진다', async () => {
    server.use(
      http.get(`${BASE}/api/slow`, async () => {
        await delay(500);
        return HttpResponse.json({ ok: true });
      }),
    );
    const request = createHttp({ baseUrl: BASE });
    const controller = new AbortController();

    const pending = failure(request('/api/slow', { schema: okSchema, signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('본문을 JSON 으로 만들 수 없으면 연결 실패가 아니라 그 오류를 그대로 던진다', async () => {
    const request = createHttp({ baseUrl: BASE });

    const error = await failure(
      request('/api/echo', { method: 'POST', body: { big: 1n }, schema: okSchema }),
    );
    expect(error).toBeInstanceOf(TypeError);
  });

  it('토큰을 실어 보낸 요청이 401 이면 그 토큰을 넘겨 onUnauthorized 를 부른다', async () => {
    server.use(http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })));
    const onUnauthorized = vi.fn();

    const signedIn = createHttp({ baseUrl: BASE, getToken: () => 'expired', onUnauthorized });
    await expect(signedIn('/api/me', { schema: okSchema })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith('expired');

    const signedOut = createHttp({ baseUrl: BASE, getToken: () => undefined, onUnauthorized });
    await expect(signedOut('/api/me', { schema: okSchema })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ProblemDetail 의 code 를 담는다', async () => {
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () =>
        HttpResponse.json(
          {
            title: 'Conflict',
            status: 409,
            detail: '다시 시도하세요',
            code: 'REFRESH_TOKEN_ROTATED',
          },
          { status: 409 },
        ),
      ),
    );
    const request = createHttp({ baseUrl: BASE });

    await expect(
      request('/api/auth/refresh', { method: 'POST', schema: okSchema }),
    ).rejects.toMatchObject({
      status: 409,
      serverMessage: '다시 시도하세요',
      code: 'REFRESH_TOKEN_ROTATED',
    });
  });

  it('credentials 를 그대로 넘긴다(갱신 쿠키를 싣는 인증 요청)', async () => {
    // Node 의 msw 가로채기는 요청을 다시 만들며 credentials 를 버린다. fetch 인자를 직접 본다.
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    try {
      const request = createHttp({ baseUrl: BASE });

      await request('/api/auth/refresh', {
        method: 'POST',
        schema: okSchema,
        credentials: 'include',
      });
      await request('/api/ping', { schema: okSchema });
      expect(fetch.mock.calls.map(([, init]) => init?.credentials)).toEqual(['include', undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('401 갱신 후 다시 보내기', () => {
    function guarded(valid: string, seen: { authorization: string | null; body: unknown }[]) {
      return http.post(`${BASE}/api/ack`, async ({ request }) => {
        const authorization = request.headers.get('Authorization');
        seen.push({ authorization, body: await request.json() });
        if (authorization !== `Bearer ${valid}`) {
          return HttpResponse.json(
            { detail: '로그인이 필요합니다', code: 'UNAUTHORIZED' },
            { status: 401 },
          );
        }
        return HttpResponse.json({ ok: true });
      });
    }

    it('새 토큰을 받으면 같은 본문으로 한 번만 다시 보낸다', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('fresh', seen));
      const refreshToken = vi.fn(async () => 'fresh');
      const onUnauthorized = vi.fn();
      const request = createHttp({
        baseUrl: BASE,
        getToken: () => 'stale',
        refreshToken,
        onUnauthorized,
      });

      await expect(
        request('/api/ack', { method: 'POST', body: { a: 1 }, schema: okSchema }),
      ).resolves.toEqual({ ok: true });
      expect(refreshToken).toHaveBeenCalledExactlyOnceWith('stale');
      expect(seen).toEqual([
        { authorization: 'Bearer stale', body: { a: 1 } },
        { authorization: 'Bearer fresh', body: { a: 1 } },
      ]);
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('새 토큰을 못 받거나 같은 토큰이면 다시 보내지 않고 원래 401 을 던진다', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('fresh', seen));
      const onUnauthorized = vi.fn();

      for (const refreshToken of [
        async () => undefined,
        async () => 'stale',
        () => Promise.reject(new Error('갱신 실패')),
      ]) {
        seen.length = 0;
        const request = createHttp({
          baseUrl: BASE,
          getToken: () => 'stale',
          refreshToken,
          onUnauthorized,
        });
        await expect(
          request('/api/ack', { method: 'POST', body: {}, schema: okSchema }),
        ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
        expect(seen).toHaveLength(1);
      }
      // 세션을 끝낼지는 refreshToken 이 정한다.
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('다시 보낸 요청도 401 이면 그 토큰으로 onUnauthorized 를 부르고 더 갱신하지 않는다', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('never', seen));
      const refreshToken = vi.fn(async () => 'fresh');
      const onUnauthorized = vi.fn();
      const request = createHttp({
        baseUrl: BASE,
        getToken: () => 'stale',
        refreshToken,
        onUnauthorized,
      });

      await expect(
        request('/api/ack', { method: 'POST', body: {}, schema: okSchema }),
      ).rejects.toMatchObject({ status: 401 });
      expect(refreshToken).toHaveBeenCalledTimes(1);
      expect(seen).toHaveLength(2);
      expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith('fresh');
    });

    it('갱신을 기다리는 사이 부르는 쪽이 취소하면 다시 보내지 않고 취소 오류를 던진다', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('fresh', seen));
      const controller = new AbortController();
      const refreshToken = async () => {
        controller.abort();
        return 'fresh';
      };
      const request = createHttp({ baseUrl: BASE, getToken: () => 'stale', refreshToken });

      const error = await failure(
        request('/api/ack', {
          method: 'POST',
          body: {},
          schema: okSchema,
          signal: controller.signal,
        }),
      );
      expect(error).not.toBeInstanceOf(ApiError);
      expect((error as Error).name).toBe('AbortError');
      expect(seen).toHaveLength(1);
    });

    it('갱신을 기다리는 사이 취소됐으면 새 토큰을 못 받았어도 401 이 아니라 취소 오류를 던진다', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('fresh', seen));
      const controller = new AbortController();
      const refreshToken = async () => {
        controller.abort();
        return undefined;
      };
      const request = createHttp({ baseUrl: BASE, getToken: () => 'stale', refreshToken });

      const error = await failure(
        request('/api/ack', {
          method: 'POST',
          body: {},
          schema: okSchema,
          signal: controller.signal,
        }),
      );
      expect(error).not.toBeInstanceOf(ApiError);
      expect((error as Error).name).toBe('AbortError');
    });

    it('다시 보낼 때 시간 제한을 새로 둔다(갱신을 기다린 시간을 빼지 않는다)', async () => {
      const seen: { authorization: string | null; body: unknown }[] = [];
      server.use(guarded('fresh', seen));
      // 갱신을 시간 제한보다 오래 기다린다. 제한을 나눠 쓰면 다시 보낸 요청이 바로 끊긴다.
      const refreshToken = async () => {
        await delay(400);
        return 'fresh';
      };
      const request = createHttp({
        baseUrl: BASE,
        getToken: () => 'stale',
        refreshToken,
        timeoutMs: 250,
      });

      await expect(
        request('/api/ack', { method: 'POST', body: {}, schema: okSchema }),
      ).resolves.toEqual({ ok: true });
    });
  });

  it('/ 로 시작하지 않는 경로는 보내지 않는다(토큰이 다른 서버로 가지 않게)', async () => {
    const request = createHttp({ baseUrl: BASE, getToken: () => 'token-1' });

    await expect(request('@evil.example/x', { schema: okSchema })).rejects.toThrow(/\/ 로 시작/);
    await expect(request('//evil.example/x', { schema: okSchema })).rejects.toThrow(/\/ 로 시작/);
  });

  it('같은 출처(빈 base)에서 다른 호스트로 풀리는 경로(역슬래시·제어 문자)는 보내지 않는다', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    try {
      const request = createHttp({ baseUrl: '', getToken: () => 'token-1' });

      for (const path of [
        '/\\evil.example/x',
        '/\t/evil.example/x',
        '/\n/evil.example/x',
        '/a\u007fb',
      ]) {
        await expect(request(path, { schema: okSchema })).rejects.toThrow(/\/ 로 시작/);
      }
      expect(fetch).not.toHaveBeenCalled();
      await request('/api/ping', { schema: okSchema });
      expect(fetch.mock.calls[0]?.[0]).toBe('/api/ping');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

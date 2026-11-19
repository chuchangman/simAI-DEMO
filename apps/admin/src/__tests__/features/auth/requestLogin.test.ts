import { requestLogin } from '@/features/auth/api';
import { loginResponseSchema } from '@/features/auth/types';
import { createHttp } from '@/lib/http';
import { MOCK_ACCOUNTS } from '@/mocks/accounts';
import { handlers } from '@/mocks/handlers';
import { readMockUser } from '@/mocks/mockUser';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 개발 서버 mock 응답이 로그인 응답 스키마를 통과하는지 본다.
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const client = createHttp({ baseUrl: 'http://api.test' });

describe('requestLogin', () => {
  it('mock 계정으로 로그인하면 토큰과 역할을 받는다', async () => {
    for (const account of MOCK_ACCOUNTS) {
      const session = await requestLogin(client, {
        username: account.username,
        password: account.password,
      });
      expect(session.accessToken).not.toBe('');
      expect(session.user).toEqual({ id: account.id, role: account.role });
    }
  });

  it('비밀번호가 틀리면 401 이다', async () => {
    const [account] = MOCK_ACCOUNTS;
    await expect(
      requestLogin(client, { username: account.username, password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('mock 이 준 토큰을 다른 mock(STOMP 브로커·ACK)이 같은 계정으로 알아본다', async () => {
    for (const account of MOCK_ACCOUNTS) {
      const session = await requestLogin(client, {
        username: account.username,
        password: account.password,
      });
      expect(readMockUser(`Bearer ${session.accessToken}`)).toEqual({
        id: account.id,
        role: account.role,
      });
    }
  });

  it('로그인하면 갱신 쿠키(simai_refresh, Path=/api/auth, 14일)를 준다', async () => {
    const [account] = MOCK_ACCOUNTS;
    const response = await fetch('http://api.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.username, password: account.password }),
    });
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^simai_refresh=admin;.*Path=\/api\/auth;.*Max-Age=1209600/),
    ]);
  });

  it('로그인할 때마다 다른 토큰을 준다(갱신 뒤 다시 보내기가 새 토큰을 알아본다)', async () => {
    const [account] = MOCK_ACCOUNTS;
    const input = { username: account.username, password: account.password };
    const first = await requestLogin(client, input);
    const second = await requestLogin(client, input);
    expect(first.accessToken).not.toBe(second.accessToken);
  });
});

describe('갱신·로그아웃 mock', () => {
  // Node 의 msw 는 쿠키를 저장하지 않는다(브라우저만). 갱신 쿠키는 헤더로 직접 싣는다.
  const refresh = (cookie?: string) =>
    fetch('http://api.test/api/auth/refresh', {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
    });

  it('갱신 쿠키의 계정으로 새 토큰을 준다', async () => {
    const response = await refresh('simai_refresh=foreman');
    expect(response.status).toBe(200);
    expect(loginResponseSchema.parse(await response.json()).user).toEqual({
      id: 'foreman',
      role: 'FOREMAN',
    });
  });

  it('갱신 쿠키가 없거나 모르는 계정이면 401 INVALID_REFRESH_TOKEN 이고 쿠키를 지운다', async () => {
    for (const cookie of [undefined, 'simai_refresh=nobody']) {
      const response = await refresh(cookie);
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/Max-Age=0/)]);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    }
  });

  it('로그아웃은 언제나 204 이고 쿠키를 지운다', async () => {
    const response = await fetch('http://api.test/api/auth/logout', { method: 'POST' });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^simai_refresh=;.*Path=\/api\/auth;.*Max-Age=0/),
    ]);
  });
});

import { useSessionStore } from '@/store/session.store';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// lib/api.ts 의 실제 배선을 본다. env 만 바꾼다(import.meta.env 를 읽지 않게).
vi.mock('@/lib/env', () => ({ env: { VITE_API_BASE_URL: 'http://api.test' } }));
const { api } = await import('@/lib/api');
const { avatarMeshFetch } = await import('@/lib/avatarMeshFetch');

const BASE = 'http://api.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const okSchema = z.object({ ok: z.literal(true) });
const refreshed = () =>
  HttpResponse.json({ accessToken: 't1', user: { id: 'u-1', role: 'ADMIN' } });

describe('lib/api 배선', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    useSessionStore.getState().signIn({ accessToken: 't0', user: { id: 'u-1', role: 'ADMIN' } });
  });

  it('아바타 GLB 는 Bearer 를 붙이고 바이트를 그대로 돌려준다', async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 0xff, 0x80]);
    const authorizations: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/api/avatars/person/mesh.glb`, ({ request }) => {
        authorizations.push(request.headers.get('Authorization'));
        expect(request.headers.get('Accept')).toBe('application/octet-stream');
        return new HttpResponse(bytes.buffer, { headers: { 'Content-Type': 'model/gltf-binary' } });
      }),
    );

    const result = await avatarMeshFetch('/api/avatars/person/mesh.glb');
    expect(new Uint8Array(result)).toEqual(bytes);
    expect(authorizations).toEqual(['Bearer t0']);
  });

  it('아바타도 401 에 쿠키로 갱신하고 새 Bearer 로 한 번 다시 받는다', async () => {
    const authorizations: (string | null)[] = [];
    const refreshAuthorizations: (string | null)[] = [];
    const bytes = new Uint8Array([0, 0xff, 0x80]);
    server.use(
      http.post(`${BASE}/api/auth/refresh`, ({ request }) => {
        refreshAuthorizations.push(request.headers.get('Authorization'));
        return refreshed();
      }),
      http.get(`${BASE}/api/avatars/person/mesh.glb`, ({ request }) => {
        const authorization = request.headers.get('Authorization');
        authorizations.push(authorization);
        return authorization === 'Bearer t1'
          ? new HttpResponse(bytes.buffer)
          : new HttpResponse(null, { status: 401 });
      }),
    );

    expect(new Uint8Array(await avatarMeshFetch('/api/avatars/person/mesh.glb'))).toEqual(bytes);
    expect(authorizations).toEqual(['Bearer t0', 'Bearer t1']);
    expect(refreshAuthorizations).toEqual([null]);
  });

  it('아바타를 갱신 뒤에도 거절하면 세션을 끝내고 오류 본문을 보존한다', async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/api/auth/refresh`, refreshed),
      http.get(`${BASE}/api/avatars/person/mesh.glb`, () => {
        attempts += 1;
        return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
      }),
    );

    await expect(avatarMeshFetch('/api/avatars/person/mesh.glb')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(attempts).toBe(2);
    expect(useSessionStore.getState().session).toBeUndefined();
  });

  it('아바타 외부 URL 은 토큰을 보내기 전에 거부한다', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      for (const url of [
        'https://other.test/mesh.glb',
        '//other.test/mesh.glb',
        '/\\other.test/mesh.glb',
      ]) {
        await expect(avatarMeshFetch(url)).rejects.toThrow(/\/ 로 시작/);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('앱 요청이 401 이면 토큰 없이 쿠키로 갱신하고 새 토큰으로 다시 보낸다', async () => {
    const refreshAuthorization: (string | null)[] = [];
    const dataAuthorization: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/api/auth/refresh`, ({ request }) => {
        refreshAuthorization.push(request.headers.get('Authorization'));
        return refreshed();
      }),
      http.get(`${BASE}/api/data`, ({ request }) => {
        const authorization = request.headers.get('Authorization');
        dataAuthorization.push(authorization);
        return authorization === 'Bearer t1'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(api('/api/data', { schema: okSchema })).resolves.toEqual({ ok: true });
    // 만료된 Bearer 를 갱신에 실으면 서버가 쿠키를 보기 전에 401 로 거절한다.
    expect(refreshAuthorization).toEqual([null]);
    expect(dataAuthorization).toEqual(['Bearer t0', 'Bearer t1']);
    expect(useSessionStore.getState().session?.accessToken).toBe('t1');
  });

  it('갱신한 토큰으로 다시 보낸 요청도 401 이면 세션을 끝낸다', async () => {
    server.use(
      http.post(`${BASE}/api/auth/refresh`, refreshed),
      http.get(`${BASE}/api/data`, () => new HttpResponse(null, { status: 401 })),
    );

    await expect(api('/api/data', { schema: okSchema })).rejects.toMatchObject({ status: 401 });
    expect(useSessionStore.getState().session).toBeUndefined();
  });
});

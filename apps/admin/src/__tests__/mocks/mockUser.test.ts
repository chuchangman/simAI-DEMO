import { readMockUser } from '@/mocks/mockUser';
import { describe, expect, it } from 'vitest';

const base64url = (text: string) =>
  btoa(text).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (claims: object, pad = false) => {
  const payload = base64url(JSON.stringify(claims));
  return `Bearer h.${pad ? payload.padEnd(Math.ceil(payload.length / 4) * 4, '=') : payload}.s`;
};

describe('readMockUser', () => {
  it('mock 로그인 토큰으로 계정을 찾는다(발급 번호가 붙어도)', () => {
    expect(readMockUser('Bearer mock-token.admin')).toEqual({ id: 'admin', role: 'ADMIN' });
    expect(readMockUser('Bearer mock-token.viewer.7')).toEqual({ id: 'viewer', role: 'VIEWER' });
    expect(readMockUser('Bearer mock-token.nobody')).toBeUndefined();
  });

  it('실서버 JWT 는 payload 의 sub·role·exp 를 읽는다(base64url, 패딩 유무와 무관)', () => {
    // ~~~? 는 base64 로 + 나 / 가 나오는 글자라 base64url 변환을 본다.
    const claims = { iss: 'simai', sub: '~~~?', role: 'FOREMAN', exp: 1_800_000_000 };
    const expected = { id: '~~~?', role: 'FOREMAN', expiresAt: 1_800_000_000_000 };
    expect(readMockUser(jwt(claims))).toEqual(expected);
    expect(readMockUser(jwt(claims, true))).toEqual(expected);
    expect(readMockUser(jwt({ sub: '42', role: 'VIEWER' }))).toEqual({ id: '42', role: 'VIEWER' });
  });

  it('형식이 틀리면 사용자를 정하지 않는다', () => {
    for (const header of [
      undefined,
      null,
      '',
      'Bearer',
      'Basic abc',
      'Bearer a.b',
      'Bearer a.b.c.d',
      'Bearer h.!!!.s',
      jwt({ sub: '42', role: 'ROOT' }),
      jwt({ role: 'ADMIN' }),
      jwt({ sub: '42', role: 'ADMIN', exp: 'soon' }),
    ]) {
      expect(readMockUser(header)).toBeUndefined();
    }
  });
});

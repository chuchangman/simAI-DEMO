import { MOCK_ACCOUNTS } from '@/mocks/accounts';
import { type Role, ROLES } from '@/store/session.store';
import { z } from 'zod';

export interface MockUser {
  id: string;
  role: Role;
  /** 만료 시각(ms). 실서버 토큰(JWT)에만 있다. */
  expiresAt?: number;
}

const MOCK_TOKEN_PREFIX = 'mock-token.';

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
  exp: z.number().optional(),
});

/**
 * mock 이 Authorization 헤더로 사용자를 알아낸다.
 * - mock 로그인 토큰: mock-token.{계정 id}[.{발급 번호}]
 * - 실서버 토큰(혼합 모드, VITE_API_REAL=/api/auth): JWT payload 의 sub·role·exp.
 *   서명은 보지 않는다. 개발 mock 전용이고, 토큰은 실서버가 발급·검증한다.
 */
export function readMockUser(authorization: string | null | undefined): MockUser | undefined {
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return undefined;
  if (token.startsWith(MOCK_TOKEN_PREFIX)) {
    const id = token.slice(MOCK_TOKEN_PREFIX.length).split('.')[0];
    const account = MOCK_ACCOUNTS.find((a) => a.id === id);
    return account && { id: account.id, role: account.role };
  }
  const [, payload, ...rest] = token.split('.');
  if (payload === undefined || rest.length !== 1) return undefined;
  const claims = claimsSchema.safeParse(decodeSegment(payload));
  if (!claims.success) return undefined;
  const { sub, role, exp } = claims.data;
  return exp === undefined ? { id: sub, role } : { id: sub, role, expiresAt: exp * 1000 };
}

// base64url(패딩 없음)을 풀어 JSON 으로 읽는다. 깨진 값이면 undefined.
function decodeSegment(segment: string): unknown {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

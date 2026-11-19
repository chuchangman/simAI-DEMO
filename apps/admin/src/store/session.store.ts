import { create } from 'zustand';

/** 계정 역할(명세 14장): 관리자, 반장, 열람. */
export const ROLES = ['ADMIN', 'FOREMAN', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export interface SessionUser {
  id: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  /** access 토큰 만료 시각(ms, 받은 시각 기준). 서버가 유효 시간을 주지 않으면(mock) 없다. */
  expiresAt?: number;
  user: SessionUser;
}

export interface SessionState {
  session?: Session;
  signIn: (session: Session) => void;
  signOut: () => void;
  /**
   * 서버가 거부한 토큰이 지금 세션의 토큰일 때만 세션을 끝낸다.
   * 응답을 기다리는 사이 다시 로그인했으면 새 세션은 그대로 둔다(갱신 쿠키 거부·갱신 뒤에도 REST 401 이 쓴다).
   */
  signOutIfCurrent: (token: string) => void;
}

// access 토큰은 메모리에만 둔다. 새로고침하면 갱신 쿠키(HttpOnly)로 다시 받는다(features/auth/authSession).
export const useSessionStore = create<SessionState>()((set, get) => ({
  session: undefined,
  signIn: (session) => set({ session }),
  signOut: () => set({ session: undefined }),
  signOutIfCurrent: (token) => {
    if (get().session?.accessToken === token) set({ session: undefined });
  },
}));

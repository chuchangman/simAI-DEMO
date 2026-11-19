import { type Session, useSessionStore } from '@/store/session.store';
import { beforeEach, describe, expect, it } from 'vitest';

const session: Session = { accessToken: 'token-1', user: { id: 'u-1', role: 'ADMIN' } };

describe('session.store', () => {
  beforeEach(() => useSessionStore.setState(useSessionStore.getInitialState(), true));

  it('처음에는 로그인하지 않은 상태다', () => {
    expect(useSessionStore.getState().session).toBeUndefined();
  });

  it('로그인하면 세션을 갖고, 로그아웃하면 지운다', () => {
    useSessionStore.getState().signIn(session);
    expect(useSessionStore.getState().session).toEqual(session);

    useSessionStore.getState().signOut();
    expect(useSessionStore.getState().session).toBeUndefined();
  });

  it('거부된 토큰이 지금 토큰일 때만 세션을 끝낸다', () => {
    useSessionStore.getState().signIn(session);
    useSessionStore.getState().signOutIfCurrent('old-token');
    expect(useSessionStore.getState().session).toEqual(session);

    useSessionStore.getState().signOutIfCurrent('token-1');
    expect(useSessionStore.getState().session).toBeUndefined();
  });
});

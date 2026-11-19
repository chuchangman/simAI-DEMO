import type { TargetDraft } from '@/features/zones/zoneEditModel';
import { bindSession } from '@/lib/bindSession';
import type { RealtimeSession } from '@/lib/stomp';
import type { Session } from '@/store/session.store';
import { clearZoneDrafts, useZoneEditStore } from '@/store/zoneEdit.store';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';

const alice: Session = { accessToken: 'a-1', user: { id: 'alice', role: 'ADMIN' } };
const bob: Session = { accessToken: 'b-1', user: { id: 'bob', role: 'VIEWER' } };

function setup(initial?: Session) {
  const log: string[] = [];
  const sessionStore = createStore<{ session?: Session }>()(() => ({ session: initial }));
  let finishInvalidate: () => void = () => {};
  const unbind = bindSession({
    sessionStore,
    realtime: {
      start: ({ userId, getToken }) => log.push(`start ${userId} ${getToken()}`),
      stop: async () => {
        log.push('stop');
      },
    },
    router: {
      invalidate: () => {
        log.push('invalidate');
        return new Promise<void>((resolve) => {
          finishInvalidate = () => resolve();
        });
      },
      clearCache: () => log.push('clearCache'),
    },
    queryClient: { clear: () => log.push('clear') },
  });
  // 가드가 끝난 뒤의 처리(캐시 비우기)가 다 돌 때까지 한 턴 기다린다.
  const settle = async () => {
    finishInvalidate();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { log, sessionStore, unbind, settle };
}

describe('bindSession', () => {
  it('로그인하면 그 토큰으로 연결하고 가드를 다시 돌린다(캐시는 지우지 않는다)', async () => {
    const { log, sessionStore, settle } = setup();
    sessionStore.setState({ session: alice });
    await settle();
    expect(log).toEqual(['start alice a-1', 'invalidate']);
  });

  it('로그아웃하면 연결을 끊고, 가드가 끝난 뒤에 캐시를 지운다', async () => {
    const { log, sessionStore, settle } = setup(alice);
    log.length = 0;
    sessionStore.setState({ session: undefined });
    expect(log).toEqual(['stop', 'clearCache', 'invalidate']);
    await settle();
    expect(log).toEqual(['stop', 'clearCache', 'invalidate', 'clear']);
  });

  it('다른 계정으로 바뀌면 끊고 새 토큰으로 연결한 뒤 캐시를 지운다', async () => {
    const { log, sessionStore, settle } = setup(alice);
    log.length = 0;
    sessionStore.setState({ session: bob });
    await settle();
    expect(log).toEqual(['stop', 'start bob b-1', 'clearCache', 'invalidate', 'clear']);
  });

  it('같은 사람의 토큰만 바뀌면(갱신) 연결도 캐시도 그대로 두고, 연결은 새 토큰을 읽는다', async () => {
    let token: RealtimeSession['getToken'] | undefined;
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    const log: string[] = [];
    bindSession({
      sessionStore,
      realtime: {
        start: ({ getToken }) => {
          token = getToken;
          log.push('start');
        },
        stop: async () => {
          log.push('stop');
        },
      },
      router: {
        invalidate: async () => {
          log.push('invalidate');
        },
        clearCache: () => log.push('clearCache'),
      },
      queryClient: { clear: () => log.push('clear') },
    });
    log.length = 0;

    sessionStore.setState({ session: { ...alice, accessToken: 'a-2' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual([]);
    expect(await token?.()).toBe('a-2');
  });

  it('토큰을 주는 함수를 넘기면 실시간 연결이 그것을 쓴다(만료 전 갱신)', async () => {
    let token: RealtimeSession['getToken'] | undefined;
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    bindSession({
      sessionStore,
      realtime: {
        start: ({ getToken }) => {
          token = getToken;
        },
        stop: async () => {},
      },
      router: { invalidate: async () => {}, clearCache: () => {} },
      queryClient: { clear: () => {} },
      getToken: async () => 'fresh',
    });
    expect(await token?.()).toBe('fresh');
  });

  it('가드가 실패해도 로그아웃이면 캐시를 지운다', async () => {
    const log: string[] = [];
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    bindSession({
      sessionStore,
      realtime: { start: () => {}, stop: async () => {} },
      router: { invalidate: () => Promise.reject(new Error('loader')), clearCache: () => {} },
      queryClient: { clear: () => log.push('clear') },
    });
    sessionStore.setState({ session: undefined });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['clear']);
  });

  it('이미 로그인된 상태로 묶으면 바로 연결하고, 해제하면 더 반응하지 않는다', () => {
    const { log, sessionStore, unbind } = setup(alice);
    expect(log).toEqual(['start alice a-1']);
    unbind();
    sessionStore.setState({ session: undefined });
    expect(log).toEqual(['start alice a-1']);
  });

  it('로그아웃·다른 계정·같은 사람의 권한 변경에서만 사용자 화면 상태를 비우고, 첫 로그인·토큰 갱신에서는 두다', () => {
    const cleared: string[] = [];
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: undefined }));
    bindSession({
      sessionStore,
      realtime: { start: () => {}, stop: async () => {} },
      router: { invalidate: async () => {}, clearCache: () => {} },
      queryClient: { clear: () => {} },
      onUserChange: () => cleared.push('clear'),
    });
    const step = (session: Session | undefined, label: string) => {
      sessionStore.setState({ session });
      cleared.push(label);
    };
    step(alice, 'login');
    step({ ...alice, accessToken: 'a-2' }, 'refresh');
    step({ ...alice, user: { id: 'alice', role: 'VIEWER' } }, 'role');
    step(bob, 'account');
    step(undefined, 'logout');
    expect(cleared).toEqual([
      'login',
      'refresh',
      'clear',
      'role',
      'clear',
      'account',
      'clear',
      'logout',
    ]);
  });

  it('앱이 넘기는 clearZoneDrafts 로 묶으면 실제 구역 초안 저장소가 로그아웃에서 비고 토큰 갱신에서는 남는다', () => {
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    bindSession({
      sessionStore,
      realtime: { start: () => {}, stop: async () => {} },
      router: { invalidate: async () => {}, clearCache: () => {} },
      queryClient: { clear: () => {} },
      onUserChange: clearZoneDrafts,
    });
    const draft: TargetDraft = { patch: {}, box: null };
    useZoneEditStore.setState({ drafts: { 'z-04': draft } });

    sessionStore.setState({ session: { ...alice, accessToken: 'a-2' } });
    expect(useZoneEditStore.getState().drafts).toEqual({ 'z-04': draft });
    sessionStore.setState({ session: undefined });
    expect(useZoneEditStore.getState().drafts).toEqual({});
  });

  it('토큰 갱신 함수를 실시간 연결에 그대로 넘긴다(ERROR 로 거절되면 연결이 갱신한다)', () => {
    const started: RealtimeSession[] = [];
    const refreshToken = async () => 'a-2';
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: undefined }));
    bindSession({
      sessionStore,
      realtime: { start: (session) => started.push(session), stop: async () => {} },
      router: { invalidate: async () => {}, clearCache: () => {} },
      queryClient: { clear: () => {} },
      refreshToken,
    });
    sessionStore.setState({ session: alice });
    sessionStore.setState({ session: bob });
    expect(started.map((s) => s.refreshToken)).toEqual([refreshToken, refreshToken]);
  });

  it('같은 사람의 권한만 바뀌면 연결을 다시 열지 않는다', () => {
    const log: string[] = [];
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    bindSession({
      sessionStore,
      realtime: {
        start: () => log.push('start'),
        stop: async () => {
          log.push('stop');
        },
      },
      router: { invalidate: async () => {}, clearCache: () => {} },
      queryClient: { clear: () => {} },
    });

    sessionStore.setState({ session: { ...alice, user: { id: 'alice', role: 'FOREMAN' } } });
    expect(log).toEqual(['start']);
  });
});

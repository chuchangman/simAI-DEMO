import {
  latestStageStart,
  mergeEvent,
  withoutCleared,
  type EventEntry,
} from '@/features/events/entries';
import {
  EVENT_CLEAR_KEY,
  resetEventClear,
  useClearedAt,
  useEventClearStore,
} from '@/features/events/eventClear.store';
import type { EventItem } from '@/features/events/types';
import { useSessionStore } from '@/store/session.store';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

function item(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'HIGH',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-1'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const entry = (change: Partial<EventItem> = {}): EventEntry => mergeEvent(undefined, item(change));

const ack = (at: number) => ({
  ack_id: `a-${at}`,
  channel: 'CONTROL_ROOM',
  actor_role: 'ADMIN',
  actor_id: 'admin',
  acked_at: at,
});

const noTimeEntry = (): EventEntry => ({
  event: item({ raised_at: undefined, updated_at: undefined }),
  stageStartedAt: null,
});

const signInAs = (id: string) =>
  useSessionStore.getState().signIn({ accessToken: 't', user: { id, role: 'ADMIN' } });

const NEVER = { clearedAt: null, clearedBy: null };

describe('useEventClearStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEventClearStore.setState(NEVER);
    signInAs('u-1');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('처음에는 지운 적이 없다', () => {
    expect(useEventClearStore.getState()).toMatchObject(NEVER);
  });

  it('모두 지우면 이벤트 시각과 지운 사용자를 기억하고 브라우저에 남긴다', () => {
    useEventClearStore.getState().clearAll(T + 5_000);
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T + 5_000, clearedBy: 'u-1' });
    expect(JSON.parse(localStorage.getItem(EVENT_CLEAR_KEY) ?? '{}').state).toEqual({
      clearedAt: T + 5_000,
      clearedBy: 'u-1',
    });
  });

  it('다시 지우면 새 기준으로 바뀌고, 다른 사용자가 지우면 그 사용자 것이 된다', () => {
    useEventClearStore.getState().clearAll(T + 5_000);
    useEventClearStore.getState().clearAll(T + 9_000);
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T + 9_000, clearedBy: 'u-1' });

    signInAs('u-2');
    useEventClearStore.getState().clearAll(T + 2_000);
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T + 2_000, clearedBy: 'u-2' });
  });

  it('미래 시각 이벤트로 지워도 기준은 지금을 넘지 않아 그 뒤 경보를 숨기지 않는다', () => {
    vi.useFakeTimers({ now: T + 60_000 });
    try {
      useEventClearStore.getState().clearAll(T + 3_600_000);
      expect(useEventClearStore.getState().clearedAt).toBe(T + 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('남아 있던 미래 시각 기준도 되살릴 때 지금으로 낮춘다', async () => {
    vi.useFakeTimers({ now: T + 60_000, toFake: ['Date'] });
    try {
      localStorage.setItem(
        EVENT_CLEAR_KEY,
        JSON.stringify({ state: { clearedAt: T + 3_600_000, clearedBy: 'u-1' }, version: 0 }),
      );
      await useEventClearStore.persist.rehydrate();
      expect(useEventClearStore.getState().clearedAt).toBe(T + 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('로그인한 사용자가 없으면 아무것도 하지 않는다', () => {
    useSessionStore.getState().signOut();
    useEventClearStore.getState().clearAll(T);
    expect(useEventClearStore.getState()).toMatchObject(NEVER);
  });

  it('새로고침하면 남은 기록을 되살린다', async () => {
    localStorage.setItem(
      EVENT_CLEAR_KEY,
      JSON.stringify({ state: { clearedAt: T, clearedBy: 'u-1' }, version: 0 }),
    );
    await useEventClearStore.persist.rehydrate();
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T, clearedBy: 'u-1' });
  });

  it('남은 값이 (시각, 사용자) 한 쌍이 아니거나 깨졌으면 지운 적 없는 것으로 시작한다', async () => {
    for (const saved of [
      JSON.stringify({ state: { clearedAt: 'now', clearedBy: 'u-1' }, version: 0 }),
      JSON.stringify({ state: { clearedAt: null, clearedBy: null }, version: 0 }),
      JSON.stringify({ state: { clearedAt: T }, version: 0 }),
      JSON.stringify({ state: { clearedAt: T, clearedBy: '' }, version: 0 }),
      JSON.stringify({ state: { clearedAt: T, clearedBy: 7 }, version: 0 }),
      JSON.stringify({ state: { clearedBy: 'u-1' }, version: 0 }),
      JSON.stringify({ state: 7, version: 0 }),
      '{not json',
    ]) {
      useEventClearStore.setState({ clearedAt: T, clearedBy: 'u-1' });
      localStorage.setItem(EVENT_CLEAR_KEY, saved);
      await useEventClearStore.persist.rehydrate();
      expect(useEventClearStore.getState(), saved).toMatchObject(NEVER);
    }
  });

  it('로그아웃·계정 전환에서 부르는 초기화는 메모리와 브라우저 기록을 모두 비운다', () => {
    useEventClearStore.getState().clearAll(T);
    resetEventClear();
    expect(useEventClearStore.getState()).toMatchObject(NEVER);
    expect(JSON.parse(localStorage.getItem(EVENT_CLEAR_KEY) ?? '{}').state).toEqual(NEVER);
  });

  it('브라우저에 저장할 수 없어도 메모리에서는 지운 기록을 갖는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => useEventClearStore.getState().clearAll(T)).not.toThrow();
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T, clearedBy: 'u-1' });
  });
});

describe('useClearedAt', () => {
  beforeEach(() => {
    localStorage.clear();
    useEventClearStore.setState({ clearedAt: T, clearedBy: 'u-1' });
    signInAs('u-1');
  });
  afterEach(() => {
    useEventClearStore.setState(NEVER);
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('지운 사용자가 로그인해 있으면 지운 시각을 준다', () => {
    const { result } = renderHook(() => useClearedAt());
    expect(result.current).toBe(T);
  });

  it('다른 사용자로 로그인하면 이전 사용자의 지움을 적용하지 않고, 돌아오면 다시 적용한다', () => {
    const { result } = renderHook(() => useClearedAt());

    act(() => signInAs('u-2'));
    expect(result.current).toBeNull();

    act(() => signInAs('u-1'));
    expect(result.current).toBe(T);
  });

  it('로그인한 사용자가 없으면 적용하지 않는다', () => {
    const { result } = renderHook(() => useClearedAt());
    act(() => useSessionStore.getState().signOut());
    expect(result.current).toBeNull();
  });

  it('지운 적이 없으면 null 이다', () => {
    useEventClearStore.setState(NEVER);
    const { result } = renderHook(() => useClearedAt());
    expect(result.current).toBeNull();
  });
});

describe('withoutCleared', () => {
  it('지운 적이 없으면 받은 배열을 그대로 돌려준다', () => {
    const entries = [entry()];
    expect(withoutCleared(entries, null)).toBe(entries);
  });

  it('지운 시각까지 시작된 이벤트를 숨긴다(같은 시각도 숨긴다)', () => {
    const before = entry({ event_id: 'e-old', raised_at: T - 1_000, updated_at: T - 1_000 });
    const same = entry({ event_id: 'e-same', raised_at: T, updated_at: T });
    expect(withoutCleared([before, same], T)).toEqual([]);
  });

  it('지운 뒤에 생긴 이벤트는 남기고 앞선 것만 숨긴다', () => {
    const old = entry({ event_id: 'e-old' });
    const fresh = entry({ event_id: 'e-new', raised_at: T + 1_000, updated_at: T + 1_000 });
    expect(withoutCleared([old, fresh], T)).toEqual([fresh]);
  });

  it('숨긴 뒤에 등급이 올라 새 단계가 열린 이벤트는 다시 보인다', () => {
    const cleared = entry({ severity: 'HIGH' });
    expect(withoutCleared([cleared], T + 500)).toEqual([]);

    const promoted = mergeEvent(
      cleared,
      item({
        event_sequence: 2,
        lifecycle: 'UPDATED',
        severity: 'CRITICAL',
        updated_at: T + 1_000,
      }),
    );
    expect(promoted.stageStartedAt).toBe(T + 1_000);
    expect(withoutCleared([promoted], T + 500)).toEqual([promoted]);
  });

  it('숨긴 뒤에 다시 열린(재개된) 이벤트는 다시 보인다', () => {
    const resolved = entry({ lifecycle: 'RESOLVED', resolved_at: T });
    expect(withoutCleared([resolved], T + 500)).toEqual([]);

    const resumed = mergeEvent(
      resolved,
      item({ event_sequence: 2, lifecycle: 'UPDATED', resume_count: 1, updated_at: T + 1_000 }),
    );
    expect(withoutCleared([resumed], T + 500)).toEqual([resumed]);
  });

  it('같은 단계가 갱신만 되면 숨긴 채로 둔다', () => {
    const cleared = entry();
    const updated = mergeEvent(
      cleared,
      item({ event_sequence: 2, lifecycle: 'UPDATED', updated_at: T + 1_000 }),
    );
    expect(updated.stageStartedAt).toBe(T);
    expect(withoutCleared([updated], T + 500)).toEqual([]);
  });

  it('단계 시작 기록이 없으면 마지막 갱신 시각으로 판단하고, 시각을 전혀 모르면 숨기지 않는다', () => {
    const noStage: EventEntry = { ...entry(), stageStartedAt: null };
    expect(withoutCleared([noStage], T)).toEqual([]);
    expect(withoutCleared([noStage], T - 1_000)).toEqual([noStage]);

    const noTime = noTimeEntry();
    expect(withoutCleared([noTime], T)).toEqual([noTime]);
  });

  it('숨길 것이 없으면 받은 배열을 그대로 돌려주고, 숨기면 새 배열을 돌려준다', () => {
    const fresh = entry({ raised_at: T + 1_000, updated_at: T + 1_000 });
    const entries = [fresh];
    expect(withoutCleared(entries, T)).toBe(entries);
    expect(withoutCleared([entry(), fresh], T)).not.toBe(entries);
  });
});

describe('withoutCleared 해소된 이벤트', () => {
  // 새로고침: REST 로 처음 받은 해소 이벤트는 확인 이력이 있어 단계 시작이 마지막 갱신 시각으로 잡힌다.
  const refreshed = (change: Partial<EventItem> = {}) =>
    entry({
      lifecycle: 'RESOLVED',
      raised_at: T - 1_000,
      updated_at: T + 5_000,
      resolved_at: T + 5_000,
      acks: [ack(T + 2_000)],
      ...change,
    });

  it('새로고침으로 다시 받아 단계 시작이 갱신 시각이 돼도 발생 시각으로 판단해 숨긴다', () => {
    const resolved = refreshed();
    expect(resolved.stageStartedAt).toBe(T + 5_000);
    expect(withoutCleared([resolved], T)).toEqual([]);
  });

  it('진행 중인 이벤트의 판단은 그대로 단계 시작이다(같은 모양이어도 다시 보인다)', () => {
    const active = refreshed({ lifecycle: 'UPDATED', resolved_at: null });
    expect(withoutCleared([active], T)).toEqual([active]);
  });

  it('지운 뒤에 발생한 해소 이벤트는 보인다', () => {
    const resolved = refreshed({ raised_at: T + 1_000 });
    expect(withoutCleared([resolved], T)).toEqual([resolved]);
  });

  it('발생 시각을 모르면 단계 시작으로 판단한다', () => {
    const resolved = refreshed({ raised_at: undefined });
    expect(withoutCleared([resolved], T + 5_000)).toEqual([]);
    expect(withoutCleared([resolved], T + 4_999)).toEqual([resolved]);
  });

  it('세션 중에 지운 목록은 새로고침 뒤 같은 이벤트를 다시 받아도 숨어 있다', () => {
    const raised = entry({ raised_at: T - 1_000, updated_at: T - 1_000 });
    const resolvedInSession = mergeEvent(
      raised,
      item({
        event_sequence: 2,
        lifecycle: 'RESOLVED',
        raised_at: T - 1_000,
        updated_at: T + 5_000,
        resolved_at: T + 5_000,
        acks: [ack(T + 2_000)],
      }),
    );
    const clearedAt = latestStageStart([resolvedInSession]);
    expect(withoutCleared([resolvedInSession], clearedAt)).toEqual([]);

    expect(withoutCleared([refreshed()], clearedAt)).toEqual([]);
  });
});

describe('latestStageStart', () => {
  it('목록이 비었거나 시각을 아는 이벤트가 없으면 null 이다', () => {
    expect(latestStageStart([])).toBeNull();
    expect(latestStageStart([noTimeEntry()])).toBeNull();
  });

  it('진행 중인 이벤트는 단계 시작 중 가장 늦은 것을 준다', () => {
    const early = entry({ event_id: 'e-early' });
    const late = entry({ event_id: 'e-late', raised_at: T + 3_000, updated_at: T + 3_000 });
    const promoted = mergeEvent(
      early,
      item({
        event_sequence: 2,
        lifecycle: 'UPDATED',
        severity: 'CRITICAL',
        updated_at: T + 9_000,
      }),
    );
    expect(latestStageStart([early, late])).toBe(T + 3_000);
    expect(latestStageStart([promoted, late])).toBe(T + 9_000);
  });

  it('해소된 이벤트는 발생 시각을 준다', () => {
    const resolved = entry({
      lifecycle: 'RESOLVED',
      raised_at: T,
      updated_at: T + 8_000,
      resolved_at: T + 8_000,
      acks: [ack(T + 2_000)],
    });
    expect(latestStageStart([resolved])).toBe(T);
  });

  it('시각을 모르는 이벤트는 무시한다', () => {
    expect(latestStageStart([noTimeEntry(), entry()])).toBe(T);
  });

  it('이 시각으로 지우면 지금 목록이 모두 숨고 그 뒤 이벤트는 보인다', () => {
    const entries = [
      entry({ event_id: 'e-1' }),
      entry({ event_id: 'e-2', raised_at: T + 4_000, updated_at: T + 4_000 }),
      entry({
        event_id: 'e-3',
        lifecycle: 'RESOLVED',
        raised_at: T + 2_000,
        updated_at: T + 9_000,
        resolved_at: T + 9_000,
      }),
    ];
    const clearedAt = latestStageStart(entries);
    expect(withoutCleared(entries, clearedAt)).toEqual([]);

    const fresh = entry({ event_id: 'e-4', raised_at: T + 4_001, updated_at: T + 4_001 });
    expect(withoutCleared([...entries, fresh], clearedAt)).toEqual([fresh]);
  });
});

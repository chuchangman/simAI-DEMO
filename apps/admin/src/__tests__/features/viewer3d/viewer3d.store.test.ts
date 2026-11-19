import { MERGE_CARRY_GRACE_MS } from '@/features/viewer3d/data/identityCarry';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WORKER = { type: 'person', id: 'w-1' } as const;
const ZONE = { type: 'zone', id: 'z-1' } as const;

function readyStore() {
  const store = createViewerStore();
  store.getState().markReady();
  store.getState().registerTarget(WORKER);
  store.getState().registerTarget(ZONE);
  return store;
}

describe('createViewerStore', () => {
  it('처음에는 준비 중이고 LIVE 모드다', () => {
    const state = createViewerStore().getState();
    expect(state.phase).toBe('initializing');
    expect(state.mode).toBe('LIVE');
    expect(state.selected).toBeNull();
    expect(createViewerStore('REPLAY').getState().mode).toBe('REPLAY');
  });

  it('장면에 있는 대상을 고르고 풀며, 같은 대상을 다시 골라도 상태를 바꾸지 않는다', () => {
    const store = readyStore();
    expect(store.getState().select({ type: 'person', id: 'w-1' })).toEqual({ ok: true });
    const selected = store.getState().selected;
    expect(selected).toEqual(WORKER);

    store.getState().select({ type: 'person', id: 'w-1' });
    expect(store.getState().selected).toBe(selected);

    expect(store.getState().clearSelection()).toEqual({ ok: true });
    expect(store.getState().selected).toBeNull();
  });

  it('모양이 틀린 대상은 INVALID_TARGET, 장면에 없는 대상은 NOT_FOUND 로 거절하고 선택을 유지한다', () => {
    const store = readyStore();
    store.getState().select(ZONE);
    const invalid = [
      null,
      'w-1',
      {},
      { type: 'person' },
      { type: 'person', id: ' ' },
      { type: 'tbm', id: 'x' },
    ];
    for (const input of invalid) {
      expect(store.getState().select(input)).toEqual({ ok: false, reason: 'INVALID_TARGET' });
      expect(store.getState().focusOn(input)).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    }
    expect(store.getState().select({ type: 'person', id: 'w-404' })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(store.getState().focusOn({ type: 'object', id: 'w-1' })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(store.getState().selected).toEqual(ZONE);
  });

  it('렌더러가 준비되기 전과 오류 상태에서는 대상 명령을 NOT_READY 로 거절한다', () => {
    const store = createViewerStore();
    store.getState().registerTarget(WORKER);
    expect(store.getState().select(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });
    expect(store.getState().focusOn(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });

    store.getState().markReady();
    store.getState().markError({ code: 'CONTEXT_LOST', message: 'lost' });
    expect(store.getState().phase).toBe('error');
    expect(store.getState().select(WORKER)).toEqual({ ok: false, reason: 'NOT_READY' });
    expect(store.getState().clearSelection()).toEqual({ ok: true });

    // 컨텍스트가 돌아오면 다시 받는다.
    store.getState().markReady();
    expect(store.getState().error).toBeNull();
    expect(store.getState().select(WORKER)).toEqual({ ok: true });
  });

  it('초점 요청은 같은 대상이어도 매번 새 요청으로 남긴다', () => {
    const store = readyStore();
    store.getState().focusOn(WORKER);
    const first = store.getState().focus;
    store.getState().focusOn(WORKER);
    expect(store.getState().focus).not.toBe(first);
    expect(store.getState().focus?.target).toEqual(WORKER);
  });

  it('모드는 세 값만 받고 오류 상태에서도 바꿀 수 있다', () => {
    const store = createViewerStore();
    expect(store.getState().setMode('PLANNED')).toEqual({ ok: true });
    expect(store.getState().mode).toBe('PLANNED');
    expect(store.getState().setMode('WHAT_IF')).toEqual({ ok: false, reason: 'INVALID_MODE' });
    expect(store.getState().mode).toBe('PLANNED');

    store.getState().markError({ code: 'RENDER_FAILED', message: 'x' });
    expect(store.getState().setMode('REPLAY')).toEqual({ ok: true });
    expect(store.getState().mode).toBe('REPLAY');
  });

  it('장면에서 빠진 대상의 선택·초점을 지우고, 같은 키가 겹쳐 등록되면 마지막이 빠질 때만 지운다', () => {
    const store = readyStore();
    store.getState().registerTarget(WORKER);
    store.getState().select(WORKER);
    store.getState().focusOn(WORKER);

    store.getState().unregisterTarget(WORKER);
    expect(store.getState().selected).toEqual(WORKER);

    store.getState().unregisterTarget(WORKER);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().focus).toBeNull();
    expect(store.getState().select(WORKER)).toEqual({ ok: false, reason: 'NOT_FOUND' });

    // 등록되지 않은 대상을 빼도 다른 상태를 건드리지 않는다.
    store.getState().select(ZONE);
    store.getState().unregisterTarget({ type: 'object', id: 'none' });
    expect(store.getState().selected).toEqual(ZONE);
  });
});

describe('ID 병합 승계(-661)', () => {
  const SURVIVOR = { type: 'person', id: 'w-0' } as const;
  afterEach(() => vi.useRealTimers());

  function mergedStore() {
    const store = readyStore();
    store.getState().registerTarget(SURVIVOR);
    store.getState().select(WORKER);
    store.getState().focusOn(WORKER);
    return store;
  }

  it('사라지는 사람 ID 가 이미 생존 트랙의 별칭이면 선택·초점을 그 사람으로 옮긴다', () => {
    const store = mergedStore();
    store.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    store.getState().unregisterTarget(WORKER);
    expect(store.getState().selected).toEqual(SURVIVOR);
    expect(store.getState().focus?.target).toEqual(SURVIVOR);
  });

  it('별칭이 유예 시간 안에 늦게 오면 그때 옮기고, 지나면 비운 채로 둔다', () => {
    vi.useFakeTimers();
    const store = mergedStore();
    store.getState().unregisterTarget(WORKER);
    expect(store.getState().selected).toBeNull();
    vi.advanceTimersByTime(MERGE_CARRY_GRACE_MS - 1);
    store.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    expect(store.getState().selected).toEqual(SURVIVOR);
    expect(store.getState().focus?.target).toEqual(SURVIVOR);

    const late = mergedStore();
    late.getState().unregisterTarget(WORKER);
    vi.advanceTimersByTime(MERGE_CARRY_GRACE_MS + 1);
    late.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    expect(late.getState().selected).toBeNull();
  });

  it('기다리는 동안 다른 대상을 고르거나 선택을 풀면 옮기지 않는다', () => {
    const store = mergedStore();
    store.getState().unregisterTarget(WORKER);
    store.getState().select(ZONE);
    store.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    expect(store.getState().selected).toEqual(ZONE);

    const cleared = mergedStore();
    cleared.getState().unregisterTarget(WORKER);
    cleared.getState().clearSelection();
    cleared.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    expect(cleared.getState().selected).toBeNull();
    expect(cleared.getState().focus).toBeNull();
  });

  it('생존 트랙이 장면에 아직 없으면 등록될 때 옮기고, 별칭이 아닌 사람은 지금처럼 비운다', () => {
    const store = readyStore();
    store.getState().select(WORKER);
    store.getState().setPersonAliases(new Map([['w-1', 'w-0']]));
    store.getState().unregisterTarget(WORKER);
    expect(store.getState().selected).toBeNull();
    store.getState().registerTarget(SURVIVOR);
    expect(store.getState().selected).toEqual(SURVIVOR);

    const other = mergedStore();
    other.getState().setPersonAliases(new Map([['w-9', 'w-0']]));
    other.getState().unregisterTarget(WORKER);
    expect(other.getState().selected).toBeNull();
    expect(other.getState().focus).toBeNull();
  });
});

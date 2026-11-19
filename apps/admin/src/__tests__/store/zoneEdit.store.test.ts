import type { WorkSurface } from '@/features/surfaces/types';
import {
  surfaceDraftOf,
  withoutUnchangedSurface,
  type TargetDraft,
} from '@/features/zones/zoneEditModel';
import {
  dropZoneDraftName,
  HISTORY_LIMIT,
  lastZoneRecord,
  useHasZoneDrafts,
  useZoneEditStore,
} from '@/store/zoneEdit.store';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const named = (name: string): TargetDraft => ({ patch: { name }, box: null });
const EMPTY: TargetDraft = { patch: {}, box: null };
const SAVED_SURFACE: WorkSurface = {
  objectId: 'ws-1',
  version: 1,
  name: '단상',
  geometry: { centerXy: [7, 2.5], sizeXy: [1, 1], yawRad: 0, topHeightM: 0.4 },
  sigma: null,
  zoneId: 'z-1',
  validFrom: 1,
  workId: null,
  layoutId: null,
  layoutItemId: null,
};

/** 화면이 고칠 때와 같은 순서: 단계를 남기고 초안을 고친다. */
function edit(key: string, name: string, group?: string) {
  const store = useZoneEditStore.getState();
  store.record(key, group);
  store.update(key, () => named(name));
}

const drafts = () => useZoneEditStore.getState().drafts;
const steps = (key: string) => useZoneEditStore.getState().history[key]?.length ?? 0;
const undo = (key: string) => useZoneEditStore.getState().undo(key);

describe('zoneEdit.store 되돌리기', () => {
  beforeEach(() => useZoneEditStore.setState(useZoneEditStore.getInitialState(), true));

  it('고칠 때마다 한 단계씩 쌓고, 되돌리면 그 직전 초안으로 돌아간다', () => {
    edit('z-1', 'a');
    edit('z-1', 'b');
    expect(steps('z-1')).toBe(2);

    expect(undo('z-1')).toBe(true);
    expect(drafts()['z-1']).toEqual(named('a'));
    expect(steps('z-1')).toBe(1);
  });

  it('초안이 없던 때로 되돌리면 초안을 지운다. 더 되돌릴 것이 없으면 false 이고 아무것도 바뀌지 않는다', () => {
    edit('z-1', 'a');
    expect(undo('z-1')).toBe(true);
    expect(drafts()).toEqual({});
    expect(useZoneEditStore.getState().history).toEqual({});

    expect(undo('z-1')).toBe(false);
    expect(drafts()).toEqual({});
  });

  it('구역(키)마다 따로 쌓는다', () => {
    edit('z-1', 'a');
    edit('z-2', 'b');
    edit('z-2', 'c');

    expect(undo('z-2')).toBe(true);
    expect(drafts()['z-2']).toEqual(named('b'));
    expect(drafts()['z-1']).toEqual(named('a'));
    expect(steps('z-1')).toBe(1);
  });

  it('직전 단계와 묶음 이름이 같으면 새 단계를 쌓지 않고 한 단계로 묶는다', () => {
    edit('z-1', 'a', 'name');
    edit('z-1', 'ab', 'name');
    edit('z-1', 'abc', 'name');
    expect(steps('z-1')).toBe(1);

    expect(undo('z-1')).toBe(true);
    expect(drafts()).toEqual({});
  });

  it('묶음 이름이 다르거나 없으면 다른 고침 사이에서는 묶지 않는다', () => {
    edit('z-1', 'a', 'name');
    edit('z-1', 'a', undefined);
    edit('z-1', 'b', 'name');
    edit('z-1', 'c', 'name');
    expect(steps('z-1')).toBe(3);

    edit('z-2', 'x', 'name');
    expect(steps('z-2')).toBe(1);
  });

  it('마지막 단계를 버리면 초안은 그대로이고 단계만 하나 줄어든다', () => {
    edit('z-1', 'a');
    edit('z-1', 'b');
    useZoneEditStore.getState().discardRecord('z-1');
    expect(steps('z-1')).toBe(1);
    expect(drafts()['z-1']).toEqual(named('b'));

    useZoneEditStore.getState().discardRecord('z-1');
    useZoneEditStore.getState().discardRecord('z-1');
    expect(useZoneEditStore.getState().history).toEqual({});
  });

  it('마지막 단계는 새로 쌓거나 되돌리거나 버리면 달라지고, 기록이 가득 차 개수가 그대로여도 구별된다', () => {
    expect(lastZoneRecord('z-1')).toBeUndefined();
    edit('z-1', 'a');
    const first = lastZoneRecord('z-1');
    expect(first).toBeDefined();
    expect(lastZoneRecord('z-1')).toBe(first);

    edit('z-1', 'b');
    expect(lastZoneRecord('z-1')).not.toBe(first);
    undo('z-1');
    expect(lastZoneRecord('z-1')).toBe(first);
    useZoneEditStore.getState().discardRecord('z-1');
    expect(lastZoneRecord('z-1')).toBeUndefined();

    for (let i = 0; i < HISTORY_LIMIT; i++) edit('z-2', `n${i}`);
    const full = lastZoneRecord('z-2');
    edit('z-2', 'more');
    expect(steps('z-2')).toBe(HISTORY_LIMIT);
    expect(lastZoneRecord('z-2')).not.toBe(full);
  });

  it(`단계는 ${HISTORY_LIMIT}개까지만 남기고 가장 오래된 것부터 버린다`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) edit('z-1', `n${i}`);
    expect(steps('z-1')).toBe(HISTORY_LIMIT);

    for (let i = 0; i < HISTORY_LIMIT; i++) expect(undo('z-1')).toBe(true);
    // 가장 오래된 5단계는 버려져 처음(초안 없음)까지 가지 못한다.
    expect(drafts()['z-1']).toEqual(named('n4'));
    expect(undo('z-1')).toBe(false);
  });

  it('초안을 버리거나 기록을 비우거나 모두 지우면 되돌릴 것이 없다', () => {
    edit('z-1', 'a');
    edit('z-2', 'b');
    edit('z-3', 'c');

    useZoneEditStore.getState().remove('z-1');
    expect(drafts()['z-1']).toBeUndefined();
    expect(undo('z-1')).toBe(false);

    useZoneEditStore.getState().resetHistory('z-2');
    expect(undo('z-2')).toBe(false);
    expect(drafts()['z-2']).toEqual(named('b'));

    useZoneEditStore.getState().clear();
    expect(drafts()).toEqual({});
    expect(useZoneEditStore.getState().history).toEqual({});
  });
});

describe('dropZoneDraftName', () => {
  beforeEach(() => useZoneEditStore.setState(useZoneEditStore.getInitialState(), true));

  it('이름만 고친 초안은 지우고 되돌리기 기록도 비운다', () => {
    edit('z-1', 'a');
    edit('z-1', 'b');
    dropZoneDraftName('z-1');
    expect(drafts()['z-1']).toBeUndefined();
    expect(steps('z-1')).toBe(0);
  });

  it('다른 칸을 고친 초안은 이름 고침만 빼고 남긴다', () => {
    const store = useZoneEditStore.getState();
    store.record('z-1');
    store.update('z-1', () => ({ patch: { name: 'a', severity: 'CRITICAL' }, box: null }));
    dropZoneDraftName('z-1');
    expect(drafts()['z-1']).toEqual({ patch: { severity: 'CRITICAL' }, box: null });
    expect(steps('z-1')).toBe(0);
  });

  it('이름 고침이 없는 초안과 다른 구역의 초안은 건드리지 않는다', () => {
    const store = useZoneEditStore.getState();
    store.record('z-1');
    store.update('z-1', () => ({ patch: { severity: 'CRITICAL' }, box: null }));
    edit('z-2', 'b');
    dropZoneDraftName('z-1');
    expect(steps('z-1')).toBe(1);
    expect(drafts()['z-1']).toEqual({ patch: { severity: 'CRITICAL' }, box: null });
    expect(drafts()['z-2']).toEqual(named('b'));
    dropZoneDraftName('z-9');
    expect(Object.keys(drafts())).toEqual(['z-1', 'z-2']);
  });
});

describe('useHasZoneDrafts', () => {
  beforeEach(() => useZoneEditStore.setState(useZoneEditStore.getInitialState(), true));

  it('초안이 하나라도 있으면 true 이고, 모두 지우면 false 이다', () => {
    const { result } = renderHook(() => useHasZoneDrafts());
    expect(result.current).toBe(false);

    act(() => edit('z-1', 'a'));
    expect(result.current).toBe(true);

    act(() => useZoneEditStore.getState().remove('z-1'));
    expect(result.current).toBe(false);

    act(() => edit('__new__', 'b'));
    expect(result.current).toBe(true);
    act(() => useZoneEditStore.getState().clear());
    expect(result.current).toBe(false);
  });

  it('고친 것이 하나도 없는 초안으로 고치면 그 초안은 지워진다', () => {
    const { result } = renderHook(() => useHasZoneDrafts());
    act(() => edit('z-1', 'a'));
    act(() => void useZoneEditStore.getState().update('z-1', () => ({ patch: {}, box: null })));
    expect(result.current).toBe(false);
  });

  it('작업면만 원래대로 돌려놓은 초안도 지워져 편집 모드를 끌 때 묻지 않는다', () => {
    const { result } = renderHook(() => useHasZoneDrafts());
    const surface = surfaceDraftOf(SAVED_SURFACE);
    act(() => useZoneEditStore.getState().update('z-1', () => ({ patch: {}, box: null, surface })));
    expect(result.current).toBe(true);
    act(() =>
      useZoneEditStore
        .getState()
        .update('z-1', (prev) => withoutUnchangedSurface(prev ?? EMPTY, SAVED_SURFACE)),
    );
    expect(result.current).toBe(false);
  });
});

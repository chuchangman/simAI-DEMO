import {
  ABANDONED_SETUP_KEY,
  useAbandonedSetupStore,
  useIsAbandonedSetupSession,
} from '@/features/setup/abandonedSetup.store';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  useAbandonedSetupStore.setState({ entries: [] });
});

const abandon = (workId: string | number, sessionId: string) =>
  act(() => useAbandonedSetupStore.getState().abandon(workId, sessionId));

describe('「세팅 취소」로 버린 세팅 세션', () => {
  it('버린 작업·세션 쌍만 버린 것으로 본다(작업 ID 는 숫자·문자 모두 같다)', () => {
    const { result, rerender } = renderHook(
      ({ workId, sessionId }: { workId: string | number; sessionId: string | null }) =>
        useIsAbandonedSetupSession(workId, sessionId),
      { initialProps: { workId: '59' as string | number, sessionId: 'sess-a' as string | null } },
    );
    expect(result.current).toBe(false);

    abandon(59, 'sess-a');
    expect(result.current).toBe(true);

    rerender({ workId: '59', sessionId: 'sess-b' });
    expect(result.current).toBe(false);
    rerender({ workId: 60, sessionId: 'sess-a' });
    expect(result.current).toBe(false);
    rerender({ workId: 59, sessionId: null });
    expect(result.current).toBe(false);
  });

  it('같은 작업을 다시 버리면 마지막 세션만 남는다', () => {
    abandon(59, 'sess-a');
    abandon(59, 'sess-b');
    expect(useAbandonedSetupStore.getState().entries).toEqual([['59', 'sess-b']]);
  });

  it('작업 20개까지만 남기고 오래된 것부터 버린다', () => {
    for (let work = 1; work <= 21; work += 1) abandon(work, `sess-${work}`);
    const { entries } = useAbandonedSetupStore.getState();
    expect(entries).toHaveLength(20);
    expect(entries[0]).toEqual(['2', 'sess-2']);
    expect(entries.at(-1)).toEqual(['21', 'sess-21']);
  });

  it('브라우저에 남긴 값을 새로고침 뒤에도 읽고, 깨진 값은 버린 세션이 없는 것으로 본다', async () => {
    abandon(59, 'sess-a');
    const saved = JSON.parse(localStorage.getItem(ABANDONED_SETUP_KEY) ?? '{}') as {
      state?: { entries?: unknown };
    };
    expect(saved.state?.entries).toEqual([['59', 'sess-a']]);

    /** 브라우저에 남은 값이 raw 일 때 새로고침하면 읽히는 목록. */
    const reload = async (raw: string) => {
      localStorage.setItem(ABANDONED_SETUP_KEY, raw);
      await act(() => useAbandonedSetupStore.persist.rehydrate());
      return useAbandonedSetupStore.getState().entries;
    };
    const savedValue = (entries: unknown) => JSON.stringify({ state: { entries }, version: 0 });
    expect(await reload(savedValue([['60', 'sess-b']]))).toEqual([['60', 'sess-b']]);
    expect(await reload(savedValue([['59'], 'x', ['61', 'sess-c']]))).toEqual([['61', 'sess-c']]);
    expect(await reload(savedValue('x'))).toEqual([]);
    expect(await reload('{not json')).toEqual([]);
  });
});

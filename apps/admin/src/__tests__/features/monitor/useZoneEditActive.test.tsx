import { useZoneEditActive } from '@/features/monitor/useZoneEditActive';
import { useSessionStore, type Role } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function signIn(role: Role) {
  useSessionStore.setState({ session: { accessToken: 't', user: { id: role, role } } });
}

beforeEach(() => signIn('ADMIN'));
afterEach(() => {
  cleanup();
  stopZoneEdit();
  useSessionStore.setState({ session: undefined });
});

describe('useZoneEditActive', () => {
  it('관리자일 때만 편집 모드가 켜진 것이다', () => {
    const { result } = renderHook(() => useZoneEditActive());
    expect(result.current).toBe(false);

    act(() => startZoneEdit());
    expect(result.current).toBe(true);

    act(() => signIn('VIEWER'));
    expect(result.current).toBe(false);
    act(() => signIn('FOREMAN'));
    expect(result.current).toBe(false);
  });

  it('끄면 꺼진다', () => {
    const { result } = renderHook(() => useZoneEditActive());
    act(() => startZoneEdit());
    act(() => stopZoneEdit());
    expect(result.current).toBe(false);
  });
});

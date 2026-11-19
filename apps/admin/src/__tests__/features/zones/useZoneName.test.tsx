import { ZONES_KEY } from '@/features/zones/api';
import { useZoneName } from '@/features/zones/useZoneName';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api }));

function setup(seed: boolean) {
  const client = new QueryClient();
  if (seed) client.setQueryData(ZONES_KEY, MOCK_ZONES);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useZoneName', () => {
  it('받아 둔 구역으로 ID 의 이름을 찾고, 모르는 ID 는 null 이다', () => {
    const { wrapper } = setup(true);
    const { result } = renderHook(() => useZoneName(), { wrapper });
    expect(result.current('z-04')).toBe('개구부 구역');
    expect(result.current('z-02')).toBe('단상 구역');
    expect(result.current('z-99')).toBeNull();
  });

  it('여러 곳에서 불러도 같은 응답이면 같은 조회 함수를 돌려준다', () => {
    const { wrapper } = setup(true);
    const { result } = renderHook(() => [useZoneName(), useZoneName(), useZoneName()], { wrapper });
    expect(result.current[1]).toBe(result.current[0]);
    expect(result.current[2]).toBe(result.current[0]);
  });

  it('구역을 받기 전에는 모든 ID 가 null 이고, 요청도 다시 시도하는 타이머도 두지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.mockReset();
      const { wrapper } = setup(false);
      const { result } = renderHook(() => useZoneName(), { wrapper });
      expect(result.current('z-04')).toBeNull();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(api).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('다른 곳(useZones)이 구역을 받아 캐시에 넣으면 이름을 찾는다', async () => {
    const { client, wrapper } = setup(false);
    const { result } = renderHook(() => useZoneName(), { wrapper });
    expect(result.current('z-04')).toBeNull();

    act(() => void client.setQueryData(ZONES_KEY, MOCK_ZONES));
    await waitFor(() => expect(result.current('z-04')).toBe('개구부 구역'));
  });
});

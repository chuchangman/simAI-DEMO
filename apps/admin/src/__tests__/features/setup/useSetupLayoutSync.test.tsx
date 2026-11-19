import { useSetupLayoutSync } from '@/features/setup/useSetupLayoutSync';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: calls.api }));

afterEach(() => {
  cleanup();
  calls.api.mockReset();
});

function renderSync() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSetupLayoutSync(17, 'session-1'), { wrapper });
}

describe('세팅 구역 레이아웃 반영', () => {
  it('세팅을 다시 열면 서버에 기록된 구역을 반영한다', async () => {
    calls.api.mockImplementation(async (_path: string, options: { method?: string }) =>
      options.method === 'PUT' ? { result: 'LINKED' } : ['z-one', 'z-two'],
    );
    renderSync();
    await waitFor(() => expect(calls.api).toHaveBeenCalledTimes(3));
    expect(calls.api.mock.calls.map(([path]) => path)).toEqual([
      '/api/work-units/17/layout/zones',
      '/api/work-units/17/layout/zones/z-one',
      '/api/work-units/17/layout/zones/z-two',
    ]);
  });

  it('반영 실패는 표시하고 같은 구역만 다시 반영한다', async () => {
    let fail = true;
    calls.api.mockImplementation(async (_path: string, options: { method?: string }) => {
      if (options.method !== 'PUT') return ['z-one'];
      if (fail) throw new Error('network');
      return { result: 'LINKED' };
    });
    const view = renderSync();
    await waitFor(() => expect(view.result.current.failure).toBe(true));
    fail = false;
    await act(() => view.result.current.retry());
    expect(view.result.current.failure).toBe(false);
    expect(calls.api.mock.calls.filter(([path]) => path.endsWith('/z-one'))).toHaveLength(2);
  });
});

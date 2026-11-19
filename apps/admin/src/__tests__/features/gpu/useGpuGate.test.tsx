import { GPU_STATUS_KEY } from '@/features/gpu/api';
import { useGpuGate } from '@/features/gpu/useGpuGate';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

let current: Record<string, unknown> | null = null;
const server = setupServer(
  http.get('*/api/gpu/sessions/current', () => HttpResponse.json(current)),
  http.get('*/api/gpu/offers', () =>
    HttpResponse.json({
      provider: 'RUNPOD',
      cloud_type: 'SECURE',
      interruptible: false,
      max_price_per_hour_usd: null,
      gpu_types: [{ gpu_type: 'NVIDIA H100 80GB HBM3', name: 'H100 SXM', memory_gb: 80 }],
      regions: [{ region: 'AP-JP-1', name: 'Asia Japan 1', preferred: true }],
      cells: [
        {
          gpu_type: 'NVIDIA H100 80GB HBM3',
          region: 'AP-JP-1',
          stock: 'HIGH',
          price_per_hour_usd: 2.99,
          within_cap: true,
        },
      ],
      default: { gpu_type: 'NVIDIA H100 80GB HBM3', region: 'AP-JP-1' },
      fetched_at_ms: Date.now(),
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.getState().signOut();
});

const statusOf = (power: string, session: unknown = null) => ({
  session,
  server_time_ms: Date.now(),
  launch: null,
  power,
  stop_block: null,
});

const preparing = {
  session_id: 's-1',
  state: 'ACTIVE',
  stage: 'WEIGHTS',
  stage_reason_code: null,
  provider: 'RUNPOD',
  instance_id: 'pod-1',
  gpu_type: 'NVIDIA H100 80GB HBM3',
  region: 'AP-JP-1',
  price_per_hour_usd: 2.99,
  registered_at_ms: Date.now(),
  elapsed_ms: 0,
  tier0_link: 'DISCONNECTED',
};

function Harness({ onRun }: { onRun: () => void }) {
  const gate = useGpuGate();
  return (
    <>
      <button type="button" onClick={() => gate.guard(onRun)}>
        작업 시작
      </button>
      {gate.dialog}
    </>
  );
}

function renderHarness(onRun: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onRun={onRun} />
    </QueryClientProvider>,
  );
  return client;
}

async function settled(client: QueryClient) {
  await waitFor(() => expect(client.getQueryData(GPU_STATUS_KEY)).toBeDefined());
}

describe('useGpuGate', () => {
  it('GPU 가 연결돼 있으면 바로 한다', async () => {
    current = statusOf('CONNECTED', { ...preparing, stage: 'READY', tier0_link: 'CONNECTED' });
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role: 'ADMIN' } });
    const run = vi.fn();
    const client = renderHarness(run);
    await settled(client);
    act(() => fireEvent.click(screen.getByRole('button', { name: '작업 시작' })));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('꺼져 있으면 경고창(필요한 까닭·약 5~7분)과 [GPU 켜기]·[취소]를 띄우고, 취소하면 하지 않는다', async () => {
    current = statusOf('OFF');
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role: 'ADMIN' } });
    const run = vi.fn();
    const client = renderHarness(run);
    await settled(client);
    act(() => fireEvent.click(screen.getByRole('button', { name: '작업 시작' })));
    const off = screen.getByTestId('gpu-gate-off');
    expect(off.textContent).toContain('GPU가 꺼져 있습니다');
    expect(off.textContent).toContain('세팅과 관제에는 GPU가 필요합니다(약 5~7분)');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'GPU 켜기' })));
    // 켜기 표가 열린다
    expect(await screen.findByRole('button', { name: 'H100 SXM AP-JP-1 켤 수 있음' })).toBeTruthy();
    act(() => fireEvent.click(screen.getByRole('button', { name: '취소' })));
    act(() => fireEvent.click(screen.getByRole('button', { name: '취소' })));
    expect(screen.queryByTestId('gpu-gate-off')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('준비 중이면 단계를 보이며 기다리고, 연결되면 창을 닫고 이어서 한다', async () => {
    current = statusOf('PREPARING', preparing);
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role: 'ADMIN' } });
    const run = vi.fn();
    const client = renderHarness(run);
    await settled(client);
    act(() => fireEvent.click(screen.getByRole('button', { name: '작업 시작' })));
    const wait = screen.getByTestId('gpu-gate-preparing');
    expect(wait.textContent).toContain('GPU 준비 중');
    expect(screen.getByText('가중치').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(run).not.toHaveBeenCalled();

    current = statusOf('CONNECTED', { ...preparing, stage: 'READY', tier0_link: 'CONNECTED' });
    await act(() => client.invalidateQueries({ queryKey: GPU_STATUS_KEY }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('gpu-gate-preparing')).toBeNull();
  });

  it('관리자가 아니면 GPU 상태를 모르므로 막지 않는다', () => {
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role: 'FOREMAN' } });
    const run = vi.fn();
    renderHarness(run);
    act(() => fireEvent.click(screen.getByRole('button', { name: '작업 시작' })));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

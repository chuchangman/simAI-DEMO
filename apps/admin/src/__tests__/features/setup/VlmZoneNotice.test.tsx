import { GPU_STATUS_KEY } from '@/features/gpu/api';
import { setupZoneDraftsKey } from '@/features/setup/api';
import { VlmZoneNotice } from '@/features/setup/VlmZoneNotice';
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
let statusCalls = 0;
const server = setupServer(
  http.get('*/api/gpu/sessions/current', () => {
    statusCalls += 1;
    return HttpResponse.json(current);
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  statusCalls = 0;
  useSessionStore.getState().signOut();
});

const session = (change: Record<string, unknown> = {}) => ({
  session_id: 's-1',
  state: 'ACTIVE',
  stage: 'VLLM',
  stage_reason_code: null,
  stage_detail: 'VLM 가중치·vLLM 기동 대기',
  provider: 'RUNPOD',
  instance_id: 'pod-1',
  gpu_type: 'NVIDIA H100 80GB HBM3',
  region: 'AP-JP-1',
  price_per_hour_usd: 2.99,
  registered_at_ms: Date.now() - 6 * 60_000,
  elapsed_ms: 6 * 60_000,
  tier0_link: 'CONNECTED',
  ...change,
});

const statusOf = (s: unknown, power = 'CONNECTED') => ({
  session: s,
  server_time_ms: Date.now(),
  launch: null,
  power,
  stop_block: null,
});

const signIn = (role: 'ADMIN' | 'VIEWER' = 'ADMIN') =>
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role } });

function renderNotice(active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <VlmZoneNotice active={active} sessionId="ss-1" />
    </QueryClientProvider>,
  );
  return { client, view };
}

async function settled(client: QueryClient) {
  await waitFor(() => expect(client.getQueryData(GPU_STATUS_KEY)).toBeDefined());
}

describe('VlmZoneNotice(S15P31A101-706)', () => {
  it('VLLM 단계면 「AI 모델(VLM) 준비 중입니다」 창과 단계 설명·경과를 띄우고, 직접 구역 만들기로 닫으면 다시 띄우지 않는다', async () => {
    current = statusOf(session());
    signIn();
    const { client } = renderNotice();
    const modal = await screen.findByTestId('vlm-loading');
    expect(modal.textContent).toContain('AI 모델(VLM) 준비 중입니다');
    expect(modal.textContent).toContain('가중치');
    expect(modal.textContent).toContain('VLM 가중치·vLLM 기동 대기');
    expect(modal.textContent).toContain('GPU 켠 뒤 6분');

    act(() => fireEvent.click(screen.getByRole('button', { name: '직접 구역 만들기' })));
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
    await act(() => client.refetchQueries({ queryKey: GPU_STATUS_KEY }));
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
  });

  it('READY 가 되면 창이 저절로 닫히고 AI 구역 초안을 다시 받는다', async () => {
    current = statusOf(session());
    signIn();
    const { client } = renderNotice();
    await screen.findByTestId('vlm-loading');
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    current = statusOf(session({ stage: 'READY', stage_detail: null }));
    await act(() => client.refetchQueries({ queryKey: GPU_STATUS_KEY }));
    await waitFor(() => expect(screen.queryByTestId('vlm-loading')).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: setupZoneDraftsKey('ss-1') });
  });

  it('READY 인데 vLLM 시한 초과면 「AI 초안 없이 직접 구역을 만드세요」를 띄운다', async () => {
    current = statusOf(
      session({
        stage: 'READY',
        stage_detail: 'vLLM 미준비(시한 초과): VLM 근거·보고서 없이 관제',
      }),
    );
    signIn();
    renderNotice();
    const modal = await screen.findByTestId('vlm-timed-out');
    expect(modal.textContent).toContain('AI 초안 없이 직접 구역을 만드세요');
    act(() => fireEvent.click(screen.getByRole('button', { name: '직접 구역 만들기' })));
    expect(screen.queryByTestId('vlm-timed-out')).toBeNull();
  });

  it('VLM 이 이미 준비됐거나 GPU 세션이 없으면(손으로 켠 GPU) 아무것도 띄우지 않는다', async () => {
    current = statusOf(session({ stage: 'READY', stage_detail: null }));
    signIn();
    const ready = renderNotice();
    await settled(ready.client);
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
    expect(screen.queryByTestId('vlm-timed-out')).toBeNull();
    cleanup();

    current = statusOf(null, 'OFF');
    const none = renderNotice();
    await settled(none.client);
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
    expect(screen.queryByTestId('vlm-timed-out')).toBeNull();
  });

  it('관리자가 아니면 상태를 받지 않고 띄우지 않는다', async () => {
    current = statusOf(session());
    signIn('VIEWER');
    renderNotice();
    await new Promise((r) => setTimeout(r, 50));
    expect(statusCalls).toBe(0);
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
  });

  it('구역 단계가 아니면(active=false) 띄우지 않는다', async () => {
    current = statusOf(session());
    signIn();
    const { client } = renderNotice(false);
    await settled(client);
    expect(screen.queryByTestId('vlm-loading')).toBeNull();
  });
});

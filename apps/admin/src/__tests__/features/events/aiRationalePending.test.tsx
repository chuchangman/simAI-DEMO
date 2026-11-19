import { AiPanel } from '@/features/events/EventDetailPanels';
import { mergeEvent } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { GPU_STATUS_KEY } from '@/features/gpu/api';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 관제 중 경보 근거(VLM rationale)가 아직 없을 때 GPU 단계가 VLLM 이면 「AI 근거 준비 중」(S15P31A101-706).
// GPU 상태는 상단바 점이 받아 둔 캐시만 읽는다(이 칸은 새로 요청하지 않는다).

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

afterEach(() => {
  cleanup();
  useSessionStore.getState().signOut();
});

const T = 1_760_342_400_000;

const makeEvent = (change: Partial<EventItem> = {}): EventItem => ({
  event_id: 'ev-1',
  event_sequence: 1,
  rule_id: 'R1',
  source: 'LIVE',
  lifecycle: 'RAISED',
  verification: 'VERIFIED',
  severity: 'CRITICAL',
  confidence: 'HIGH',
  needs_check: false,
  world_ids: ['w-0001'],
  zone_id: 'z-01',
  metrics: {},
  rationale: null,
  proposed_severity: null,
  raised_at: T,
  updated_at: T,
  ...change,
});

const gpuStatus = (stage: string | null) => ({
  status: {
    session:
      stage === null
        ? null
        : {
            session_id: 's-1',
            state: 'ACTIVE',
            stage,
            stage_reason_code: null,
            stage_detail: null,
            provider: 'RUNPOD',
            instance_id: 'pod-1',
            gpu_type: 'NVIDIA H100 80GB HBM3',
            region: 'AP-JP-1',
            price_per_hour_usd: 2.99,
            registered_at_ms: T,
            elapsed_ms: 0,
            tier0_link: 'CONNECTED',
          },
    server_time_ms: T,
    launch: null,
    power: stage === null ? 'OFF' : 'CONNECTED',
    stop_block: null,
  },
  offsetMs: 0,
});

function renderAi(event: EventItem, stage: string | null, role: 'ADMIN' | 'VIEWER' = 'ADMIN') {
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(GPU_STATUS_KEY, gpuStatus(stage));
  render(
    <QueryClientProvider client={client}>
      <AiPanel entries={[mergeEvent(undefined, event)]} />
    </QueryClientProvider>,
  );
  return { client, panel: screen.getByRole('region', { name: 'AI 설명' }) };
}

describe('AI 근거 준비 중(S15P31A101-706)', () => {
  it('LIVE 위험 경보에 근거가 없고 GPU 단계가 VLLM 이면 빈 칸 대신 「AI 근거 준비 중」', () => {
    const { panel } = renderAi(makeEvent(), 'VLLM');
    expect(within(panel).getByText('AI 근거 준비 중')).toBeTruthy();
  });

  it('비관리자(열람)도 받아 둔 상태가 없으니 지금처럼 빈 칸(—)', () => {
    const { panel } = renderAi(makeEvent(), 'VLLM', 'VIEWER');
    expect(within(panel).queryByText('AI 근거 준비 중')).toBeNull();
    expect(within(panel).getByText('—')).toBeTruthy();
  });

  it('READY·세션 없음·근거 있음·위험 아닌 경보는 표시하지 않는다', () => {
    const ready = renderAi(makeEvent(), 'READY');
    expect(within(ready.panel).queryByText('AI 근거 준비 중')).toBeNull();
    cleanup();
    const none = renderAi(makeEvent(), null);
    expect(within(none.panel).queryByText('AI 근거 준비 중')).toBeNull();
    cleanup();
    const withRationale = renderAi(makeEvent({ rationale: '난간 없음' }), 'VLLM');
    expect(within(withRationale.panel).getByText('난간 없음')).toBeTruthy();
    expect(within(withRationale.panel).queryByText('AI 근거 준비 중')).toBeNull();
    cleanup();
    const high = renderAi(makeEvent({ severity: 'HIGH' }), 'VLLM');
    expect(within(high.panel).queryByText('AI 근거 준비 중')).toBeNull();
  });

  it('VLM 이 준비되면(캐시가 READY 로 바뀌면) 표시를 걷는다', () => {
    const { client, panel } = renderAi(makeEvent(), 'VLLM');
    expect(within(panel).getByText('AI 근거 준비 중')).toBeTruthy();
    act(() => client.setQueryData(GPU_STATUS_KEY, gpuStatus('READY')));
    expect(within(panel).queryByText('AI 근거 준비 중')).toBeNull();
  });
});

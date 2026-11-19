import { PPE_POLICY_MISSING_TEXT, PpePolicyNotice } from '@/features/monitor/PpePolicyNotice';
import { BUNDLES_KEY } from '@/features/zones/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 관제 알림 자리의 "PPE 요구 미수신"(명세 7.2 R9, S15P31A101-520). 묶음 목록은 캐시에 넣어 두고 다시 받기는 실패시킨다.
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

afterEach(cleanup);

const T = 1_760_342_400_000;

function bundle(version: string, status: string, ppe?: unknown) {
  return {
    config_version: version,
    issued_at: T,
    status,
    applied_at: status === 'APPLIED' ? T : null,
    items: [],
    ...(ppe === undefined ? {} : { ppe_policy: ppe }),
  };
}

function renderNotice(bundles?: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (bundles) client.setQueryData(BUNDLES_KEY, bundles);
  render(
    <QueryClientProvider client={client}>
      <PpePolicyNotice />
    </QueryClientProvider>,
  );
}

describe('PpePolicyNotice', () => {
  it('적용 중 묶음에 ppe_policy 가 없으면(null) PPE 요구 미수신을 보인다', () => {
    renderNotice([
      bundle('cfg-4', 'PENDING', { helmet: 'REQUIRED', work_id: 1, effective_from_ms: T }),
      bundle('cfg-3', 'APPLIED', null),
    ]);
    expect(screen.getByRole('status').textContent).toContain(PPE_POLICY_MISSING_TEXT);
    expect(screen.getByRole('status').textContent).toContain('안전모·조끼 미착용(R9·R11)');
  });

  it('이전 문서에 vest 가 없으면 조끼만 미판정이라고 보인다', () => {
    renderNotice([
      bundle('cfg-3', 'APPLIED', {
        helmet: 'REQUIRED',
        vest: null,
        work_id: 1,
        effective_from_ms: T,
      }),
    ]);
    expect(screen.getByRole('status').textContent).toContain('조끼 요구 미수신');
    expect(screen.getByRole('status').textContent).toContain('조끼 미착용(R11)');
    expect(screen.getByRole('status').textContent).not.toContain('안전모');
  });

  it.each(['REQUIRED', 'NOT_REQUIRED'])('조끼 요구 %s 이면 미수신 안내가 없다', (requirement) => {
    renderNotice([
      bundle('cfg-3', 'APPLIED', {
        helmet: requirement,
        vest: requirement,
        work_id: requirement === 'REQUIRED' ? 1 : null,
        effective_from_ms: T,
      }),
    ]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('적용 중 묶음에 요구가 있으면 그리지 않는다', () => {
    renderNotice([
      bundle('cfg-3', 'APPLIED', { helmet: 'NOT_REQUIRED', work_id: null, effective_from_ms: T }),
    ]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('묶음 목록·적용 묶음·요약 칸을 모르면 그리지 않는다', () => {
    renderNotice();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    renderNotice([bundle('cfg-3', 'PENDING', null)]);
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    renderNotice([bundle('cfg-3', 'APPLIED')]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

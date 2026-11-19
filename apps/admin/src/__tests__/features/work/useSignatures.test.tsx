import { workSignatureOf } from '@/__tests__/features/work/workFixture';
import type { WorkSignature } from '@/features/work/types';
import { useSignatures } from '@/features/work/useSignatures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 보고서의 서명 목록(useSignatures). 서버 mock(mocks/work.ts)에 기대지 않고 보고서별 서명 응답을 직접 만든다.

let byReport: Record<number, WorkSignature[]>;
let signatureRequests: number[];
const server = setupServer(
  http.get('*/api/reports/tbm/:id/signatures', ({ params }) => {
    const id = Number(params.id);
    signatureRequests.push(id);
    return HttpResponse.json({ items: byReport[id] ?? [] });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  byReport = {};
  signatureRequests = [];
});
afterEach(cleanup);

function setup(reportId: number | null | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSignatures(reportId), { wrapper });
}

describe('useSignatures', () => {
  it('그 보고서의 서명만 주고, 받는 동안은 undefined 다', async () => {
    byReport = {
      2: [workSignatureOf({ signature_id: '20', signer_name: '박반장' })],
      1: [workSignatureOf({ signature_id: '10', signer_name: '김안전' })],
    };
    const { result } = setup(2);
    expect(result.current.data).toBeUndefined();
    expect(result.current.pending).toBe(true);
    await waitFor(() =>
      expect(result.current.data?.map((signature) => signature.signer_name)).toEqual(['박반장']),
    );
    expect(signatureRequests).toEqual([2]);
  });

  it('서명이 없으면 빈 목록이다', async () => {
    const { result } = setup(2);
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('보고서가 없으면 아무것도 묻지 않고 undefined 다', async () => {
    const { result } = setup(null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current).toMatchObject({ data: undefined, pending: false });
    expect(signatureRequests).toEqual([]);
  });
});

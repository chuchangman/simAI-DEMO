import { draftCreateRequest } from '@/features/setup/draftZone';
import { resetSetupFlowStore, useSetupFlowStore } from '@/features/setup/setup.store';
import { zoneDraftItemSchema, type ZoneDraftItem } from '@/features/setup/types';
import { useAcceptZoneDraft } from '@/features/setup/useAcceptZoneDraft';
import { useZones } from '@/features/zones/useZones';
import { buildDefaultZoneDraftItems } from '@/mocks/setup';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

const COMMIT_URL = 'http://api.test/api/zones/commit';
const DRAFTS: ZoneDraftItem[] = buildDefaultZoneDraftItems().map((item) =>
  zoneDraftItemSchema.parse(item),
);
const [OPENING, SURFACE] = DRAFTS as [ZoneDraftItem, ZoneDraftItem];

const server = setupServer();
/** 이 시험에서 서버로 간 구역 저장 요청 본문. */
let commits: unknown[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetSetupFlowStore();
  const objects = createStaticObjectsMock();
  server.resetHandlers(
    ...createZonesMock({ staticObjects: objects.store }).handlers,
    ...objects.handlers,
  );
  commits = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST' && request.url === COMMIT_URL) {
      void request
        .clone()
        .json()
        .then((body) => commits.push(body));
    }
  });
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});

function run(
  drafts: readonly ZoneDraftItem[] = DRAFTS,
  setup?: import('@/features/setup/useSetupLayoutSync').SetupLayoutSync,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ accept: useAcceptZoneDraft(drafts, setup), zones: useZones() }), {
    wrapper,
  });
}

/** 저장 요청에서 publish 를 뺀 본문(초안 계산과 견준다). */
const withoutPublish = (body: unknown) => {
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.publish;
  return rest;
};

describe('useAcceptZoneDraft', () => {
  it('보정이 없어 전송에 실패해도 초안은 한 번 저장하고 원인·재전송 시점·계속 실패할 결과를 알린다', async () => {
    const objects = createStaticObjectsMock();
    const zones = createZonesMock({ staticObjects: objects.store });
    zones.failNextPublish('CURRENT_CALIBRATION_MISSING');
    server.resetHandlers(...zones.handlers, ...objects.handlers);
    const view = run();
    await waitFor(() => expect(view.result.current.zones.zones.length).toBeGreaterThan(0));
    const before = view.result.current.zones.zones.length;
    await act(() => view.result.current.accept.accept(OPENING));
    await waitFor(() => expect(commits).toHaveLength(2));
    expect(commits).toMatchObject([{ publish: true }, { publish: false }]);
    expect(view.result.current.zones.zones).toHaveLength(before + 1);
    expect(view.result.current.accept.acceptedIds).toContain(OPENING.candidate_id);
    expect(view.result.current.accept.failure?.text).toContain('유효한 카메라 보정이 없어요');
    expect(view.result.current.accept.failure?.text).toContain('세팅 완료와 작업 시작 때 다시');
    expect(view.result.current.accept.failure?.text).toContain('완료·시작도 멈추므로');
    await act(() => view.result.current.accept.accept(OPENING));
    expect(commits).toHaveLength(2);
  });

  it('세팅 AI 초안 저장에 세션을 전달하고 발행 후 구역을 반영한다', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const view = run(DRAFTS, { sessionId: 'session-1', sync, retry: vi.fn() });
    await waitFor(() => expect(view.result.current.zones.zones.length).toBeGreaterThan(0));
    await act(() => view.result.current.accept.accept(OPENING));
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).toMatchObject({ setup_session_id: 'session-1', publish: true });
    expect(sync).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledWith(expect.any(String), false);
  });
  it('초안 두 개를 수락하면 저장이 두 번 가고 구역이 둘 다 생기며, 작업면 초안은 작업면도 만든다', async () => {
    const view = run();
    await waitFor(() => expect(view.result.current.zones.zones.length).toBeGreaterThan(0));
    const before = view.result.current.zones.zones.length;

    await act(() => view.result.current.accept.accept(OPENING));
    await act(() => view.result.current.accept.accept(SURFACE));

    await waitFor(() => expect(commits).toHaveLength(2));
    expect(commits.map(withoutPublish)).toEqual([
      draftCreateRequest(OPENING),
      draftCreateRequest(SURFACE),
    ]);
    expect(view.result.current.zones.zones).toHaveLength(before + 2);
    expect(view.result.current.accept.acceptedIds).toEqual([
      OPENING.candidate_id,
      SURFACE.candidate_id,
    ]);
    expect(useSetupFlowStore.getState().zonesCommitted).toBe(true);
  });

  it('보내는 동안 다시 눌러도, 수락한 뒤 다시 눌러도 저장은 한 번이다', async () => {
    server.use(
      http.post(COMMIT_URL, async () => {
        await delay(50);
        return undefined;
      }),
    );
    const view = run();
    await waitFor(() => expect(view.result.current.zones.zones.length).toBeGreaterThan(0));

    await act(async () => {
      const first = view.result.current.accept.accept(OPENING);
      void view.result.current.accept.accept(OPENING);
      void view.result.current.accept.accept(SURFACE);
      await first;
    });
    await act(() => view.result.current.accept.accept(OPENING));

    expect(commits).toHaveLength(1);
    expect(view.result.current.accept.pendingId).toBeNull();
  });

  it('새로 고쳐 수락 기록이 없어도 같은 모양의 구역이 이미 있으면 다시 만들지 않는다', async () => {
    const first = run();
    await waitFor(() => expect(first.result.current.zones.zones.length).toBeGreaterThan(0));
    await act(() => first.result.current.accept.accept(OPENING));
    first.unmount();

    resetSetupFlowStore();
    const again = run();
    await waitFor(() =>
      expect(again.result.current.accept.acceptedIds).toEqual([OPENING.candidate_id]),
    );
    await act(() => again.result.current.accept.accept(OPENING));
    expect(commits).toHaveLength(1);
  });

  it('저장에 실패하면 그 초안에 문구를 남기고 수락하지 않은 채로 둔다', async () => {
    server.use(
      http.post(COMMIT_URL, () => HttpResponse.json({ code: 'INVALID_POLYGON' }, { status: 400 })),
    );
    const view = run();
    await waitFor(() => expect(view.result.current.zones.zones.length).toBeGreaterThan(0));

    await act(() => view.result.current.accept.accept(OPENING));

    expect(view.result.current.accept.failure).toEqual({
      candidateId: OPENING.candidate_id,
      text: expect.any(String),
    });
    expect(view.result.current.accept.failure?.text).not.toBe('');
    expect(view.result.current.accept.acceptedIds).toEqual([]);
    expect(view.result.current.accept.pendingId).toBeNull();
  });
});

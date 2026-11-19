import { createSetupSession, setupSessionKey, setupZonePlanKey } from '@/features/setup/api';
import { emptyZonePlanConfirm } from '@/features/setup/SetupCompleteCard';
import {
  SETUP_COMPLETE_ERROR_TEXT,
  setupCompleteErrorMessage,
} from '@/features/setup/setupErrorMessage';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useCompleteSetup } from '@/features/setup/useCompleteSetup';
import { useSetupSession } from '@/features/setup/useSetupStep1';
import { ZONES_KEY } from '@/features/zones/api';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { problem } from '@/mocks/problem';
import { createSetupMock } from '@/mocks/setup';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 세팅 완료 훅(C17, S15P31A101-615): 저장한 구역 목록이 비었으면 확인하고, 완료를 부르고, 성공·거부를 돌려준다.
// 화면의 완료 단추(구역 단계 아래 오른쪽)는 이 훅의 run 을 부른다.

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

const COMPLETED_AT_MS = 1_800_000_000_000;
const server = setupServer();
let mock: ReturnType<typeof createSetupMock>;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  mock = createSetupMock({ now: () => COMPLETED_AT_MS });
  server.resetHandlers(...mock.handlers);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function sessionAt(status: SetupSessionResponse['status']): Promise<string> {
  const created = await createSetupSession(api, {
    work_unit_id: 1,
    camera_heights_m: { cam_A: 2.4 },
  });
  mock.updateSession(created.setup_session_id, {
    status,
    stage: status,
    calibration_version: 'cal-1',
    preview_scene_version: 'scene-preview-1',
    // 새 모델은 정밀 3D 맵 뒤에만 완료한다(-688). 완료하는 시험은 COMPLETED 로 연다
    scene_version: status === 'COMPLETED' ? 'scene-final-1' : null,
  });
  return created.setup_session_id;
}

/** 세션을 받은 뒤의 훅 결과(세션이 오기 전에는 run 이 아무것도 하지 않는다). */
async function renderCompletion(id: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(
    () => {
      const session = useSetupSession(id, id !== null).data ?? null;
      return { session, completion: useCompleteSetup(session) };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  if (id !== null) await waitFor(() => expect(view.result.current.session).not.toBeNull());
  const run = async () => {
    let done: boolean | undefined;
    await act(async () => {
      done = await view.result.current.completion.run();
    });
    return done;
  };
  return { ...view, client, run };
}

describe('useCompleteSetup', () => {
  it('저장한 구역이 없으면 보관 경고를 묻고, 취소하면 완료하지 않고 false 를 돌려준다', async () => {
    const id = await sessionAt('COMPLETED');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result, run } = await renderCompletion(id);

    expect(await run()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(emptyZonePlanConfirm(null));
    expect(mock.sessions.get(id)?.setup_completed_at_ms ?? null).toBeNull();
    expect(result.current.completion).toMatchObject({ pending: false, error: null, applied: null });
  });

  it('확인하면 완료를 부르고 true 를 돌려주며 적용 결과와 완료한 세션을 남긴다', async () => {
    const id = await sessionAt('COMPLETED');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result, run } = await renderCompletion(id);

    expect(await run()).toBe(true);
    expect(mock.sessions.get(id)?.setup_completed_at_ms).toBe(COMPLETED_AT_MS);
    expect(result.current.completion).toMatchObject({
      pending: false,
      error: null,
      applied: { created: [], updated: [], kept: [], archived: [] },
    });
    // 세션 캐시가 완료한 세션으로 바뀐다
    expect(result.current.session?.setup_completed_at_ms).toBe(COMPLETED_AT_MS);
  });

  it('구역 목록을 저장했으면 묻지 않고 완료한다', async () => {
    const id = await sessionAt('COMPLETED');
    server.use(
      http.get('*/api/setup-sessions/:id/zones', ({ params }) =>
        HttpResponse.json({
          setup_session_id: String(params.id),
          items: [{ zone_id: 'z-1', source: 'MANUAL' }],
          revision: 2,
        }),
      ),
    );
    const confirm = vi.spyOn(window, 'confirm');
    const { run } = await renderCompletion(id);

    expect(await run()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('거부되면 코드별 안내를 error 에 두고 false 를 돌려주며, 다시 시도하면 안내를 지우고 다시 부른다', async () => {
    const id = await sessionAt('COMPLETED');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.post('*/api/setup-sessions/:id/complete', () =>
        problem(409, 'SETUP_ZONE_WORLD_MISMATCH', 'World 좌표가 바뀐 세팅'),
      ),
    );
    const { result, run } = await renderCompletion(id);

    expect(await run()).toBe(false);
    expect(result.current.completion.error).toBe(
      SETUP_COMPLETE_ERROR_TEXT.SETUP_ZONE_WORLD_MISMATCH,
    );
    expect(result.current.completion).toMatchObject({ pending: false, applied: null });
    expect(mock.sessions.get(id)?.setup_completed_at_ms ?? null).toBeNull();

    // 다시 시도: 서버가 받아 주면 안내가 지워지고 성공한다
    server.resetHandlers(...mock.handlers);
    expect(await run()).toBe(true);
    expect(result.current.completion.error).toBeNull();
  });

  it.each(['SETUP_ZONE_STALE', 'SETUP_ALREADY_COMPLETED'])(
    '%s 로 거부되면 구역 목록·관제 구역·세션을 다시 받도록 무효화한다',
    async (code) => {
      const id = await sessionAt('COMPLETED');
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      server.use(
        http.post('*/api/setup-sessions/:id/complete', () => problem(409, code, '서버 안내')),
      );
      const { client, run } = await renderCompletion(id);
      const invalidate = vi.spyOn(client, 'invalidateQueries');

      expect(await run()).toBe(false);
      const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
      expect(keys).toContainEqual(setupZonePlanKey(id));
      expect(keys).toContainEqual(ZONES_KEY);
      expect(keys).toContainEqual(setupSessionKey(id));
    },
  );

  it('그 밖의 거부는 구역 목록을 다시 받지 않는다', async () => {
    const id = await sessionAt('COMPLETED');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.post('*/api/setup-sessions/:id/complete', () =>
        problem(409, 'SETUP_ZONE_WORLD_MISMATCH', '서버 안내'),
      ),
    );
    const { client, run } = await renderCompletion(id);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    expect(await run()).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('구역 목록을 받지 못하면 완료를 부르지 않고 안내와 함께 false 를 돌려준다', async () => {
    const id = await sessionAt('COMPLETED');
    let completeCalls = 0;
    server.use(
      http.get('*/api/setup-sessions/:id/zones', () => problem(500, 'INTERNAL', '서버 오류')),
      http.post('*/api/setup-sessions/:id/complete', () => {
        completeCalls += 1;
        return problem(409, 'X', 'x');
      }),
    );
    const { result, run } = await renderCompletion(id);

    expect(await run()).toBe(false);
    expect(completeCalls).toBe(0);
    expect(result.current.completion.error).toBe(
      setupCompleteErrorMessage(
        new ApiError(500, { code: 'INTERNAL', serverMessage: '서버 오류' }),
      ),
    );
  });

  it('요청하는 동안 pending 이 켜지고 그동안 다시 부르면 아무것도 하지 않는다', async () => {
    const id = await sessionAt('COMPLETED');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(http.post('*/api/setup-sessions/:id/complete', () => delay('infinite')));
    const { result } = await renderCompletion(id);

    act(() => {
      void result.current.completion.run();
    });
    await waitFor(() => expect(result.current.completion.pending).toBe(true));
    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.completion.run();
    });
    expect(second).toBe(false);
  });

  it('세션이 없으면 아무것도 부르지 않고 false 를 돌려준다', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { run } = await renderCompletion(null);
    expect(await run()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

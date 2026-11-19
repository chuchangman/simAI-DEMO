import { createSetupSession, SETUP_SESSION_POLL_MS, setupSessionKey } from '@/features/setup/api';
import { resetSetupFlowStore } from '@/features/setup/setup.store';
import type { UploadQueueDeps } from '@/features/setup/supplementUpload';
import { useSetupSession } from '@/features/setup/useSetupStep1';
import { useSupplementCapture } from '@/features/setup/useSupplementCapture';
import { api } from '@/lib/api';
import { createSetupMock } from '@/mocks/setup';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

const server = setupServer();
let clock = 1_800_000_000_000;
let mock: ReturnType<typeof createSetupMock>;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetSetupFlowStore();
  clock = 1_800_000_000_000;
  mock = createSetupMock({ now: () => clock });
  server.resetHandlers(...mock.handlers);
});
afterEach(() => cleanup());

/** mock 의 서명 주소(같은 출처 /mock-storage/…)로 바로 올린다(jsdom XHR 대신). */
const put: UploadQueueDeps['put'] = async (upload, file, onProgress) => {
  onProgress(50);
  const res = await fetch(`http://api.test${upload.url}`, { method: 'PUT', body: file });
  if (!res.ok) throw new Error(`PUT ${res.status}`);
};
const hash: UploadQueueDeps['hash'] = () => Promise.resolve(null);

async function completedSession(): Promise<string> {
  const created = await createSetupSession(api, {
    work_unit_id: 1,
    camera_heights_m: { cam_A: 2.4 },
  });
  mock.updateSession(created.setup_session_id, {
    status: 'COMPLETED',
    stage: 'COMPLETED',
    progress_pct: 100,
    calibration_version: 'cal-1',
    preview_scene_version: 'scene-preview-1',
    scene_version: 'scene-1',
  });
  return created.setup_session_id;
}

function run(sessionId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const session = useSetupSession(sessionId).data;
      return { session, capture: useSupplementCapture(session, 'FILE_UPLOAD', { put, hash }) };
    },
    { wrapper },
  );
  /**
   * mock 시계를 옮긴 뒤 세션 조회를 바로 한 번 한다. 실제 2초 주기(SETUP_SESSION_POLL_MS)를 기다리면 시험 하나가 주기 두 번에
   * 4 s 넘게 걸려 전체 시험 부하에서 5 s 시간 초과가 났다(S15P31A101-674). 주기 조회 자체는 useSetupSession 시험이 본다.
   */
  const pollNow = () => act(() => client.refetchQueries({ queryKey: setupSessionKey(sessionId) }));
  /** 지금 세션 조회의 주기(ms, 멈췄으면 false). 끝난 세션도 다시 굽는 동안은 계속 조회하는지 본다. */
  const pollInterval = () => {
    const query = client.getQueryCache().find({ queryKey: setupSessionKey(sessionId) })!;
    const interval = query.observers[0]!.options.refetchInterval;
    return typeof interval === 'function' ? interval(query as never) : interval;
  };
  return { ...view, pollNow, pollInterval };
}

const video = (name: string) => new File([new Uint8Array(64)], name, { type: 'video/mp4' });
const photo = (name: string) => new File([new Uint8Array(64)], name, { type: 'image/jpeg' });

describe('맵 보강 촬영 훅 + mock', () => {
  it('올리고 다시 구우면 진행률을 거쳐 반영됨이 되고 세션 맵이 새 버전으로 바뀐다', async () => {
    const id = await completedSession();
    const { result, pollNow, pollInterval } = run(id);
    await waitFor(() => expect(result.current.capture.supplement?.can_upload).toBe(true));
    // 끝난 세션이라 조회를 멈춰 둔다
    expect(pollInterval()).toBe(false);
    expect(result.current.capture.supplement?.rebake_blocked_reason).toBe('NO_MEDIA');

    act(() => result.current.capture.addFiles([video('walk.mp4'), photo('gopro-wide.jpg')]));
    await waitFor(() =>
      expect(result.current.capture.rows.map((r) => [r.name, r.statusText])).toEqual([
        ['walk.mp4', '완료'],
        ['gopro-wide.jpg', '완료'],
      ]),
    );
    expect(result.current.capture.supplement?.media.map((m) => m.source)).toEqual([
      'FILE_UPLOAD',
      'FILE_UPLOAD',
    ]);
    expect(result.current.capture.supplement?.can_rebake).toBe(true);

    act(() => result.current.capture.startRebake());
    await waitFor(() => expect(result.current.capture.rebakeView?.title).toBe('다시 굽기 대기 중'));
    // 다시 굽는 중에는 그 파일을 빼지 못한다
    expect(result.current.capture.rows.every((r) => r.actions.length === 0)).toBe(true);
    // 다시 굽는 동안은 끝난 세션도 2초마다 조회한다(아래 pollNow 는 그 조회를 앞당길 뿐이다)
    expect(pollInterval()).toBe(SETUP_SESSION_POLL_MS);

    clock += 6_500;
    await pollNow();
    await waitFor(() => expect(result.current.capture.rebakeView?.title).toBe('다시 굽는 중 50%'));
    clock += 10_000;
    await pollNow();
    await waitFor(() => expect(result.current.capture.rebakeView?.title).toBe('반영됨'));
    expect(result.current.capture.rebakeView?.media.map((m) => [m.name, m.text])).toEqual([
      ['walk.mp4', '반영됨'],
      ['gopro-wide.jpg', '붙지 않음 · 초광각·어안 렌즈'],
    ]);
    expect(result.current.session?.scene_version).toMatch(/^scene-supplement-/);
    expect(pollInterval()).toBe(false);
  });

  it('사진 두 장뿐이면 원래 맵 유지(사유)로 끝나고 맵 버전은 그대로다', async () => {
    const id = await completedSession();
    const { result, pollNow } = run(id);
    await waitFor(() => expect(result.current.capture.canUpload).toBe(true));
    act(() => result.current.capture.addFiles([photo('a.jpg'), photo('b.jpg')]));
    await waitFor(() => expect(result.current.capture.supplement?.can_rebake).toBe(true));
    act(() => result.current.capture.startRebake());
    await waitFor(() => expect(result.current.capture.rebake?.status).toBe('QUEUED'));
    clock += 20_000;
    await pollNow();
    await waitFor(() => expect(result.current.capture.rebakeView?.title).toBe('원래 맵 유지'));
    expect(result.current.capture.rebakeView?.detail).toBe(
      '고정 카메라 화면과 맞춰진 장면이 너무 적습니다',
    );
    expect(result.current.session?.scene_version).toBe('scene-1');
  });

  it('정식 맵 굽기 중에는 올릴 수 있지만 다시 굽기는 막히고, 빼기·취소가 된다', async () => {
    const created = await createSetupSession(api, {
      work_unit_id: 1,
      camera_heights_m: { cam_A: 2.4 },
    });
    const id = created.setup_session_id;
    mock.updateSession(id, {
      status: 'BAKING_TEXTURE',
      stage: 'BAKING_TEXTURE',
      preview_scene_version: 'scene-preview-1',
    });
    const { result } = run(id);
    await waitFor(() => expect(result.current.capture.canUpload).toBe(true));
    act(() => result.current.capture.addFiles([video('a.mp4')]));
    await waitFor(() => expect(result.current.capture.supplement?.media).toHaveLength(1));
    expect(result.current.capture.supplement?.can_rebake).toBe(false);
    expect(result.current.capture.supplement?.rebake_blocked_reason).toBe('SETUP_JOB_RUNNING');

    const row = result.current.capture.rows[0]!;
    await waitFor(() => expect(result.current.capture.rows[0]?.actions).toEqual(['remove']));
    act(() => result.current.capture.onRowAction(result.current.capture.rows[0]!, 'remove'));
    await waitFor(() => expect(result.current.capture.supplement?.media).toHaveLength(0));
    expect(row.name).toBe('a.mp4');

    // 끝난 세션에서 다시 굽기를 시작한 뒤 취소하면 원래 맵 유지
    mock.updateSession(id, { status: 'COMPLETED', stage: 'COMPLETED', scene_version: 'scene-1' });
    act(() => result.current.capture.addFiles([video('b.mp4')]));
    await waitFor(() => expect(result.current.capture.supplement?.can_rebake).toBe(true));
    act(() => result.current.capture.startRebake());
    await waitFor(() => expect(result.current.capture.rebakeView?.running).toBe(true));
    act(() => result.current.capture.cancelRebake());
    await waitFor(() =>
      expect(result.current.capture.rebakeView?.detail).toBe('다시 굽기를 취소했습니다'),
    );
  });
});

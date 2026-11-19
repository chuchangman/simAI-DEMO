import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import type { Viewer3DProps } from '@/features/viewer3d';
import { createQueryClient } from '@/lib/queryClient';
import { handlers } from '@/mocks/handlers';
import {
  resetMockSceneState,
  setMockSceneQuality,
  setMockSceneRegenerateView,
} from '@/mocks/scenes';
import { useSessionStore } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useLayoutEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    VITE_API_BASE_URL: 'https://scene-regen.invalid',
    VITE_STOMP_URL: 'wss://scene-regen.invalid/ws',
    VITE_CCTV_PREVIEW_URL: 'wss://scene-regen.invalid/ws/cctv',
    VITE_API_MOCK: false,
  },
}));

let currentMockToken = 'mock-token.admin';
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({
      baseUrl: 'https://scene-regen.invalid',
      getToken: () => currentMockToken,
    }),
  };
});

vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));

const ZONES_RAW = { contract: 'DEMO_UNCONFIRMED', zones: [] };
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: ZONES_RAW, failed: false }),
}));

const viewer = { props: null as Viewer3DProps | null };
function FakeViewer(props: Viewer3DProps) {
  const { onStatusChange } = props;
  useLayoutEffect(() => {
    viewer.props = props;
  });
  useLayoutEffect(() => {
    onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null });
  }, [onStatusChange]);
  return <div data-testid="viewer3d" />;
}
const loadViewer = () => Promise.resolve({ default: FakeViewer });

const server = setupServer(...handlers);
const clients: ReturnType<typeof createQueryClient>[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  resetMockSceneState();
  currentMockToken = 'mock-token.admin';
  useSessionStore.setState({
    session: {
      accessToken: 'mock-token.admin',
      expiresAt: Date.now() + 300_000,
      user: { id: '1', role: 'ADMIN' },
    },
  });
});

afterEach(() => {
  cleanup();
  stopZoneEdit();
  clients.splice(0).forEach((client) => client.clear());
  server.resetHandlers();
  resetMockSceneState();
  viewer.props = null;
  vi.useRealTimers();
});

function renderMonitorHost() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SpatialViewportHost loadViewer={loadViewer} eventPanel={true} />
    </QueryClientProvider>,
  );
}

/** 도구 모음의 「맵 재생성」 아이콘 버튼을 눌러 팝오버를 연다. */
const openTool = () => fireEvent.click(screen.getByRole('button', { name: '맵 재생성' }));

describe('실시간 모니터링 화면의 맵 재생성 관리자 도구 (S15P31A101-428)', () => {
  it('VIEWER 역할에게는 맵 재생성 도구를 노출하지 않는다', async () => {
    currentMockToken = 'mock-token.viewer';
    useSessionStore.setState({
      session: {
        accessToken: 'mock-token.viewer',
        expiresAt: Date.now() + 300_000,
        user: { id: '2', role: 'VIEWER' },
      },
    });
    renderMonitorHost();
    await screen.findByTestId('viewer3d');
    // 숨긴 요소까지 보려고 이름(aria-label)으로 직접 찾는다.
    expect(screen.queryByLabelText('맵 재생성')).toBeNull();
  });

  it('구역 편집 중에는 맵 재생성 버튼을 숨기지만 떼지는 않는다', async () => {
    renderMonitorHost();
    await screen.findByTestId('viewer3d');
    expect(screen.getByRole('button', { name: '맵 재생성' })).toBeTruthy();
    act(() => startZoneEdit());
    expect(screen.queryByRole('button', { name: '맵 재생성' })).toBeNull();
    expect(screen.getByLabelText('맵 재생성').hidden).toBe(true);
  });

  describe('진행 중인 요청은 눈에 안 보여도 계속 받는다', () => {
    const IN_PROGRESS_ID = 7;
    const requested: string[] = [];
    const pollCount = () =>
      requested.filter((path) => path === `/api/scenes/regenerate/${IN_PROGRESS_ID}`).length;

    beforeAll(() => {
      server.events.on('request:start', ({ request }) => {
        requested.push(new URL(request.url).pathname);
      });
    });
    beforeEach(() => {
      requested.length = 0;
      vi.useFakeTimers({ shouldAdvanceTime: true });
      resetMockSceneState({ autoAdvanceOnPoll: true });
      setMockSceneRegenerateView({
        request_id: IN_PROGRESS_ID,
        status: 'CAPTURING',
        failure_reason: null,
        scene_version: null,
        reason: null,
        requested_at_ms: Date.now() - 5000,
        updated_at_ms: Date.now(),
      });
    });

    /** 2초 주기 폴링이 count 번 갈 때까지 시간을 보낸다. */
    async function pollUntil(count: number) {
      for (let i = 0; i < 10 && pollCount() < count; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
      }
      await waitFor(() => expect(pollCount()).toBeGreaterThanOrEqual(count));
    }

    it('팝오버를 한 번도 열지 않아도 단계가 따라가 열어 보면 후보가 준비되어 있다', async () => {
      renderMonitorHost();
      await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));

      // 수집 중 → 재구성 중 → 후보 준비됨: 폴링 두 번. 팝오버는 닫혀 있어 상태 표시가 아직 없다.
      await pollUntil(2);
      expect(screen.queryByTestId('scene-regenerate-status')).toBeNull();

      openTool();
      await waitFor(() =>
        expect(screen.getByTestId('scene-regenerate-status').textContent).toContain(
          '새 3D 배경 후보 준비됨',
        ),
      );
    });

    it('구역 편집으로 버튼을 숨겨 둔 동안에도 계속 받는다', async () => {
      renderMonitorHost();
      await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));

      act(() => startZoneEdit());
      expect(screen.queryByRole('button', { name: '맵 재생성' })).toBeNull();
      await pollUntil(2);

      act(() => stopZoneEdit());
      openTool();
      await waitFor(() =>
        expect(screen.getByTestId('scene-regenerate-status').textContent).toContain(
          '새 3D 배경 후보 준비됨',
        ),
      );
    });
  });

  it('ADMIN 역할이 사유와 함께 맵 재생성을 요청하면 2초 폴링으로 단계가 전이되고 후보를 활성화할 수 있다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetMockSceneState({ autoAdvanceOnPoll: true });

    renderMonitorHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));

    openTool();
    const input = await screen.findByLabelText('재생성 사유');
    fireEvent.change(input, { target: { value: '자재 반입' } });
    fireEvent.click(screen.getByRole('button', { name: '재생성 요청' }));

    // 1. 요청 직후: REQUESTED ('요청 대기 중')
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain('요청 대기 중'),
    );

    // 2. 첫 2초 폴링: CAPTURING ('배경 수집 중')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain('배경 수집 중'),
    );

    // 3. 다음 2초 폴링: RECONSTRUCTING ('3D 재구성 중')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain('3D 재구성 중'),
    );

    // 4. 다음 2초 폴링: CANDIDATE_READY ('새 3D 배경 후보 준비됨') + 활성화 버튼 노출
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain(
        '새 3D 배경 후보 준비됨',
      ),
    );
    const activateBtn = screen.getByRole('button', { name: '새 3D 배경 후보 — 활성화' });
    expect(activateBtn).toBeTruthy();

    // 5. 활성화 클릭 시 POST /api/scenes/{sceneVersion}/commit 호출 후 현재 Scene 재조회
    fireEvent.click(activateBtn);
    await waitFor(() =>
      expect(viewer.props?.scene).toMatchObject({
        ok: true,
        raw: {
          scene_version: 'scene-cand-1',
          state: 'COMMITTED',
        },
      }),
    );
    expect(screen.getByText(/새 3D 배경 활성화됨/)).toBeTruthy();
  });

  it('이미 진행 중인 요청이 있을 때(409 REGENERATE_IN_PROGRESS) 한국어 안내와 함께 해당 요청 상태를 표시한다', async () => {
    renderMonitorHost();
    await screen.findByTestId('viewer3d');

    // 다른 관리자가 요청해 이미 CAPTURING 진행 중인 상태를 주입
    setMockSceneRegenerateView({
      request_id: 7,
      status: 'CAPTURING',
      failure_reason: null,
      scene_version: null,
      reason: '크레인 이동',
      requested_at_ms: Date.now() - 5000,
      updated_at_ms: Date.now(),
    });

    openTool();
    fireEvent.click(await screen.findByRole('button', { name: '재생성 요청' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '이미 진행 중인 맵 재생성 요청이 있습니다.',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain('배경 수집 중'),
    );
  });

  describe('LIVE 관제 중에는 재생성하지 못한다 (S15P31A101-474)', () => {
    const work = (status: 'PLANNED' | 'IN_PROGRESS') => ({
      work_id: '1',
      status,
      date: '2026-11-04',
      name: '비계 설치',
      from_ms: Date.now() - 3_600_000,
      to_ms: Date.now() + 3_600_000,
      zone_id: null,
      planned_people: 3,
    });
    const mockWorks = (...statuses: ('PLANNED' | 'IN_PROGRESS')[]) =>
      server.use(
        http.get('*/api/work-units', () =>
          HttpResponse.json({ works: statuses.map((status) => work(status)) }),
        ),
      );

    it('진행 중인 작업이 있으면 요청 단추를 막고 이유를 보여 준다', async () => {
      mockWorks('IN_PROGRESS');
      renderMonitorHost();
      await screen.findByRole('button', { name: '맵 재생성' });
      openTool();

      const notice = await screen.findByTestId('scene-regenerate-live-notice');
      expect(notice.textContent).toContain('작업이 진행 중');
      expect(screen.getByRole('button', { name: '재생성 요청' })).toHaveProperty('disabled', true);
    });

    it('진행 중인 작업이 없으면 막지 않는다', async () => {
      mockWorks('PLANNED');
      renderMonitorHost();
      await screen.findByRole('button', { name: '맵 재생성' });
      openTool();

      await screen.findByRole('button', { name: '재생성 요청' });
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('scene-regenerate-live-notice')).toBeNull();
      expect(screen.getByRole('button', { name: '재생성 요청' })).toHaveProperty('disabled', false);
    });

    it('작업 목록을 받지 못하면 막지 않고 서버(409)에 맡겨, 거부되면 같은 안내를 보인다', async () => {
      server.use(
        http.get('*/api/work-units', () => new HttpResponse(null, { status: 500 })),
        http.post('*/api/scenes/regenerate', () =>
          HttpResponse.json(
            { status: 409, detail: 'x', code: 'REGENERATE_WORK_IN_PROGRESS' },
            { status: 409 },
          ),
        ),
      );
      renderMonitorHost();
      await screen.findByRole('button', { name: '맵 재생성' });
      openTool();
      fireEvent.click(await screen.findByRole('button', { name: '재생성 요청' }));

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('작업이 진행 중'),
      );
    });
  });

  it('재생성 실패 시 한국어 실패 사유를 표시한다', async () => {
    setMockSceneRegenerateView({
      request_id: 9,
      status: 'FAILED',
      failure_reason: 'BACKGROUND_NOT_READY',
      scene_version: null,
      reason: null,
      requested_at_ms: Date.now() - 10_000,
      updated_at_ms: Date.now(),
    });

    renderMonitorHost();
    // 팝오버를 닫아 둬도 상태는 계속 받는다. 열어 보면 실패가 나와 있다.
    await screen.findByRole('button', { name: '맵 재생성' });
    openTool();
    await waitFor(() =>
      expect(screen.getByTestId('scene-regenerate-status').textContent).toContain('재생성 실패'),
    );
    expect(screen.getByTestId('scene-regenerate-failure-reason').textContent).toContain(
      '사람 없는 배경 프레임이 아직 준비되지 않았습니다.',
    );
  });

  describe('재생성 품질 표시 (S15P31A101-469)', () => {
    /** 품질은 맵 재생성 팝오버 안에 있다. */
    const openToolWhenReady = async () => {
      await screen.findByRole('button', { name: '맵 재생성' });
      openTool();
      await screen.findByTestId('scene-regenerate-tool');
    };

    it('quality 가 없으면 아무것도 표시하지 않는다', async () => {
      renderMonitorHost();
      await openToolWhenReady();
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('scene-regenerate-quality')).toBeNull();
    });

    it('채움·비움 비율과 카메라별 값을 보여 주고 30% 미만이면 안내하지 않는다', async () => {
      setMockSceneQuality({
        previous_fill_ratio: 0.12,
        unrevealed_ratio: 0.05,
        camera_background_quality: {
          'cam-a': { previous_fill_ratio: 0.1, unrevealed_ratio: 0.02 },
        },
      });
      renderMonitorHost();
      await openToolWhenReady();
      const q = await screen.findByTestId('scene-regenerate-quality');
      expect(q.textContent).toContain('이전 모습으로 채움 12% · 비움 5%');
      expect(screen.getByTestId('scene-regenerate-quality-cameras').textContent).toContain(
        'cam-a 채움 10%/비움 2%',
      );
      expect(screen.queryByTestId('scene-regenerate-quality-notice')).toBeNull();
    });

    it('채움이 30% 이상이면 일부는 이전 모습이라는 안내를 보여 준다', async () => {
      setMockSceneQuality({ previous_fill_ratio: 0.3, unrevealed_ratio: 0.1 });
      renderMonitorHost();
      await openToolWhenReady();
      const notice = await screen.findByTestId('scene-regenerate-quality-notice');
      expect(notice.textContent).toContain('일부는 이전 모습입니다');
    });
  });
});

import {
  SpatialViewportContext,
  type SpatialViewportValue,
} from '@/features/layout/SpatialViewportHost';
import { PersonDetailPanel } from '@/features/people/PersonDetailPanel';
import { usePersonNameOverrideStore } from '@/features/people/personNameOverride.store';
import { WATCH_BINDINGS_KEY, type WatchBinding } from '@/features/watch/api';
import { ApiError } from '@/lib/http';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

function makeViewport(selectedKey: string | null): SpatialViewportValue {
  return {
    view: '3d',
    viewerReady: true,
    selectedKey,
    selectedZoneId: null,
    zones: [],
    zonesRaw: undefined,
    zonesFailed: false,
    selectTarget: vi.fn(),
    clearSelection: vi.fn(),
  };
}

function renderPanel(
  selectedKey: string | null,
  bindings: WatchBinding[] = [],
  viewportOverride?: Partial<SpatialViewportValue>,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(WATCH_BINDINGS_KEY, bindings);
  const viewport = { ...makeViewport(selectedKey), ...viewportOverride };
  const rendered = render(
    <QueryClientProvider client={client}>
      <SpatialViewportContext value={viewport}>
        <PersonDetailPanel />
      </SpatialViewportContext>
    </QueryClientProvider>,
  );
  return { ...rendered, viewport, client };
}

beforeEach(() => {
  apiMock.mockReset();
  usePersonNameOverrideStore.getState().reset();
  useRealtimeStore.setState({
    health: {
      receivedAt: 1_000,
      clockOffsetMs: 0,
      payload: {
        watches: {
          registered: 2,
          connected: 1,
          items: [
            {
              device_id: 'watch-01',
              link: 'CONNECTED',
              last_heartbeat_at: 900,
              battery_pct: 85,
              transport: 'WIFI',
            },
            {
              device_id: 'watch-02',
              link: 'LOST',
              last_heartbeat_at: 100,
              battery_pct: null,
              transport: null,
            },
          ],
        },
        watch_names: [
          { device_id: 'watch-01', display_name: '작업자 A' },
          { device_id: 'watch-02', display_name: '이영희' },
        ],
        person_names: [
          { world_id: 'w-0012', display_name: '작업자 A', name_source: 'WATCH_DEVICE' },
          { world_id: 'w-0015', display_name: '이영희', name_source: 'WATCH_DEVICE' },
          { world_id: 'w-0021', display_name: '미확인 1', name_source: 'UNIDENTIFIED' },
        ],
      } as unknown as ViewerHealthPayload,
    },
  });
  useSessionStore.getState().signIn({ accessToken: 'tok', user: { id: '1', role: 'ADMIN' } });
});

afterEach(() => {
  cleanup();
  usePersonNameOverrideStore.getState().reset();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

describe('PersonDetailPanel(-658)', () => {
  const bindings: WatchBinding[] = [
    {
      binding_id: 1,
      device_id: 'watch-01',
      world_id: 'w-0012',
      method: 'MOTION_MATCH',
      bound_at: 0,
      channel_state: 'BOUND',
    },
    {
      binding_id: 2,
      device_id: 'watch-02',
      world_id: 'w-0015',
      method: 'MANUAL',
      bound_at: 0,
      channel_state: 'LOST',
    },
  ];

  it('워치가 연결된 작업자를 고르면 이름·기기 ID·World ID 를 보이고 관리자가 워치 표시 이름을 낙관적으로 바꾼다', async () => {
    let resolvePut!: (val: unknown) => void;
    apiMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/watches/watch-01/display-name' && init?.method === 'PUT') {
        return new Promise((resolve) => {
          resolvePut = resolve;
        });
      }
      return Promise.reject(new Error('unexpected call'));
    });

    const { viewport } = renderPanel('person:w-0012', bindings);
    expect(screen.getByText('작업자 A')).toBeTruthy();
    expect(screen.getByText('연결됨')).toBeTruthy();
    expect(screen.getByText('watch-01')).toBeTruthy();
    expect(screen.getByText('w-0012')).toBeTruthy();

    const input = screen.getByLabelText('표시 이름');
    fireEvent.change(input, { target: { value: '  김철수  ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    // 서버 응답 전에도 낙관적으로 즉시 반영된다
    await waitFor(() => expect(screen.getByText('김철수')).toBeTruthy());

    resolvePut({
      device_id: 'watch-01',
      site_id: 'classroom-1',
      display_name: '김철수',
      changed_by_user_id: 1,
      updated_at: 2_000,
    });
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/api/watches/watch-01/display-name',
        expect.objectContaining({ method: 'PUT', body: { display_name: '김철수' } }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '작업자 선택 해제' }));
    expect(viewport.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('워치 미배정 작업자는 현재 World ID 당일 경로로 저장하고, 서버 실패 시 원래 이름으로 되돌린다', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError(400, {
        code: 'INVALID_DISPLAY_NAME',
        serverMessage: '서버 검증 거부',
      }),
    );

    renderPanel('person:w-0021', bindings);
    expect(screen.getByText('작업자 #1')).toBeTruthy();
    expect(screen.getByText('연결된 워치 없음')).toBeTruthy();

    const input = screen.getByLabelText('표시 이름');
    fireEvent.change(input, { target: { value: '임시작업자' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('서버 검증 거부'));
    // 롤백되어 다시 '작업자 #1' 이 보인다
    expect(screen.getByText('작업자 #1')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(
      '/api/people/w-0021/display-name',
      expect.objectContaining({ method: 'PUT', body: { display_name: '임시작업자' } }),
    );
  });

  it('열람 역할(VIEWER)은 상세 정보만 보고 이름 변경 입력은 보이지 않는다', () => {
    useSessionStore.getState().signIn({ accessToken: 'tok', user: { id: '2', role: 'VIEWER' } });
    renderPanel('person:w-0015', bindings);

    expect(screen.getByText('이영희')).toBeTruthy();
    expect(screen.getByText('연결 끊김')).toBeTruthy();
    expect(screen.getByText('watch-02')).toBeTruthy();
    expect(screen.getByText('w-0015')).toBeTruthy();
    expect(screen.queryByLabelText('표시 이름')).toBeNull();
  });
});

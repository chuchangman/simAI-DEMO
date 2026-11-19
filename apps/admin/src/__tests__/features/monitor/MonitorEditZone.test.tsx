import { ALARM_TEXT } from '@/features/events/alarmTone';
import { Dock } from '@/features/layout/Dock';
import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import { MonitorPage } from '@/features/monitor/MonitorPage';
import { severityTone } from '@/features/plan/plan';
import type {
  Viewer3DHandle,
  Viewer3DProps,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d';
import { PALETTE } from '@/features/viewer3d/palette';
import { zoneStyle } from '@/features/viewer3d/zones/zonePresentation';
import { SEVERITY_CHOICES, type ZoneCommitRequest } from '@/features/zones/types';
import { NEW_KEY } from '@/features/zones/zoneEditModel';
import { handlers } from '@/mocks/handlers';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock } from '@/mocks/zones';
import { useBoxEditStore } from '@/store/boxEdit.store';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore, type Role } from '@/store/session.store';
import { useZoneEditStore } from '@/store/zoneEdit.store';
import { startZoneEdit, stopZoneEdit, useZoneEditModeStore } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw/http';
import { setupServer } from 'msw/node';
import { useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({
      baseUrl: 'https://monitor-edit.invalid',
      getToken: () => 'mock-token.admin',
    }),
  };
});
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({
      to,
      children,
      className,
      'aria-label': ariaLabel,
    }: {
      to: string;
      children?: ReactNode;
      className?: string;
      'aria-label'?: string;
    }) => (
      <a href={to} className={className} aria-label={ariaLabel}>
        {children}
      </a>
    ),
  };
});

const fake = vi.hoisted(() => ({
  onSelect: null as ((target: ViewerTarget | null) => void) | null,
}));

function FakeViewer({ ref, onSelectionChange, onStatusChange }: Viewer3DProps) {
  useEffect(() => {
    fake.onSelect = onSelectionChange ?? null;
  }, [onSelectionChange]);

  useImperativeHandle(
    ref,
    () =>
      ({
        select: (target: ViewerTarget) => {
          fake.onSelect?.(target);
          return { ok: true };
        },
        focus: () => ({ ok: true }),
        clearSelection: () => {
          fake.onSelect?.(null);
          return { ok: true };
        },
        setMode: () => ({ ok: true }),
      }) as unknown as Viewer3DHandle,
  );

  const reported = useRef(false);
  useEffect(() => {
    if (!reported.current) {
      reported.current = true;
      onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
    }
  }, [onStatusChange]);

  return <div data-testid="viewer3d" />;
}

const loadFake = () => Promise.resolve({ default: FakeViewer });

const server = setupServer();
const commits: ZoneCommitRequest[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

function signInAs(role: Role) {
  useSessionStore.setState({
    session: { accessToken: 'mock-token.admin', user: { id: role.toLowerCase(), role } },
  });
}

function renderMonitor(editing = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (editing) startZoneEdit();
  return render(
    <QueryClientProvider client={qc}>
      <SpatialViewportHost loadViewer={loadFake}>
        <MonitorPage />
      </SpatialViewportHost>
    </QueryClientProvider>,
  );
}

describe('관제 관리자 편집 모드', () => {
  beforeEach(() => {
    const staticObjects = createStaticObjectsMock();
    const zonesMock = createZonesMock({ staticObjects: staticObjects.store });
    commits.splice(0, commits.length);
    navigateMock.mockReset();
    server.resetHandlers(
      http.post('*/api/zones/commit', async ({ request }) => {
        commits.push((await request.clone().json()) as ZoneCommitRequest);
        return undefined;
      }),
      ...zonesMock.handlers,
      ...staticObjects.handlers,
      ...handlers,
    );
    signInAs('ADMIN');
    useZoneEditStore.getState().clear();
    useBoxEditStore.getState().clear();
    useRealtimeStore.setState(
      {
        ...useRealtimeStore.getInitialState(),
        source: { id: 's-1', pushZones: vi.fn(), pushWorkSurfaces: vi.fn() } as never,
      },
      true,
    );
  });
  afterEach(() => {
    cleanup();
    stopZoneEdit();
  });

  it('관리자(ADMIN)가 구역 목록으로 편집 모드를 열고 편집 끝내기로 끌 수 있으며, 기즈모·초안 정리가 동작한다', async () => {
    renderMonitor();
    await screen.findByTestId('viewer3d');
    expect(screen.queryByRole('region', { name: '구역 편집 도구' })).toBeNull();
    // 도구 모음에는 편집 버튼이 없다. 편집은 구역 목록에서 들어간다.
    expect(screen.queryByRole('button', { name: '관리자 편집 모드' })).toBeNull();
    expect(screen.queryByRole('button', { name: '편집 끝내기' })).toBeNull();

    // 작업면이 붙지 않은 구역을 고르면 구역 상자를 고친다.
    const list = await screen.findByRole('region', { name: '위험 구역' });
    act(() =>
      within(list)
        .getByRole('button', { name: /개구부 구역$/ })
        .click(),
    );
    expect(await screen.findByRole('region', { name: '구역 편집 도구' })).toBeTruthy();
    await waitFor(() => expect(useBoxEditStore.getState().boxEdit?.kind).toBe('zone'));

    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '임시 초안' },
    });
    expect(Object.keys(useZoneEditStore.getState().drafts).length).toBeGreaterThan(0);

    // 고치던 초안이 있으면 끄기 전에 묻는다: 계속 편집이면 그대로 둔다.
    fireEvent.click(screen.getByRole('button', { name: '편집 끝내기' }));
    fireEvent.click(await screen.findByRole('button', { name: '계속 편집' }));
    expect(screen.getByRole('region', { name: '구역 편집 도구' })).toBeTruthy();
    expect(Object.keys(useZoneEditStore.getState().drafts).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '편집 끝내기' }));
    fireEvent.click(await screen.findByRole('button', { name: '수정 버리고 끄기' }));
    expect(screen.queryByRole('region', { name: '구역 편집 도구' })).toBeNull();
    expect(useZoneEditStore.getState().drafts).toEqual({});
    expect(useBoxEditStore.getState().boxEdit).toBeNull();

    for (const role of ['VIEWER', 'FOREMAN'] as const) {
      act(() => signInAs(role));
      expect(screen.queryByRole('button', { name: '편집 끝내기' })).toBeNull();
      expect(screen.queryByRole('region', { name: '구역 편집 도구' })).toBeNull();
    }
  }, 20_000);

  it('편집 모드에서는 이벤트 패널·2D 지도·맵 재생성을 숨기고 가장자리 번짐을 보인다', async () => {
    renderMonitor();
    await screen.findByTestId('viewer3d');
    expect(screen.getByRole('complementary', { name: '이벤트' })).toBeTruthy();
    expect(screen.getByTestId('plan-minimap')).toBeTruthy();
    expect(screen.getByRole('button', { name: '맵 재생성' })).toBeTruthy();
    expect(screen.queryByTestId('zone-edit-fade')).toBeNull();

    act(() => startZoneEdit());
    expect(screen.queryByRole('complementary', { name: '이벤트' })).toBeNull();
    expect(screen.queryByTestId('plan-minimap')).toBeNull();
    expect(screen.queryByRole('button', { name: '맵 재생성' })).toBeNull();
    expect(screen.getByTestId('zone-edit-fade')).toBeTruthy();
  });

  it('왼쪽 구역 목록 칼럼은 편집 모드가 아닐 때 모든 역할에게 보이고 편집 모드에서는 숨긴다', async () => {
    renderMonitor();
    await screen.findByTestId('viewer3d');
    expect(await screen.findByRole('region', { name: '위험 구역' })).toBeTruthy();
    for (const role of ['VIEWER', 'FOREMAN'] as const) {
      act(() => signInAs(role));
      expect(screen.getByRole('region', { name: '위험 구역' })).toBeTruthy();
    }
    act(() => signInAs('ADMIN'));
    act(() => startZoneEdit());
    expect(screen.queryByRole('region', { name: '위험 구역' })).toBeNull();
  });

  it('관리자가 구역 목록의 행을 누르면 편집 모드가 켜지고 그 구역이 열린다', async () => {
    renderMonitor();
    await screen.findByTestId('viewer3d');
    const list = await screen.findByRole('region', { name: '위험 구역' });
    act(() =>
      within(list)
        .getByRole('button', { name: /^경고\s*단상 구역$/ })
        .click(),
    );

    expect(await screen.findByRole('region', { name: '구역 편집 도구' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '위험 구역' })).toBeNull();
    expect(screen.getByRole('combobox', { name: '구역 선택' })).toHaveProperty('value', 'z-02');
  });

  it('관제 화면을 떠나면 편집 모드만 끄고 고치던 초안은 남긴다', async () => {
    const view = renderMonitor(true);
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(useBoxEditStore.getState().boxEdit?.kind).toBe('zone'));
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '임시 초안' },
    });

    view.unmount();
    expect(useZoneEditModeStore.getState().editing).toBe(false);
    expect(Object.keys(useZoneEditStore.getState().drafts).length).toBeGreaterThan(0);
  });

  it('구역 등급 선택지는 CRITICAL(빨강)·HIGH(주황) 2종뿐이고 이벤트 CAUTION 표시는 유지된다', async () => {
    renderMonitor(true);
    await screen.findByTestId('viewer3d');
    await screen.findByRole('option', { name: /개구부 구역/ });
    // 새 구역은 경고로 시작하고 심각도를 위험·경고 중에서 고른다.
    const severity = screen.getByRole('combobox', { name: '심각도' });
    expect(severity).toHaveProperty('value', 'HIGH');
    const options = within(severity).getAllByRole('option') as HTMLOptionElement[];
    expect(SEVERITY_CHOICES).toEqual(['CRITICAL', 'HIGH']);
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ['CRITICAL', '위험'],
      ['HIGH', '경고'],
    ]);
    expect(zoneStyle('UNVERIFIED', false, PALETTE.dark, 'CRITICAL').color).toBe(
      PALETTE.dark.risk.CRITICAL.color,
    );
    expect(zoneStyle('UNVERIFIED', false, PALETTE.dark, 'HIGH').color).toBe(
      PALETTE.dark.risk.HIGH.color,
    );
    expect(ALARM_TEXT.CAUTION).toBe('text-sev-caution');
    expect(severityTone('CAUTION')).toBe('caution');
  });

  it('고소 작업면을 체크한 새 구역은 작업면 OBB 와 둘레 0.30 m 구역(심각도 경고)을 함께 만들어 POST /api/zones/commit 한 번으로 발행한다', async () => {
    renderMonitor(true);
    await screen.findByTestId('viewer3d');
    await screen.findByRole('option', { name: /개구부 구역/ });

    expect(screen.getByRole('combobox', { name: '심각도' })).toHaveProperty('value', 'HIGH');
    // 작업면은 체크해야 붙는다: 체크하기 전에는 3D 손잡이가 구역 상자를 고친다.
    expect(useBoxEditStore.getState().boxEdit?.kind).toBe('zone');
    fireEvent.click(screen.getByRole('checkbox', { name: '고소 작업면' }));
    expect(useBoxEditStore.getState().boxEdit?.kind).toBe('surface');

    act(() =>
      useBoxEditStore.getState().onChange({
        min: [4.0, 3.0, 0],
        max: [6.0, 5.0, 1.2],
      }),
    );

    const addBtn = screen.getByRole('button', { name: '구역 추가' }) as HTMLButtonElement;
    await waitFor(() => expect(addBtn.disabled).toBe(false));
    act(() => addBtn.click());

    await waitFor(() => expect(commits).toHaveLength(1));
    // 추가가 발행까지 끝나도 편집 모드는 그대로이고 만든 구역이 골라진다(편집 끝내기 전까지 이어서 고친다, S15P31A101-651).
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '이름' })).toHaveProperty('value', '고소작업면 A'),
    );
    expect(useZoneEditModeStore.getState().editing).toBe(true);
    expect(commits[0]).toMatchObject({
      zone: {
        op: 'CREATE',
        body: {
          severity: 'HIGH',
          polygon_xy: [
            [3.7, 2.7],
            [6.3, 2.7],
            [6.3, 5.3],
            [3.7, 5.3],
          ],
          z_min_m: 0,
          z_max_m: 2,
        },
      },
      surface: {
        op: 'CREATE',
        body: {
          kind: 'WORK_SURFACE',
          top_height_m: 1.2,
          obb: {
            center: [5.0, 4.0, 0.6],
            size: [2.0, 2.0, 1.2],
            yaw_rad: 0,
          },
        },
      },
      publish: true,
    });
  });

  it('기존 구역을 고쳐 저장해도 편집 끝내기 전까지 편집 모드가 이어지고, 끝낸 뒤 다시 + 로 열면 새 구역 양식이다', async () => {
    renderMonitor();
    await screen.findByTestId('viewer3d');
    const list = await screen.findByRole('region', { name: '위험 구역' });
    act(() =>
      within(list)
        .getByRole('button', { name: /개구부 구역$/ })
        .click(),
    );
    await screen.findByRole('region', { name: '구역 편집 도구' });
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '개구부 B' },
    });
    act(() => screen.getByRole('button', { name: '저장' }).click());

    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).toMatchObject({ zone: { op: 'UPDATE', zone_id: 'z-04' }, publish: true });
    // 저장해도 패널은 남아 같은 구역을 이어서 고칠 수 있다(저장 단추는 다시 바뀐 것이 생길 때까지 꺼진다).
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(screen.getByRole('region', { name: '구역 편집 도구' })).toBeTruthy();
    expect(useZoneEditModeStore.getState().editing).toBe(true);

    act(() => screen.getByRole('button', { name: '편집 끝내기' }).click());
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '구역 편집 도구' })).toBeNull(),
    );

    // 저장한 구역이 선택돼 있어도 + 는 그 구역이 아니라 새 구역 양식을 연다.
    act(() => screen.getByRole('button', { name: '새 구역 추가' }).click());
    expect(await screen.findByRole('combobox', { name: '구역 선택' })).toHaveProperty(
      'value',
      NEW_KEY,
    );
  }, 20_000);

  it('/zones 라우트 제거 뒤에도 도크 링크가 깨지지 않는다', () => {
    render(<Dock />);
    const nav = screen.getByRole('navigation', { name: '주 메뉴' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/work', '/live', '/cctv']);
    expect(hrefs).not.toContain('/zones');
  });
});

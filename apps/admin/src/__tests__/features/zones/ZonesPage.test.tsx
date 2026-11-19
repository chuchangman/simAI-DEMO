import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import type { ViewerEditBox } from '@/features/viewer3d';
import { ZONES_KEY } from '@/features/zones/api';
import type { ZoneCommitRequest } from '@/features/zones/types';
import { ARM_MS } from '@/features/zones/useArmedDelete';
import { NEW_KEY } from '@/features/zones/zoneEditModel';
import { ZonesPage } from '@/features/zones/ZonesPage';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createTbmMock } from '@/mocks/tbm';
import { createZonesMock, MOCK_ZONES, type ZonesMock } from '@/mocks/zones';
import { useBoxEditStore } from '@/store/boxEdit.store';
import { useSessionStore } from '@/store/session.store';
import { HISTORY_LIMIT, useZoneEditStore } from '@/store/zoneEdit.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({
      baseUrl: 'http://api.test',
      getToken: () => 'mock-token.admin',
    }),
  };
});

// 3D 뷰어 호스트 대신 선택(zone:… · object:…)만 들고 있는 작은 대역을 쓴다. 구역 목록은 실제 useZones 가 받는다.
const viewport = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    selectedKey: null as string | null,
    listeners,
    emit: () => listeners.forEach((fn) => fn()),
  };
});
vi.mock('@/features/layout/SpatialViewportHost', async () => {
  const { useSyncExternalStore } = await import('react');
  const { useZones } = await vi.importActual<typeof import('@/features/zones/useZones')>(
    '@/features/zones/useZones',
  );
  return {
    useSpatialViewport: () => {
      const selectedKey = useSyncExternalStore(
        (fn) => {
          viewport.listeners.add(fn);
          return () => viewport.listeners.delete(fn);
        },
        () => viewport.selectedKey,
      );
      const { zones, raw, failed } = useZones();
      return {
        zones,
        zonesRaw: raw,
        zonesFailed: failed,
        selectedKey,
        selectedZoneId: selectedKey?.startsWith('zone:') ? selectedKey.slice('zone:'.length) : null,
        view: '2d',
        viewerReady: false,
        selectTarget: (target: { type: string; id: string }) => {
          viewport.selectedKey = `${target.type}:${target.id}`;
          viewport.emit();
        },
        clearSelection: () => {
          viewport.selectedKey = null;
          viewport.emit();
        },
      };
    },
  };
});

const server = setupServer();
const log: string[] = [];
/** 서버가 받은 GET /api/static-objects 횟수(작업면 목록 받기). */
let objectListGets = 0;
/** 서버가 받은 POST /api/zones/commit 본문(받은 순서). */
const commits: ZoneCommitRequest[] = [];
let zonesMock: ZonesMock;

/** commit 본문을 기록하고 다음 처리기에 넘긴다(응답은 mock 이나 그 앞에 둔 처리기가 만든다). */
const recordCommit = async (request: Request) => {
  commits.push((await request.clone().json()) as ZoneCommitRequest);
};

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET') log.push(`${request.method} ${path}`);
    else if (path === '/api/zones') log.push('GET /api/zones');
    else if (path === '/api/static-objects') objectListGets += 1;
  });
});
afterAll(() => server.close());

function signInAsAdmin() {
  useSessionStore.setState({
    session: { accessToken: 'mock-token.admin', user: { id: 'admin', role: 'ADMIN' } },
  });
}

beforeEach(() => {
  const staticObjects = createStaticObjectsMock();
  zonesMock = createZonesMock({ staticObjects: staticObjects.store });
  server.resetHandlers(
    http.post('*/api/zones/commit', ({ request }) => recordCommit(request).then(() => undefined)),
    ...zonesMock.handlers,
    ...staticObjects.handlers,
  );
  log.splice(0, log.length);
  objectListGets = 0;
  commits.splice(0, commits.length);
  viewport.selectedKey = null;
  viewport.listeners.clear();
  useZoneEditStore.getState().clear();
  useBoxEditStore.getState().clear();
  signInAsAdmin();
});
afterEach(() => {
  cleanup();
  useSessionStore.setState({ session: undefined });
});

/**
 * 첫 화면의 목록(구역·작업면·구성 묶음)이 mock 에서 도착하기를 기다리는 상한. 파일의 첫 시험은 첫 요청 준비(fetch·MSW·응답
 * 스키마 첫 검사)와 첫 그리기를 같이 치러 CPU 가 바쁘면 기본 1 s 를 넘겼다(S15P31A101-674, 바쁜 루프 부하에서 1.4 s).
 * 도착 대기는 시험 대상 동작이 아니라 준비라서 시험 시간(5 s) 안에서 넉넉히 기다린다.
 */
const ARRIVAL = { timeout: 3_000 };

async function renderPage({
  surfaces = true,
  onCommitted,
  workLayoutId,
  addOnDemand,
}: {
  surfaces?: boolean;
  onCommitted?: () => void;
  workLayoutId?: number;
  addOnDemand?: boolean;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ZonesPage onCommitted={onCommitted} workLayoutId={workLayoutId} addOnDemand={addOnDemand} />
    </QueryClientProvider>,
  );
  // 접힌 화면에는 드롭다운이 없어 구역 목록이 도착했는지를 캐시로 본다.
  if (addOnDemand) {
    await waitFor(() => expect(client.getQueryData(ZONES_KEY)).toBeDefined(), ARRIVAL);
  } else {
    await screen.findByRole('option', { name: /개구부 구역/ }, ARRIVAL);
  }
  // 작업면 목록과 구성 묶음 목록이 도착해야 이은 작업면·발행 전이 맞다.
  if (surfaces) {
    await waitFor(() => expect(client.getQueryData(['static-objects'])).toBeDefined(), ARRIVAL);
  }
  await waitFor(() => expect(client.getQueryData(['config-bundles'])).toBeDefined(), ARRIVAL);
  return { ...view, client };
}

const picker = () => screen.getByRole('combobox', { name: '구역 선택' }) as HTMLSelectElement;
const optionTexts = () =>
  within(picker())
    .getAllByRole('option')
    .map((o) => o.textContent);
const pick = (value: string) => act(() => void fireEvent.change(picker(), { target: { value } }));
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const writes = () => log.filter((entry) => !entry.startsWith('GET'));
const COMMIT = 'POST /api/zones/commit';
const AUTH = { Authorization: 'Bearer mock-token.admin' };
type Json = Record<string, unknown>;
/** 서버(mock)가 지금 가진 목록을 직접 받는다. */
const fetchList = async (path: string) =>
  (await (await fetch(`http://api.test${path}`, { headers: AUTH })).json()) as Json[];
const sendJson = (method: string, path: string, body: unknown) =>
  fetch(`http://api.test${path}`, {
    method,
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
/** 받은 작업면 항목을 요청 본문(StaticObjectBody)으로. */
const surfaceBodyOf = (item: Json) => ({
  kind: item.kind,
  name: item.name,
  obb: item.obb,
  top_height_m: item.top_height_m,
  top_height_sigma_m: null,
});
const deskOf = async () =>
  (await fetchList('/api/static-objects')).find((o) => o.object_id === 'ws-0a0c0002')!;
/** 시험 준비로 서버(mock)에 정적 객체를 더하고 만들어진 항목을 돌려받는다. 준비로 보낸 요청은 쓰기 기록에서 뺀다. */
const addStaticObject = async (body: Json) => {
  const item = (await (await sendJson('POST', '/api/static-objects', body)).json()) as Json;
  log.splice(0, log.length);
  return item;
};
/** 직사각형이 아니라 형상을 고칠 수 없는 구역(삼각형)을 서버(mock)에 더한다. 만들어진 ID 는 z-00000001 이다. */
const addZone = (overrides: Json = {}) =>
  sendJson('POST', '/api/zones', {
    name: '새 서버 구역',
    zone_kind: 'OPENING',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ],
    z_min_m: 0,
    z_max_m: 2,
    severity: 'HIGH',
    has_guardrail: null,
    requirements: null,
    ...overrides,
  });
const addTriangleZone = () =>
  addZone({
    name: '삼각형 구역',
    polygon_xy: [
      [1, 1],
      [3, 1],
      [2, 3],
    ],
  });
/** 책상(ws-0a0c0002, 회전해 있다)을 이 구역에 잇는다(구역은 그대로 두고 작업면만 /commit 으로 저장). */
const linkDeskTo = async (zoneId: string) => {
  const linked = await sendJson('POST', '/api/zones/commit', {
    zone: { op: 'KEEP', zone_id: zoneId },
    surface: { op: 'UPDATE', object_id: 'ws-0a0c0002', body: surfaceBodyOf(await deskOf()) },
    publish: false,
  });
  expect(linked.status).toBe(200);
  log.splice(0, log.length);
  commits.splice(0, commits.length);
};
/** 다음 /commit 요청을 기록하고 이 상태·오류 이름으로 거절한다. */
const failCommit = (status: number, code: string) =>
  server.use(
    http.post('*/api/zones/commit', async ({ request }) => {
      await recordCommit(request);
      return HttpResponse.json({ status, detail: 'x', code }, { status });
    }),
  );
/** 작업면 없이 만든 구역(z-04)을 고른 화면: 고소 작업면 카드가 없다. */
const noSurfaceCard = () =>
  expect(screen.queryByRole('region', { name: '고소 작업면' })).toBeNull();
const SHAPE_LOCKED_TEXT =
  '직사각형이 아니거나 높이가 없거나 바닥 판정인 구역은 형상을 고칠 수 없습니다.';
const nameInput = () => screen.getByRole('textbox', { name: '이름' }) as HTMLInputElement;
const severitySelect = () => screen.getByRole('combobox', { name: '심각도' }) as HTMLSelectElement;
/** 새 구역의 「고소 작업면」 체크박스. 체크해야 작업면이 붙고 높이 칸이 나온다. */
const surfaceCheckbox = () =>
  screen.getByRole('checkbox', { name: '고소 작업면' }) as HTMLInputElement;
/** Ctrl+Z. 돌려주는 값은 브라우저 기본 동작을 막지 않았는지(막았으면 false). */
const pressUndo = (target: Window | Element = window, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { code: 'KeyZ', key: 'z', ctrlKey: true, ...init });
const rename = (name: string) => fireEvent.change(nameInput(), { target: { value: name } });
const dragTo = (box: ViewerEditBox) => act(() => useBoxEditStore.getState().onChange(box));
const releasePointer = () => act(() => void window.dispatchEvent(new Event('pointerup')));
/** 3D 위에서 포인터를 누른다(끌기의 시작). 3D 가 아닌 body 에서 올려 캡처 처리기가 받는지도 본다. */
const pressPointer = () =>
  act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
const Z02_BOX: ViewerEditBox = { min: [1, 6.2, 0], max: [4, 8.4, 0.4] };
const Z04_BOX: ViewerEditBox = { min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] };
const MOVED_Z04_BOX: ViewerEditBox = { min: [6, 1.2, 0], max: [8.8, 3.8, 2.4] };
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** 3D 에서 대상을 눌러 선택이 바뀐 것처럼(zone:… · object:…) 호스트 선택을 바꾼다. */
const selectInViewer = (key: string | null) =>
  act(() => {
    viewport.selectedKey = key;
    viewport.emit();
  });
/** 구역 화면에서 닿을 수 없는 작업면의 카드. 책상(ws-0a0c0002)은 어느 구역에도 이어져 있지 않다. */
const orphanCard = () => screen.queryByRole('region', { name: '작업면' });
const RETRY_TEXT = '반영했지만 현장 판정으로 보내지 못했습니다.';

describe('구역 편집 화면', () => {
  it('관리자가 아니면 아무것도 그리지 않고 구역·작업면 목록도 받지 않는다', () => {
    useSessionStore.setState({
      session: { accessToken: 'mock-token.admin', user: { id: 'viewer', role: 'VIEWER' } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <ZonesPage />
      </QueryClientProvider>,
    );
    expect(container.innerHTML).toBe('');
    expect(objectListGets).toBe(0);
    expect(log).toEqual([]);
  });

  it('드롭다운은 「새 구역 추가」가 먼저이고 기존 구역은 이름만(구역 번호 없음)이다. 새 구역은 이름·심각도·고소 작업면(체크)만 고른다', async () => {
    await renderPage();
    expect(optionTexts()).toEqual(['새 구역 추가', '개구부 구역', '단상 구역']);
    expect(screen.queryByText(/z-0\d/)).toBeNull();
    expect(picker().value).toBe('__new__');
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveProperty('value', '위험구역 1');
    // 편집 도구에 제목(h1)은 없다. 화면 제목은 실시간 관제 화면이 가진다.
    expect(screen.queryByRole('heading')).toBeNull();
    // 새 구역의 심각도는 경고로 시작하고 위험·경고 중에서 고른다.
    expect(severitySelect().value).toBe('HIGH');
    // 구역 종류·판정 유형은 화면에 없다.
    expect(screen.queryByLabelText('판정 유형')).toBeNull();
    expect(screen.queryByLabelText('유형')).toBeNull();
    expect(button('구역 추가')).toBeTruthy();
    // 고소 작업면은 처음에 해제라 높이 칸이 없고, 체크하면 기본 작업면(상판 0.4 m)과 높이 칸이 생긴다.
    const surfaceCard = screen.getByRole('region', { name: '고소 작업면' });
    expect(surfaceCheckbox().checked).toBe(false);
    expect(screen.queryByLabelText('높이(m)')).toBeNull();
    fireEvent.click(surfaceCheckbox());
    expect(surfaceCheckbox().checked).toBe(true);
    expect(within(surfaceCard).getByLabelText('높이(m)')).toHaveProperty('value', '0.40');
    expect(within(surfaceCard).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ 고소 작업면 추가' })).toBeNull();
    // 다시 해제하면 높이 칸이 사라진다.
    fireEvent.click(surfaceCheckbox());
    expect(screen.queryByLabelText('높이(m)')).toBeNull();
  });

  it('이미 저장된 주의 구역은 지금 값을 비활성 선택지로 보이고, 위험이나 경고를 다시 골라야 저장한다', async () => {
    server.use(
      http.get('*/api/zones', () =>
        HttpResponse.json(
          MOCK_ZONES.map((zone) =>
            zone.zone_id === 'z-04' ? { ...zone, severity: 'CAUTION' } : zone,
          ),
        ),
      ),
    );
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    const options = within(severitySelect()).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ['주의', true],
      ['위험', false],
      ['경고', false],
    ]);
    expect(severitySelect().value).toBe('CAUTION');
    expect(screen.getByText('위험·경고 중에서 고르세요.')).toBeTruthy();
    rename('다른 이름');
    expect((button('저장') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(severitySelect(), { target: { value: 'HIGH' } });
    expect(screen.queryByText('위험·경고 중에서 고르세요.')).toBeNull();
    expect((button('저장') as HTMLButtonElement).disabled).toBe(false);
  });

  it('고소 작업면을 체크한 새 구역은 작업면과 함께 OPENING·VOLUME_3D·경고로 만들고 저장과 발행을 /commit 한 번(구역 CREATE + 작업면 CREATE, publish)으로 보낸다', async () => {
    await renderPage();
    fireEvent.click(surfaceCheckbox());
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '새로 만든 구역' },
    });
    act(() => button('구역 추가').click());
    await waitFor(() => expect(picker().value).toBe('z-00000001'));
    expect(writes()).toEqual([COMMIT]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: {
        op: 'CREATE',
        body: {
          name: '새로 만든 구역',
          zone_kind: 'OPENING',
          eval_type: 'VOLUME_3D',
          severity: 'HIGH',
          z_min_m: 0,
          z_max_m: 2,
        },
      },
      surface: { op: 'CREATE', body: { kind: 'WORK_SURFACE', top_height_m: 0.4 } },
      publish: true,
    });
    // 새 구역에는 ID 도 작업면 ID 도 보내지 않는다.
    expect(commits[0]!.zone).not.toHaveProperty('zone_id');
    expect(commits[0]!.surface).not.toHaveProperty('object_id');
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-00000001', name: '새로 만든 구역' }),
    );
    // 서버가 새 작업면을 새 구역에 이었다.
    expect(await fetchList('/api/static-objects')).toContainEqual(
      expect.objectContaining({ kind: 'WORK_SURFACE', zone_id: 'z-00000001', object_version: 1 }),
    );
    // 만든 구역은 바로 고를 수 있고, 새 구역 초안은 비었으며, 발행 전이 아니다(응답의 묶음이 목록에 들어갔다).
    expect(optionTexts()).toContain('새로 만든 구역');
    expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeUndefined();
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
  });

  it('새 구역의 작업면 높이를 고쳐 추가하면 그 높이의 작업면을 만들고, 작업면 카드는 서버가 이은 작업면으로 그려진다', async () => {
    await renderPage();
    fireEvent.click(surfaceCheckbox());
    const height = screen.getByLabelText('높이(m)');
    fireEvent.change(height, { target: { value: '0.9' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    act(() => button('구역 추가').click());
    await waitFor(() => expect(picker().value).toBe('z-00000001'));
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: { op: 'CREATE' },
      surface: { op: 'CREATE', body: { kind: 'WORK_SURFACE', top_height_m: 0.9 } },
      publish: true,
    });
    expect(await fetchList('/api/static-objects')).toContainEqual(
      expect.objectContaining({
        kind: 'WORK_SURFACE',
        zone_id: 'z-00000001',
        top_height_m: expect.closeTo(0.9, 5),
      }),
    );
    // 초안은 모두 지웠다.
    expect(useZoneEditStore.getState().drafts).toEqual({});
    await waitFor(() =>
      expect(Number((screen.getByLabelText('높이(m)') as HTMLInputElement).value)).toBeCloseTo(0.9),
    );
    expect(optionTexts()).toContain('고소작업면 A');
  });

  it('이은 작업면(서버 zone_id)이 카드에 보이고, 작업면이 붙은 구역은 3D 손잡이가 작업면을 고치며 심각도 칸이 있고 구역·작업면 전환이 없다', async () => {
    await renderPage();
    pick('z-02');
    expect(await screen.findByLabelText('높이(m)')).toHaveProperty('value', '0.40');
    expect(useBoxEditStore.getState().boxEdit).toMatchObject({
      id: 'surface:z-02',
      kind: 'surface',
      box: { min: [1, 6.2, 0], max: [4, 8.4, 0.4] },
    });
    expect(severitySelect().value).toBe('HIGH');
    expect(screen.queryByRole('checkbox', { name: '고소 작업면' })).toBeNull();
    expect(screen.queryByRole('group', { name: '3D 에서 조절할 대상' })).toBeNull();
    expect(screen.queryByRole('button', { name: '구역' })).toBeNull();
  });

  it('고른 구역의 가로·세로·높이를 숫자로 고치면 3D 손잡이 상자도 바뀐다(가로·세로는 가운데 기준, S15P31A101-651)', async () => {
    await renderPage();
    pick('z-04');
    const width = (await screen.findByLabelText('가로(m)')) as HTMLInputElement;
    expect(width.value).toBe('2.80');
    expect((screen.getByLabelText('세로(m)') as HTMLInputElement).value).toBe('2.60');
    expect((screen.getByLabelText('구역 높이(m)') as HTMLInputElement).value).toBe('2.40');
    fireEvent.change(width, { target: { value: '2' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('구역 높이(m)'), { target: { value: '3' } });
    fireEvent.keyDown(screen.getByLabelText('구역 높이(m)'), { key: 'Enter' });
    await waitFor(() =>
      expect(useBoxEditStore.getState().boxEdit).toMatchObject({
        id: 'z-04',
        kind: 'zone',
        box: { min: [6.2, 1.2, 0], max: [8.2, 3.8, 3] },
      }),
    );
    expect((button('저장') as HTMLButtonElement).disabled).toBe(false);
    // 작업면이 붙은 구역은 작업면의 가로·세로만 보이고 높이는 작업면 카드의 상판 높이 칸이다.
    pick('z-02');
    expect(await screen.findByLabelText('가로(m)')).toHaveProperty('value', '3.00');
    expect(screen.queryByLabelText('구역 높이(m)')).toBeNull();
  });

  it('다른 활성 구역과 같은 이름으로 고치면 저장을 막고 알린다(S15P31A101-651)', async () => {
    await renderPage();
    pick('z-04');
    const name = await screen.findByRole('textbox', { name: '이름' });
    fireEvent.change(name, { target: { value: '단상 구역' } });
    expect(await screen.findByText('같은 이름의 구역이 있습니다.')).toBeTruthy();
    expect((button('저장') as HTMLButtonElement).disabled).toBe(true);
  });

  it('작업면 없이 만든 기존 구역은 작업면 카드와 추가 단추가 없고, 구역 상자 손잡이로 고친다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    expect(screen.queryByLabelText('높이(m)')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ 고소 작업면 추가' })).toBeNull();
    expect(severitySelect().value).toBe('CRITICAL');
    expect(useBoxEditStore.getState().boxEdit).toMatchObject({
      id: 'z-04',
      kind: 'zone',
      box: Z04_BOX,
    });
  });

  it('구역과 작업면은 서버가 저장한 zone_id 로만 이어진다: 위치가 구역 안이어도 zone_id 가 없으면 잇지 않는다', async () => {
    // 책상(ws-0a0c0002, zone_id 없음)을 z-04 바닥(X 5.8~8.6, Y 1.2~3.8) 안으로 옮긴다. PUT 은 zone_id 를 빼면 연결을 그대로 둔다.
    const desk = await deskOf();
    await sendJson('PUT', '/api/static-objects/ws-0a0c0002', {
      ...surfaceBodyOf(desk),
      obb: { center: [7, 2.5, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: 0 },
    });
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    expect(screen.queryByLabelText('높이(m)')).toBeNull();
  });

  it('zone_id 가 있는 작업면은 중심이 구역 밖이어도 그 구역의 작업면 카드로 보인다', async () => {
    // /commit 으로 책상(중심 (5, 4.6)은 z-04 밖)을 z-04 에 잇는다.
    const desk = await deskOf();
    const linked = await sendJson('POST', '/api/zones/commit', {
      zone: { op: 'KEEP', zone_id: 'z-04' },
      surface: { op: 'UPDATE', object_id: 'ws-0a0c0002', body: surfaceBodyOf(desk) },
      publish: false,
    });
    expect(linked.status).toBe(200);
    commits.splice(0, commits.length);
    await renderPage();
    pick('z-04');
    expect(await screen.findByLabelText('높이(m)')).toHaveProperty('value', '0.74');
    // 이은 작업면이 있어 추가 버튼은 없다.
    expect(screen.queryByRole('button', { name: '+ 고소 작업면 추가' })).toBeNull();
  });

  it('3D 에서 작업면을 옮기면 `저장 전`이 되고, 작업면 구역의 윤곽이 작업면을 따라가 저장을 막지 않는다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    expect(optionTexts()).toContain('단상 구역');
    // 작업면을 +1m(X) 옮긴다(손잡이를 끌어 놓은 결과를 뷰어가 올린 것처럼).
    act(() => useBoxEditStore.getState().onChange({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] }));
    expect(optionTexts()).toContain('단상 구역 · 저장 전');
    expect((button('저장') as HTMLButtonElement).disabled).toBe(false);
    expect(useBoxEditStore.getState().boxEdit?.box).toEqual({
      min: [2, 6.2, 0],
      max: [5, 8.4, 0.4],
    });
    // 3D 에는 작업면에서 계산한 구역(0.30 m 여유, 높이 2 m)이 윤곽으로 따라온다.
    expect(useBoxEditStore.getState().ghosts).toEqual([
      { id: 'z-02', box: { min: [0.7 + 1, 5.9, 0], max: [4.3 + 1, 8.7, 2] } },
    ]);
  });

  it('작업면을 옮겨 저장하면 구역도 작업면 둘레(0.30 m)·경고로 따라가 한 요청(구역 UPDATE + 작업면 UPDATE)으로 보낸다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    act(() => useBoxEditStore.getState().onChange({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] }));
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('단상 구역'));
    expect(writes()).toEqual([COMMIT]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: {
        op: 'UPDATE',
        zone_id: 'z-02',
        body: {
          severity: 'HIGH',
          polygon_xy: [
            [1.7, 5.9],
            [5.3, 5.9],
            [5.3, 8.7],
            [1.7, 8.7],
          ],
          z_min_m: 0,
          z_max_m: 2,
        },
      },
      surface: {
        op: 'UPDATE',
        object_id: 'ws-0a0c0001',
        body: { obb: { center: [3.5, 7.3, expect.closeTo(0.2, 5)] } },
      },
      publish: true,
    });
    // 구역·작업면 모두 새 버전이 되고, 작업면은 여전히 z-02 에 이어져 있다.
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-02', zone_version: 2 }),
    );
    expect(await fetchList('/api/static-objects')).toContainEqual(
      expect.objectContaining({ object_id: 'ws-0a0c0001', object_version: 2, zone_id: 'z-02' }),
    );
    expect(screen.getByLabelText('높이(m)')).toHaveProperty('value', '0.40');
  });

  it('옛 작업면 구역은 이름만 고쳐 저장해도 작업면 둘레(0.30 m)·경고·구역 높이(2 m)로 맞춰 보낸다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    rename('단상 새 이름');
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('단상 새 이름'));
    expect(commits[0]).toMatchObject({
      zone: {
        op: 'UPDATE',
        zone_id: 'z-02',
        body: {
          name: '단상 새 이름',
          severity: 'HIGH',
          polygon_xy: [
            [0.7, 5.9],
            [4.3, 5.9],
            [4.3, 8.7],
            [0.7, 8.7],
          ],
          z_min_m: 0,
          z_max_m: 2,
        },
      },
      publish: true,
    });
    expect(commits[0]).not.toHaveProperty('surface');
  });

  it('회전한 작업면의 구역은 같이 회전한 다각형으로 저장하고, 손잡이는 없고 높이만 고친다', async () => {
    const item = (await fetchList('/api/static-objects')).find(
      (o) => o.object_id === 'ws-0a0c0001',
    )!;
    await sendJson('PUT', '/api/static-objects/ws-0a0c0001', {
      ...surfaceBodyOf(item),
      obb: { ...(item.obb as object), yaw_rad: Math.PI / 2 },
    });
    log.splice(0, log.length);
    await renderPage();
    pick('z-02');
    const height = await screen.findByLabelText('높이(m)');
    expect(useBoxEditStore.getState().boxEdit).toBeNull();
    expect((height as HTMLInputElement).disabled).toBe(false);
    rename('회전 단상');
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('회전 단상'));
    expect(commits[0]).toMatchObject({
      zone: {
        op: 'UPDATE',
        body: {
          polygon_xy: [
            [3.9, 5.5],
            [3.9, 9.1],
            [1.1, 9.1],
            [1.1, 5.5],
          ],
        },
      },
    });
  });

  it('되돌리기는 이름·모양·작업면의 저장 전 고침을 모두 버린다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '다른 이름' },
    });
    act(() => useBoxEditStore.getState().onChange({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] }));
    expect((button('되돌리기') as HTMLButtonElement).disabled).toBe(false);
    act(() => button('되돌리기').click());
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveProperty('value', '단상 구역');
    expect(optionTexts()).toContain('단상 구역');
    expect(useBoxEditStore.getState().boxEdit?.box.min).toEqual([1, 6.2, 0]);
  });

  it('작업면 목록을 받기 전에는 저장할 수 없다(이은 작업면을 모른 채 보내지 않는다)', async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    server.use(
      http.get('*/api/static-objects', async () => {
        await gate;
        return undefined;
      }),
    );
    await renderPage({ surfaces: false });
    pick('z-04');
    await screen.findByRole('textbox', { name: '이름' });
    rename('개구부 B');
    expect((button('저장') as HTMLButtonElement).disabled).toBe(true);
    open();
    await waitFor(() => expect((button('저장') as HTMLButtonElement).disabled).toBe(false));
  });

  it('구역 이름만 고쳐 저장하면 저장 전 확인(GET) 뒤 /commit 한 번(구역 UPDATE, 작업면 없음, publish)을 보내고 초안을 지운다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    rename('개구부 B');
    expect(optionTexts()).toContain('개구부 구역 · 저장 전');
    log.splice(0, log.length);
    act(() => button('저장').click());
    // 저장 전 · 발행 전 표시가 모두 사라진다.
    await waitFor(() => expect(optionTexts()).toContain('개구부 B'));
    expect(log).toEqual(['GET /api/zones', COMMIT]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: { op: 'UPDATE', zone_id: 'z-04', body: { name: '개구부 B' } },
      publish: true,
    });
    expect(commits[0]).not.toHaveProperty('surface');
    expect(useZoneEditStore.getState().drafts['z-04']).toBeUndefined();
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
  });

  it('저장·추가가 발행까지 끝나면 onCommitted 를 한 번씩 부른다', async () => {
    const onCommitted = vi.fn();
    await renderPage({ onCommitted });
    pick('z-04');
    await waitFor(noSurfaceCard);
    rename('개구부 B');
    act(() => button('저장').click());
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));

    pick(NEW_KEY);
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '또 만든 구역' },
    });
    act(() => button('구역 추가').click());
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(2));
  });

  it('저장은 됐지만 발행이 안 되면 onCommitted 를 부르지 않아 다시 보내기가 남는다', async () => {
    const onCommitted = vi.fn();
    await renderPage({ onCommitted });
    pick('z-04');
    await waitFor(noSurfaceCard);
    zonesMock.failNextPublish('CALIBRATION_MISSING');
    rename('개구부 B');
    act(() => button('저장').click());
    await screen.findByText(RETRY_TEXT);
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it('구역·작업면을 함께 고쳐 저장하면 구역 UPDATE + 작업면 UPDATE 한 요청이고, 저장하면 저장 전·발행 전이 사라진다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '단상 B' },
    });
    const height = screen.getByLabelText('높이(m)');
    fireEvent.change(height, { target: { value: '0.6' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    log.splice(0, log.length);
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('단상 B'));
    // 저장 전 확인(구역·작업면 GET) 뒤 요청 하나다.
    expect(writes()).toEqual([COMMIT]);
    expect(log.filter((entry) => entry === 'GET /api/zones')).toHaveLength(1);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: { op: 'UPDATE', zone_id: 'z-02', body: { name: '단상 B' } },
      surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: { top_height_m: 0.6 } },
      publish: true,
    });
    expect(useZoneEditStore.getState().drafts['z-02']).toBeUndefined();
    expect(await fetchList('/api/static-objects')).toContainEqual(
      expect.objectContaining({
        object_id: 'ws-0a0c0001',
        object_version: 2,
        top_height_m: expect.closeTo(0.6, 5),
      }),
    );
    expect(Number((screen.getByLabelText('높이(m)') as HTMLInputElement).value)).toBeCloseTo(0.6);
    expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
  });

  it('작업면만 고쳐도 구역 모양·높이가 따라가므로 구역 UPDATE + 작업면 UPDATE 한 요청이다', async () => {
    await renderPage();
    pick('z-02');
    const height = await screen.findByLabelText('높이(m)');
    fireEvent.change(height, { target: { value: '2.5' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('단상 구역'));
    expect(writes()).toEqual([COMMIT]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      zone: { op: 'UPDATE', zone_id: 'z-02', body: { z_min_m: 0, z_max_m: 2.5 } },
      surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: { top_height_m: 2.5 } },
      publish: true,
    });
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-02', zone_version: 2 }),
    );
    expect(await fetchList('/api/static-objects')).toContainEqual(
      expect.objectContaining({ object_id: 'ws-0a0c0001', object_version: 2, top_height_m: 2.5 }),
    );
    expect(Number((screen.getByLabelText('높이(m)') as HTMLInputElement).value)).toBe(2.5);
  });

  it('구역이 이미 작업면 둘레 모양이면 작업면 높이만 2 m 아래로 고쳐도 구역은 KEEP 이라 새 버전을 만들지 않는다', async () => {
    await renderPage();
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    // 처음 저장으로 구역이 작업면 둘레 모양·경고가 된다.
    rename('단상 맞춤');
    act(() => button('저장').click());
    await waitFor(() => expect(optionTexts()).toContain('단상 맞춤'));
    commits.splice(0, commits.length);

    const height = screen.getByLabelText('높이(m)');
    fireEvent.change(height, { target: { value: '0.5' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    act(() => button('저장').click());
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]).toMatchObject({
      zone: { op: 'KEEP', zone_id: 'z-02' },
      surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: { top_height_m: 0.5 } },
    });
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-02', zone_version: 2 }),
    );
  });

  it('다른 관리자가 먼저 저장해 /commit 이 409(CONCURRENT_EDIT)면 최신 구역을 다시 받고, 초안은 남기고, 묶음 없이 다시 보내지 않는다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    failCommit(409, 'CONCURRENT_EDIT');
    rename('내 이름');
    log.splice(0, log.length);
    act(() => button('저장').click());
    expect(
      await screen.findByText(
        '그 사이 다른 버전이 저장되어 최신 구역을 다시 받았습니다. 확인한 뒤 다시 저장하세요.',
      ),
    ).toBeTruthy();
    // 저장 전 확인(GET) → /commit(409) → 항목을 다시 받는다(GET). 묶음 오류가 아니라 publish:false 로 다시 보내지 않는다.
    await waitFor(() =>
      expect(log.filter((e) => e === 'GET /api/zones').length).toBeGreaterThanOrEqual(2),
    );
    expect(writes()).toEqual([COMMIT]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ zone: { op: 'UPDATE', zone_id: 'z-04' }, publish: true });
    expect(log).not.toContain('POST /api/config-bundles');
    expect(optionTexts()).toContain('개구부 구역 · 저장 전');
    expect(screen.getByRole('textbox', { name: '이름' })).toHaveProperty('value', '내 이름');
    expect(useZoneEditStore.getState().drafts['z-04']).toBeDefined();
  });

  it('고치는 사이 다른 관리자가 새 버전을 저장했으면 /commit 을 보내지 않고 최신 구역을 보이며, 초안은 남긴다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    rename('내 이름');
    // 다른 관리자가 z-04 의 새 버전(v2)을 저장한다.
    const z04 = (await fetchList('/api/zones')).find((z) => z.zone_id === 'z-04')!;
    await sendJson('PUT', '/api/zones/z-04', {
      name: '다른 사람',
      zone_kind: z04.zone_kind,
      eval_type: z04.eval_type,
      polygon_xy: z04.polygon_xy,
      z_min_m: z04.z_min_m,
      z_max_m: z04.z_max_m,
      severity: z04.severity,
      has_guardrail: z04.has_guardrail,
      requirements: z04.requirements,
    });
    log.splice(0, log.length);
    act(() => button('저장').click());
    expect(
      await screen.findByText(
        '그 사이 다른 버전이 저장되어 최신 구역을 다시 받았습니다. 확인한 뒤 다시 저장하세요.',
      ),
    ).toBeTruthy();
    // 지금 버전을 확인하는 GET 만 보내고 /commit 은 보내지 않았다. 확인에서 받은 최신 구역이 화면에 들어갔다.
    expect(log).toEqual(['GET /api/zones']);
    expect(commits).toEqual([]);
    await waitFor(() => expect(optionTexts()).toContain('다른 사람 · 저장 전'));
    expect(nameInput().value).toBe('내 이름');
  });

  it('묶음을 못 만들면(409) 같은 본문을 publish:false 로 한 번 더 보내 저장만 하고, 한 줄·다시 보내기를 띄운다. 발행 전은 묶음 items 로 센다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    zonesMock.failNextPublish('CALIBRATION_MISSING');
    rename('개구부 B');
    act(() => button('저장').click());
    const alert = await screen.findByText(RETRY_TEXT);
    expect(alert).toBeTruthy();
    expect(screen.getByText('보정 문서가 없어 현장에 반영할 수 없습니다.')).toBeTruthy();
    // publish:true 가 409 로 되돌려져, 같은 본문을 묶음 없이(publish:false) 다시 보냈다.
    expect(writes()).toEqual([COMMIT, COMMIT]);
    expect(commits.map((c) => c.publish)).toEqual([true, false]);
    expect(commits[1]).toEqual({ ...commits[0]!, publish: false });
    // 저장은 됐으니 초안은 지워졌고, 새 버전(v2)은 마지막 묶음(cfg-12)의 items 에 없어 발행 전이다.
    expect(useZoneEditStore.getState().drafts['z-04']).toBeUndefined();
    await waitFor(() => expect(optionTexts()).toContain('개구부 B · 발행 전'));
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-04', zone_version: 2 }),
    );
    // 다시 보내기는 구성 묶음 발행 하나다(구역·작업면은 다시 보내지 않는다).
    log.splice(0, log.length);
    act(() => button('다시 보내기').click());
    await waitFor(() => expect(writes()).toEqual(['POST /api/config-bundles']));
    // 보내는 동안에는 띠만 숨고, 성공하면 알림도 사라진다.
    await waitFor(() =>
      expect(screen.queryByText('보정 문서가 없어 현장에 반영할 수 없습니다.')).toBeNull(),
    );
    expect(screen.queryByText(RETRY_TEXT)).toBeNull();
    await waitFor(() => expect(optionTexts()).toContain('개구부 B'));
    expect(commits).toHaveLength(2);
  });

  it.each([
    ['CURRENT_CALIBRATION_MISSING', '유효한 보정 문서가 없어 현장에 반영할 수 없습니다.'],
    ['RULES_MISSING', '유효한 규칙 버전이 없어 현장에 반영할 수 없습니다.'],
    ['PUBLIC_URL_NOT_SET', '서버 공개 주소가 설정되지 않아 현장에 반영할 수 없습니다.'],
  ] as const)(
    '묶음을 못 만드는 이유가 %s 여도 저장은 되고, 이유를 알리고 다시 보내기를 띄운다',
    async (code, reason) => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      zonesMock.failNextPublish(code);
      rename('개구부 B');
      act(() => button('저장').click());
      expect(await screen.findByText(RETRY_TEXT)).toBeTruthy();
      expect(screen.getByText(reason)).toBeTruthy();
      expect(commits.map((c) => c.publish)).toEqual([true, false]);
      await waitFor(() => expect(optionTexts()).toContain('개구부 B · 발행 전'));
      expect(button('다시 보내기')).toBeTruthy();
    },
  );

  it('묶음 오류가 아닌 서버 오류(SITE_NOT_SINGLE)는 다시 보내지 않고 저장 실패로 알리며, 아무것도 저장되지 않고 초안은 남는다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    zonesMock.failNextPublish('SITE_NOT_SINGLE');
    rename('개구부 B');
    act(() => button('저장').click());
    expect(await screen.findByText('현장이 하나로 정해지지 않아 저장할 수 없습니다.')).toBeTruthy();
    expect(commits.map((c) => c.publish)).toEqual([true]);
    expect(screen.queryByText(RETRY_TEXT)).toBeNull();
    // 서버가 구역 저장까지 되돌렸다(v1 그대로). 초안은 그대로 남는다.
    expect(await fetchList('/api/zones')).toContainEqual(
      expect.objectContaining({ zone_id: 'z-04', zone_version: 1, name: '개구부 구역' }),
    );
    await waitFor(() => expect(optionTexts()).toContain('개구부 구역 · 저장 전'));
    expect(nameInput().value).toBe('개구부 B');
  });

  it(
    '삭제는 두 번 눌러야 한다: 첫 클릭은 「삭제 확인」(3초 뒤 되돌아간다), 두 번째가 /commit 한 번(구역 ARCHIVE, 이은 작업면은 서버가 함께 보관)',
    async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      const deleteButton = () => screen.getAllByRole('button', { name: /^삭제( 확인)?$/ }).at(-1)!;
      act(() => deleteButton().click());
      expect(deleteButton().textContent).toBe('삭제 확인');
      expect(writes()).toEqual([]);
      await waitFor(() => expect(deleteButton().textContent).toBe('삭제'), {
        timeout: ARM_MS + 1500,
      });
      expect(writes()).toEqual([]);

      act(() => deleteButton().click());
      act(() => deleteButton().click());
      await waitFor(() => expect(optionTexts()).toEqual(['새 구역 추가', '개구부 구역']));
      expect(writes()).toEqual([COMMIT]);
      // 작업면 op 는 붙이지 않는다.
      expect(commits).toEqual([{ zone: { op: 'ARCHIVE', zone_id: 'z-02' }, publish: true }]);
      // 서버가 이은 작업면도 보관했고(책상만 남는다), 묶음에서도 빠져 다시 보내기가 없다.
      expect((await fetchList('/api/static-objects')).map((o) => o.object_id)).toEqual([
        'ws-0a0c0002',
      ]);
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
      // 삭제한 뒤에는 새 구역 양식으로 돌아간다.
      expect(picker().value).toBe('__new__');
      expect(useZoneEditStore.getState().drafts['z-02']).toBeUndefined();
    },
    ARM_MS + 8000,
  );

  it('작업면이 없는 구역을 삭제해도 구역 ARCHIVE 한 요청(publish)만 보낸다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    const deleteButton = () => button(/^삭제( 확인)?$/);
    act(() => deleteButton().click());
    act(() => deleteButton().click());
    await waitFor(() => expect(optionTexts()).toEqual(['새 구역 추가', '단상 구역']));
    expect(writes()).toEqual([COMMIT]);
    expect(commits).toEqual([{ zone: { op: 'ARCHIVE', zone_id: 'z-04' }, publish: true }]);
  });

  it('직사각형이 아닌 구역은 형상을 고칠 수 없다는 알림이 뜨고 3D 손잡이를 띄우지 않는다. 속성은 고칠 수 있다', async () => {
    await addTriangleZone();
    await renderPage();
    pick('z-00000001');
    expect(await screen.findByText(SHAPE_LOCKED_TEXT)).toBeTruthy();
    expect(useBoxEditStore.getState().boxEdit).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '삼각 B' },
    });
    expect((button('저장') as HTMLButtonElement).disabled).toBe(false);
    // 직사각형 구역에서는 보이지 않는다.
    pick('z-04');
    await waitFor(() => expect(screen.queryByText(SHAPE_LOCKED_TEXT)).toBeNull());
    expect(useBoxEditStore.getState().boxEdit?.kind).toBe('zone');
  });

  describe('새 구역 이름·작업면 붙인 새 구역', () => {
    it('이름을 정하지 않은 새 구역은 겹치지 않는 가장 작은 구분자다(새 구역은 작업면 없이 시작해 `위험구역 N`, -647)', async () => {
      await fetch('http://api.test/api/zones', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '위험구역 1',
          zone_kind: 'OPENING',
          eval_type: 'VOLUME_3D',
          polygon_xy: [
            [1, 1],
            [3, 1],
            [3, 3],
            [1, 3],
          ],
          z_min_m: 0,
          z_max_m: 2,
          severity: 'HIGH',
          has_guardrail: null,
          requirements: null,
        }),
      });
      await renderPage();
      expect(nameInput().value).toBe('위험구역 2');
    });

    it('AI 초안처럼 이름을 먼저 넣은 새 구역 초안은 기본 이름을 이긴다', async () => {
      useZoneEditStore
        .getState()
        .update(NEW_KEY, () => ({ patch: { name: '개구부 초안' }, box: null }));
      await renderPage();
      expect(nameInput().value).toBe('개구부 초안');
    });

    it('고소 작업면을 체크한 새 구역은 구역 손잡이가 없고 3D 손잡이가 작업면을 고치며, 작업면 둘레(0.30 m) 직사각형으로 만든다', async () => {
      await renderPage();
      // 체크하기 전에는 작업면이 없어 3D 손잡이가 구역 상자를 고친다.
      expect(useBoxEditStore.getState().boxEdit?.kind).toBe('zone');
      fireEvent.click(surfaceCheckbox());
      expect(severitySelect().value).toBe('HIGH');
      expect(screen.queryByRole('button', { name: '구역' })).toBeNull();
      const start = useBoxEditStore.getState().boxEdit!;
      expect(start.kind).toBe('surface');
      // 심각도는 작업면이 붙어도 고른 값 그대로 저장한다.
      fireEvent.change(severitySelect(), { target: { value: 'CRITICAL' } });

      // 손잡이로 작업면을 옮기면 구역이 따라간다.
      const moved: ViewerEditBox = {
        min: [start.box.min[0] + 1, start.box.min[1], 0],
        max: [start.box.max[0] + 1, start.box.max[1], start.box.max[2]],
      };
      dragTo(moved);
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual(moved);
      act(() => button('구역 추가').click());
      await waitFor(() => expect(commits).toHaveLength(1));
      const request = commits[0]!;
      if (request.zone.op !== 'CREATE') throw new Error('expected CREATE');
      expect(request.zone.body.severity).toBe('CRITICAL');
      const [cx, cy] = [(moved.min[0] + moved.max[0]) / 2, (moved.min[1] + moved.max[1]) / 2];
      expect(request.zone.body.polygon_xy).toEqual(
        [
          [cx - 0.8, cy - 0.8],
          [cx + 0.8, cy - 0.8],
          [cx + 0.8, cy + 0.8],
          [cx - 0.8, cy + 0.8],
        ].map(([x, y]) => [round3(x!), round3(y!)]),
      );
      expect([request.zone.body.z_min_m, request.zone.body.z_max_m]).toEqual([0, 2]);
      expect(request.surface).toMatchObject({ op: 'CREATE' });
    });

    it('바닥 판정 구역에 작업면이 붙으면 입체 판정으로 맞춰 저장한다', async () => {
      await addZone({ name: '바닥 구역', eval_type: 'GROUND_FOOTPRINT' });
      await linkDeskTo('z-00000001');
      await renderPage();
      pick('z-00000001');
      await screen.findByLabelText('높이(m)');
      expect(screen.queryByText(SHAPE_LOCKED_TEXT)).toBeNull();
      rename('바닥 구역 B');
      act(() => button('저장').click());
      await waitFor(() => expect(commits).toHaveLength(1));
      expect(commits[0]).toMatchObject({
        zone: { op: 'UPDATE', body: { eval_type: 'VOLUME_3D', severity: 'HIGH', z_max_m: 2 } },
      });
    });

    it('이미 저장된 주의 구역에 작업면이 붙어도 심각도 칸이 보이고, 위험이나 경고를 골라야 저장하며 고른 값 그대로 보낸다', async () => {
      await addZone({ name: '주의 구역', severity: 'CAUTION' });
      await linkDeskTo('z-00000001');
      await renderPage();
      pick('z-00000001');
      await screen.findByLabelText('높이(m)');
      expect(severitySelect().value).toBe('CAUTION');
      rename('주의 구역 B');
      expect((button('저장') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(severitySelect(), { target: { value: 'CRITICAL' } });
      expect((button('저장') as HTMLButtonElement).disabled).toBe(false);
      act(() => button('저장').click());
      await waitFor(() => expect(commits).toHaveLength(1));
      expect(commits[0]).toMatchObject({ zone: { op: 'UPDATE', body: { severity: 'CRITICAL' } } });
    });

    it('직사각형이 아닌 구역에 작업면이 붙으면 형상 잠김 알림이 없다', async () => {
      await addTriangleZone();
      await linkDeskTo('z-00000001');
      await renderPage();
      pick('z-00000001');
      expect(await screen.findByLabelText('높이(m)')).toHaveProperty('value', '0.74');
      expect(screen.queryByText(SHAPE_LOCKED_TEXT)).toBeNull();
      // 책상은 회전해 있어 3D 손잡이가 없다(높이 칸만 고친다).
      expect(useBoxEditStore.getState().boxEdit).toBeNull();
    });
  });

  describe('3D 에서 고른 작업면', () => {
    const OBSTACLE = {
      kind: 'OBSTACLE',
      name: '기둥',
      obb: { center: [8, 8, 1], size: [0.4, 0.4, 2], yaw_rad: 0 },
      top_height_m: null,
      top_height_sigma_m: null,
    };

    it('구역에 이어진 작업면을 누르면 그 구역을 열고 3D 손잡이는 그 작업면을 고친다', async () => {
      await renderPage();
      selectInViewer('object:ws-0a0c0001');
      await waitFor(() => expect(picker().value).toBe('z-02'));
      expect(orphanCard()).toBeNull();
      expect(useBoxEditStore.getState().boxEdit).toMatchObject({
        id: 'surface:z-02',
        kind: 'surface',
      });
    });

    it('열어 둔 작업면이 목록에서 사라지면 3D 손잡이는 구역 상자로 돌아간다', async () => {
      const { client } = await renderPage();
      selectInViewer('object:ws-0a0c0001');
      await waitFor(() => expect(useBoxEditStore.getState().boxEdit?.kind).toBe('surface'));
      act(() =>
        client.setQueryData<Json[]>(STATIC_OBJECTS_KEY, (list) =>
          list?.filter((item) => item.object_id !== 'ws-0a0c0001'),
        ),
      );
      await waitFor(() =>
        expect(useBoxEditStore.getState().boxEdit).toMatchObject({ id: 'z-02', kind: 'zone' }),
      );
    });

    it('구역에 이어지지 않은 작업면을 누르면 구역 대신 작업면 카드(상판 높이·삭제)를 보이고 3D 손잡이는 내린다', async () => {
      await renderPage();
      selectInViewer('object:ws-0a0c0002');
      expect(await screen.findByRole('region', { name: '작업면' })).toBeTruthy();
      expect(screen.getByText('상판 0.74m')).toBeTruthy();
      expect(screen.queryByRole('textbox', { name: '이름' })).toBeNull();
      expect(screen.queryByRole('button', { name: '구역 추가' })).toBeNull();
      expect(useBoxEditStore.getState().boxEdit).toBeNull();
      // 드롭다운은 어느 구역도 고르지 않은 빈 칸을 보인다(구역을 골라 카드에서 빠져나온다).
      const [blank] = picker().options;
      expect([picker().value, blank!.value, blank!.disabled, blank!.hidden]).toEqual([
        '',
        '',
        true,
        true,
      ]);
      pick('z-04');
      await waitFor(() => expect(orphanCard()).toBeNull());
      expect(picker().value).toBe('z-04');
      expect([...picker().options].some((option) => option.value === '')).toBe(false);
      expect(nameInput().value).toBe('개구부 구역');
    });

    it('한 구역의 둘째 작업면도 구역 화면에서 닿을 수 없어 작업면 카드로 지운다', async () => {
      // 책상을 단상 구역(z-02)에도 잇는다. 한 구역에는 작업면 ID 순으로 앞선 단상 작업면만 이어진다.
      await sendJson('PUT', '/api/static-objects/ws-0a0c0002', {
        ...surfaceBodyOf(await deskOf()),
        zone_id: 'z-02',
      });
      log.splice(0, log.length);
      await renderPage();
      selectInViewer('object:ws-0a0c0002');
      expect(await screen.findByText('상판 0.74m')).toBeTruthy();
      expect(orphanCard()).toBeTruthy();

      act(() => button('삭제').click());
      act(() => button('삭제 확인').click());
      await waitFor(() => expect(orphanCard()).toBeNull());
      // 발행은 삭제가 끝난 뒤에 나간다. 끝나기 전에 시험이 끝나면 그 요청이 다음 시험의 기록에 섞인다.
      await waitFor(() =>
        expect(writes()).toEqual([
          'DELETE /api/static-objects/ws-0a0c0002',
          'POST /api/config-bundles',
        ]),
      );
      // 단상 구역에 이어진 첫 작업면은 그대로다.
      pick('z-02');
      expect(await screen.findByLabelText('높이(m)')).toHaveProperty('value', '0.40');
    });

    it('작업면 삭제는 두 번 눌러야 하고, DELETE 한 뒤 선택을 풀고 구성 묶음을 발행한다', async () => {
      await renderPage();
      selectInViewer('object:ws-0a0c0002');
      await screen.findByRole('region', { name: '작업면' });
      const deleteButton = () => button(/^삭제( 확인)?$/);

      act(() => deleteButton().click());
      expect(deleteButton().textContent).toBe('삭제 확인');
      expect(writes()).toEqual([]);

      act(() => deleteButton().click());
      await waitFor(() => expect(orphanCard()).toBeNull());
      await waitFor(() =>
        expect(writes()).toEqual([
          'DELETE /api/static-objects/ws-0a0c0002',
          'POST /api/config-bundles',
        ]),
      );
      // 작업면은 목록에서 빠졌고 선택이 풀렸으며 새 구역 양식으로 돌아갔다.
      expect((await fetchList('/api/static-objects')).map((o) => o.object_id)).toEqual([
        'ws-0a0c0001',
      ]);
      expect(viewport.selectedKey).toBeNull();
      expect(picker().value).toBe('__new__');
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
    });

    it('삭제는 됐는데 발행을 못 하면 다시 보내기가 뜨고, 다시 보내면 사라진다', async () => {
      await renderPage();
      selectInViewer('object:ws-0a0c0002');
      await screen.findByRole('region', { name: '작업면' });
      zonesMock.failNextPublish('CURRENT_CALIBRATION_MISSING');
      act(() => button('삭제').click());
      act(() => button('삭제 확인').click());

      expect(await screen.findByText(RETRY_TEXT)).toBeTruthy();
      expect(writes()).toEqual([
        'DELETE /api/static-objects/ws-0a0c0002',
        'POST /api/config-bundles',
      ]);
      act(() => button('다시 보내기').click());
      // 보내는 동안에도 다시 보내기가 숨으므로, 요청이 실제로 나간 것을 먼저 보고 끝낸다(안 그러면 다음 시험의 기록에 섞인다).
      await waitFor(() =>
        expect(writes()).toEqual([
          'DELETE /api/static-objects/ws-0a0c0002',
          'POST /api/config-bundles',
          'POST /api/config-bundles',
        ]),
      );
      await waitFor(() => expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull());
    });

    it('삭제가 실패하면 알리고 발행하지 않으며, 목록을 다시 받은 뒤에도 작업면 카드는 그대로다', async () => {
      server.use(
        http.delete('*/api/static-objects/:objectId', () =>
          HttpResponse.json(
            { status: 404, detail: 'x', code: 'STATIC_OBJECT_NOT_FOUND' },
            { status: 404 },
          ),
        ),
      );
      await renderPage();
      selectInViewer('object:ws-0a0c0002');
      await screen.findByRole('region', { name: '작업면' });
      const listGetsBefore = objectListGets;
      act(() => button('삭제').click());
      act(() => button('삭제 확인').click());

      expect(
        await screen.findByText('이미 없거나 보관된 작업면입니다. 목록을 다시 받았습니다.'),
      ).toBeTruthy();
      await waitFor(() => expect(objectListGets).toBeGreaterThan(listGetsBefore));
      expect(orphanCard()).toBeTruthy();
      expect(writes()).toEqual(['DELETE /api/static-objects/ws-0a0c0002']);
      expect(screen.queryByRole('button', { name: '다시 보내기' })).toBeNull();
    });

    it('작업면이 아닌 정적 객체(장애물)를 누르면 카드를 띄우지 않는다', async () => {
      const obstacle = await addStaticObject(OBSTACLE);
      expect(obstacle.kind).toBe('OBSTACLE');
      await renderPage();
      selectInViewer(`object:${String(obstacle.object_id)}`);
      expect(orphanCard()).toBeNull();
      expect(nameInput()).toBeTruthy();
    });

    it('형상을 고칠 수 없는 구역을 보던 중이어도 작업면 카드에는 그 경고를 띄우지 않는다', async () => {
      await addTriangleZone();
      await renderPage();
      pick('z-00000001');
      expect(await screen.findByText(SHAPE_LOCKED_TEXT)).toBeTruthy();

      selectInViewer('object:ws-0a0c0002');
      expect(await screen.findByRole('region', { name: '작업면' })).toBeTruthy();
      expect(screen.queryByText(SHAPE_LOCKED_TEXT)).toBeNull();
    });

    it('작업면 카드가 구역 양식을 가린 동안 Ctrl+Z 는 가려진 구역의 초안을 되돌리지 않는다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      rename('고치는 중');
      selectInViewer('object:ws-0a0c0002');
      await screen.findByRole('region', { name: '작업면' });

      expect(pressUndo()).toBe(true);
      expect(useZoneEditStore.getState().drafts['z-04']?.patch.name).toBe('고치는 중');
      pick('z-04');
      await waitFor(() => expect(nameInput().value).toBe('고치는 중'));
    });
  });

  describe('편집 모드 드나들기', () => {
    it('편집이 시작되면 다른 관리자가 저장한 변경이 보이게 작업면 목록을 다시 받는다', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(STATIC_OBJECTS_KEY, []);
      render(
        <QueryClientProvider client={client}>
          <ZonesPage />
        </QueryClientProvider>,
      );
      // 목록이 이미 있어도(무한 신선) 편집이 시작될 때 한 번 다시 받는다.
      await waitFor(() => expect(objectListGets).toBe(1));
    });

    it('편집이 끝나면(화면이 내려가면) 3D 에서 고른 작업면 선택은 풀고 구역 선택은 그대로 둔다', async () => {
      const first = await renderPage();
      selectInViewer('object:ws-0a0c0002');
      await screen.findByRole('region', { name: '작업면' });
      first.unmount();
      expect(viewport.selectedKey).toBeNull();

      viewport.selectedKey = 'zone:z-02';
      const second = await renderPage();
      second.unmount();
      expect(viewport.selectedKey).toBe('zone:z-02');
    });
  });

  it('구역을 바꿔도 고치던 초안은 남는다', async () => {
    await renderPage();
    pick('z-04');
    await waitFor(noSurfaceCard);
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '고치는 중' },
    });
    pick('z-02');
    await screen.findByLabelText('높이(m)');
    expect(optionTexts()).toContain('개구부 구역 · 저장 전');
    pick('z-04');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '이름' })).toHaveProperty('value', '고치는 중'),
    );
  });
  describe('Ctrl+Z 되돌리기', () => {
    it('이름·심각도를 고친 것을 한 단계씩 되돌린다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      const savedName = nameInput().value;
      const savedSeverity = severitySelect().value;
      rename('다른 이름');
      fireEvent.change(severitySelect(), {
        target: { value: savedSeverity === 'CRITICAL' ? 'HIGH' : 'CRITICAL' },
      });

      expect(pressUndo()).toBe(false);
      expect(severitySelect().value).toBe(savedSeverity);
      expect(nameInput().value).toBe('다른 이름');
      expect(optionTexts()).toContain('개구부 구역 · 저장 전');

      pressUndo();
      expect(nameInput().value).toBe(savedName);
      expect(optionTexts()).toContain('개구부 구역');

      // 더 되돌릴 것이 없으면 브라우저 기본 동작을 막지 않는다.
      expect(pressUndo()).toBe(true);
      expect(nameInput().value).toBe(savedName);
    });

    it('이름을 연달아 입력한 것은 한 단계이고, 다른 고침이 끼면 새 단계다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      const savedName = nameInput().value;
      rename('개');
      rename('개구');
      rename('개구부 B');
      fireEvent.change(severitySelect(), { target: { value: 'HIGH' } });
      rename('개구부 C');
      expect(useZoneEditStore.getState().history['z-04']).toHaveLength(3);

      pressUndo();
      expect(nameInput().value).toBe('개구부 B');
      pressUndo();
      pressUndo();
      expect(nameInput().value).toBe(savedName);
    });

    it('3D 손잡이로 끈 것은 포인터를 놓을 때까지 한 단계다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      rename('다른 이름');
      dragTo({ min: [1.5, 6.2, 0], max: [4.5, 8.4, 0.4] });
      dragTo({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] });
      dragTo({ min: [2.5, 6.2, 0], max: [5.5, 8.4, 0.4] });
      releasePointer();
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(2);

      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual(Z02_BOX);
      expect(nameInput().value).toBe('다른 이름');
      expect(optionTexts()).toContain('단상 구역 · 저장 전');

      pressUndo();
      expect(nameInput().value).toBe('단상 구역');
      expect(optionTexts()).toContain('단상 구역');
    });

    it('끄는 중 Esc 로 시작 상자로 돌아오면 그 끌기는 되돌릴 단계가 아니다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      rename('다른 이름');
      dragTo({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] });
      dragTo(Z02_BOX);
      releasePointer();
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(1);

      pressUndo();
      expect(nameInput().value).toBe('단상 구역');
      expect(optionTexts()).toContain('단상 구역');
    });

    it('끄는 중 다른 고침이 단계를 더했으면 시작 상자로 돌아와도 그 단계를 버리지 않는다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      pressPointer();
      dragTo({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] });
      rename('다른 이름');
      dragTo(Z02_BOX);
      releasePointer();
      // 끌기 단계(내용 없음)와 이름 단계. 이름 단계가 끌기 것으로 오해돼 사라지면 1 이다.
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(2);

      pressUndo();
      pressUndo();
      expect(nameInput().value).toBe('단상 구역');
      expect(pressUndo()).toBe(true);
    });

    it('상한에 닿은 기록에서도 끄는 중 쌓인 다른 단계를 버리지 않는다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      // 기록을 상한까지 채운다. 화면으로 이름·심각도를 200번 고쳐 채우면 고칠 때마다 화면 전체를 다시 그려 전체 시험에서
      // 4 s 넘게 걸리고 부하가 걸리면 5 s 시간 초과가 났다(S15P31A101-674). 앞 단계는 store 로 채우고(고치기 전 초안이 없던
      // 단계), 끌기 직전의 고침과 끌기는 화면으로 한다. 단계마다 묶음 이름이 달라 서로 합쳐지지 않는다.
      act(() => {
        for (let i = 0; i < HISTORY_LIMIT; i++) {
          useZoneEditStore.getState().record('z-04', `채움 ${i}`);
        }
      });
      expect(useZoneEditStore.getState().history['z-04']).toHaveLength(HISTORY_LIMIT);
      rename(`이름 ${HISTORY_LIMIT - 1}`);
      pressPointer();
      dragTo(MOVED_Z04_BOX);
      rename('끄는 중 이름');
      dragTo(Z04_BOX);
      releasePointer();

      // 기록이 가득 차 있어도 새 단계는 가장 오래된 것을 밀어낼 뿐이라 개수로는 끌기 뒤에 단계가 더해졌는지 알 수 없다.
      expect(useZoneEditStore.getState().history['z-04']).toHaveLength(HISTORY_LIMIT);
      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual(MOVED_Z04_BOX);
      expect(nameInput().value).toBe(`이름 ${HISTORY_LIMIT - 1}`);
    });

    it('포인터 놓음을 받지 못한 끌기는 다음 누름에서 닫혀 다음 끌기와 한 단계로 합쳐지지 않는다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      pressPointer();
      dragTo({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] });
      // 창 밖에서 놓아 pointerup 이 오지 않았다.
      pressPointer();
      dragTo({ min: [3, 6.2, 0], max: [6, 8.4, 0.4] });
      releasePointer();
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(2);

      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual({
        min: [2, 6.2, 0],
        max: [5, 8.4, 0.4],
      });
      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual(Z02_BOX);
    });

    it('끌기를 이어서 두 번 하면 두 단계다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      dragTo({ min: [2, 6.2, 0], max: [5, 8.4, 0.4] });
      releasePointer();
      dragTo({ min: [3, 6.2, 0], max: [6, 8.4, 0.4] });
      releasePointer();

      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual({
        min: [2, 6.2, 0],
        max: [5, 8.4, 0.4],
      });
      pressUndo();
      expect(useBoxEditStore.getState().boxEdit?.box).toEqual(Z02_BOX);
      expect(optionTexts()).toContain('단상 구역');
    });

    it('작업면 높이를 고친 뒤 포커스를 잃어도 같은 값은 단계를 더하지 않는다', async () => {
      await renderPage();
      pick('z-02');
      const height = await screen.findByLabelText('높이(m)');
      fireEvent.change(height, { target: { value: '0.6' } });
      fireEvent.keyDown(height, { key: 'Enter' });
      fireEvent.blur(height);
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(1);

      pressUndo();
      expect(screen.getByLabelText('높이(m)')).toHaveProperty('value', '0.40');
    });

    it('새 구역의 작업면 높이를 고친 것도 되돌리면 기본 높이로 돌아온다', async () => {
      await renderPage();
      fireEvent.click(surfaceCheckbox());
      const height = screen.getByLabelText('높이(m)');
      fireEvent.change(height, { target: { value: '0.9' } });
      fireEvent.keyDown(height, { key: 'Enter' });
      fireEvent.blur(height);
      expect(screen.getByLabelText('높이(m)')).toHaveProperty('value', '0.90');

      pressUndo();
      expect(screen.getByLabelText('높이(m)')).toHaveProperty('value', '0.40');
      expect(useBoxEditStore.getState().boxEdit?.kind).toBe('surface');
    });

    it('이름·심각도·높이 입력칸 안의 Ctrl+Z 는 초안을 건드리지 않고 브라우저 기본 동작에 맡긴다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      rename('다른 이름');
      fireEvent.change(severitySelect(), { target: { value: 'HIGH' } });

      expect(pressUndo(nameInput())).toBe(true);
      expect(pressUndo(severitySelect())).toBe(true);
      expect(nameInput().value).toBe('다른 이름');
      expect(severitySelect().value).toBe('HIGH');
      expect(useZoneEditStore.getState().history['z-04']).toHaveLength(2);

      // 버튼에 포커스가 있을 때는 되돌린다.
      pressUndo(button('되돌리기'));
      expect(severitySelect().value).toBe('CRITICAL');
    });

    it('작업면 높이 칸 안의 Ctrl+Z 도 초안을 건드리지 않는다', async () => {
      await renderPage();
      pick('z-02');
      const height = await screen.findByLabelText('높이(m)');
      fireEvent.change(height, { target: { value: '0.6' } });
      fireEvent.keyDown(height, { key: 'Enter' });
      expect(pressUndo(height)).toBe(true);
      expect(useZoneEditStore.getState().history['z-02']).toHaveLength(1);
    });

    it('한글 조합 중이거나 시프트·알트와 함께 누른 키는 무시하고, 한글 자판이어도 자판 위치로 되돌린다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      rename('다른 이름');

      pressUndo(window, { isComposing: true });
      pressUndo(window, { keyCode: 229 });
      pressUndo(window, { shiftKey: true });
      pressUndo(window, { altKey: true });
      pressUndo(window, { ctrlKey: false });
      expect(nameInput().value).toBe('다른 이름');

      pressUndo(window, { key: 'ㅋ' });
      expect(nameInput().value).not.toBe('다른 이름');
    });

    it('저장한 뒤에는 저장 전 값으로 되돌리지 않는다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      rename('개구부 B');
      expect(useZoneEditStore.getState().history['z-04']).toHaveLength(1);
      act(() => button('저장').click());
      await waitFor(() => expect(optionTexts()).toContain('개구부 B'));
      expect(writes()).toEqual([COMMIT]);
      // 저장한 값이 새 기준이라 초안과 되돌리기 기록이 모두 사라졌다.
      expect(useZoneEditStore.getState().drafts['z-04']).toBeUndefined();
      expect(useZoneEditStore.getState().history['z-04']).toBeUndefined();

      expect(pressUndo()).toBe(true);
      expect(nameInput().value).toBe('개구부 B');
      expect(optionTexts()).toContain('개구부 B');
    });

    it('되돌리기 버튼·구역 추가 뒤에는 그 구역의 기록이 없다', async () => {
      await renderPage();
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      rename('다른 이름');
      act(() => button('되돌리기').click());
      expect(useZoneEditStore.getState().history['z-02']).toBeUndefined();

      pick('__new__');
      rename('새로 만든 구역');
      act(() => button('구역 추가').click());
      await waitFor(() => expect(picker().value).toBe('z-00000001'));
      expect(writes()).toEqual([COMMIT]);
      expect(useZoneEditStore.getState().history[NEW_KEY]).toBeUndefined();
      expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeUndefined();
    });

    it('구역을 바꿔도 구역마다 기록이 남아 각자 되돌린다', async () => {
      await renderPage();
      pick('z-04');
      await waitFor(noSurfaceCard);
      rename('개구부 B');
      pick('z-02');
      await screen.findByLabelText('높이(m)');
      rename('단상 B');

      pressUndo();
      expect(nameInput().value).toBe('단상 구역');
      pick('z-04');
      await waitFor(() => expect(nameInput().value).toBe('개구부 B'));
      pressUndo();
      expect(nameInput().value).toBe('개구부 구역');
    });
  });
});

describe('작업 레이아웃 구역 편집', () => {
  it('레이아웃 구역 이름 변경과 새 구역 추가는 layout PUT으로 저장한다', async () => {
    const tbm = createTbmMock();
    tbm.bindLayoutZones(zonesMock.layoutZones);
    server.use(...tbm.handlers);
    await fetch('http://api.test/api/work-units/1/start', { method: 'POST' });
    log.splice(0);
    await renderPage({ workLayoutId: 101 });
    await screen.findByRole('option', { name: '비계 S1' });
    const zone = (
      await (
        await fetch('http://api.test/api/zones', {
          headers: { Authorization: 'Bearer mock-token.admin' },
        })
      ).json()
    ).find((z: { layout_item_id?: string }) => z.layout_item_id === 'pos-01');
    pick(zone.zone_id);
    expect(screen.queryByLabelText('심각도')).toBeNull();
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '수정한 작업면' } });
    fireEvent.click(button('저장'));
    await waitFor(() => expect(tbm.layouts[0]?.items[0]?.label).toBe('수정한 작업면'));
    expect(writes()).toContain('PUT /api/layouts/101');
    expect(writes()).not.toContain(COMMIT);
    pick(NEW_KEY);
    expect(screen.queryByLabelText('심각도')).toBeNull();
    fireEvent.click(surfaceCheckbox());
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새 작업면' } });
    fireEvent.click(button('구역 추가'));
    await waitFor(() =>
      expect(
        tbm.layouts[0]?.items.some(
          (item) => item.label === '새 작업면' && item.kind === 'WORK_SURFACE',
        ),
      ).toBe(true),
    );
    // mock 서버에 항목이 생긴 것만으로는 화면이 추가를 마무리했는지 모른다. 화면은 새 구역 초안을 지우고 만든 구역을 열어
    // 드롭다운이 그 구역으로 바뀐다. 그 전에 새 구역을 고르면 드롭다운 값이 아직 새 구역이라 바뀜이 일어나지 않고, 뒤이어
    // 만든 작업면 구역이 열려(고소 작업면 켬) 아래 단정이 깨졌다(S15P31A101-674 반복 실행). 만든 구역이 열리길 기다린다.
    await waitFor(() => {
      expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeUndefined();
      expect(picker().value).not.toBe(NEW_KEY);
    });
    expect(writes()).not.toContain(COMMIT);
    pick(NEW_KEY);
    expect(surfaceCheckbox().checked).toBe(false);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새 개구부' } });
    fireEvent.click(button('구역 추가'));
    await waitFor(() =>
      expect(
        tbm.layouts[0]?.items.some((item) => item.label === '새 개구부' && item.kind === 'OPENING'),
      ).toBe(true),
    );
    expect(writes()).not.toContain(COMMIT);
  });
});

describe('구역 추가 단추로 여는 양식(addOnDemand)', () => {
  /** 접힌 패널: 구역 고르기·이름·고소 작업면 없이 구역 추가 단추뿐이다. */
  const expectCollapsed = () => {
    expect(screen.queryByRole('combobox', { name: '구역 선택' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '이름' })).toBeNull();
    expect(screen.queryByRole('region', { name: '고소 작업면' })).toBeNull();
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: '구역 편집 도구' })).getAllByRole('button'),
    ).toEqual([button('구역 추가')]);
  };
  const openAdd = () => act(() => button('구역 추가').click());

  it('처음에는 구역 추가 단추 하나만 보이고 3D 에도 새 구역 상자를 내리지 않는다', async () => {
    await renderPage({ addOnDemand: true });
    expectCollapsed();
    expect(useBoxEditStore.getState().boxEdit).toBeNull();
  });

  it('구역 추가를 누르면 새 구역 양식 전체와 취소 단추가 나오고 3D 손잡이가 올라온다', async () => {
    await renderPage({ addOnDemand: true });
    openAdd();
    expect(picker().value).toBe(NEW_KEY);
    expect(nameInput().value).toBe('위험구역 1');
    expect(screen.getByRole('region', { name: '고소 작업면' })).toBeTruthy();
    // 시작 단추는 사라지고 아래 제출 단추가 구역 추가다(같은 이름의 단추가 둘이면 getByRole 이 실패한다).
    expect(button('구역 추가')).toBeTruthy();
    expect(button('취소')).toBeTruthy();
    expect(useBoxEditStore.getState().boxEdit).toMatchObject({ id: NEW_KEY, kind: 'zone' });
  });

  it('취소하면 다시 접히고 입력하던 이름·초안을 버려, 다시 펼치면 새 양식이다', async () => {
    await renderPage({ addOnDemand: true });
    openAdd();
    rename('입력하다 만 구역');
    expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeDefined();

    act(() => button('취소').click());
    expectCollapsed();
    expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeUndefined();
    expect(useBoxEditStore.getState().boxEdit).toBeNull();
    expect(writes()).toEqual([]);

    openAdd();
    expect(nameInput().value).toBe('위험구역 1');
  });

  it('기존 구역을 3D 에서 고르면 접히지 않고 저장·되돌리기·삭제가 있는 전체 패널이다', async () => {
    await renderPage({ addOnDemand: true });
    selectInViewer('zone:z-04');
    await waitFor(() => expect(picker().value).toBe('z-04'));
    expect(nameInput().value).toBe('개구부 구역');
    expect(button('저장')).toBeTruthy();
    expect(button('되돌리기')).toBeTruthy();
    expect(button('삭제')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
  });

  it('처음부터 구역이 골라져 있으면 접히지 않는다', async () => {
    viewport.selectedKey = 'zone:z-04';
    await renderPage({ addOnDemand: true });
    expect(picker().value).toBe('z-04');
  });

  it('기존 구역을 보다가 드롭다운에서 새 구역 추가를 고르면 새 구역 양식이 열린다', async () => {
    await renderPage({ addOnDemand: true });
    selectInViewer('zone:z-04');
    await waitFor(() => expect(picker().value).toBe('z-04'));

    pick(NEW_KEY);
    expect(picker().value).toBe(NEW_KEY);
    expect(nameInput().value).toBe('위험구역 1');
    expect(button('취소')).toBeTruthy();
  });

  it('3D 에서 작업면 카드가 뜨면 전체 패널이고, 선택이 풀리면 다시 접힌다', async () => {
    await renderPage({ addOnDemand: true });
    selectInViewer('object:ws-0a0c0002');
    expect(await screen.findByRole('region', { name: '작업면' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '구역 선택' })).toBeTruthy();

    selectInViewer(null);
    await waitFor(() => expect(orphanCard()).toBeNull());
    expectCollapsed();
  });

  it('추가에 성공하면 만든 구역을 고르지 않고 접히며 onCommitted 를 부른다', async () => {
    const onCommitted = vi.fn();
    await renderPage({ addOnDemand: true, onCommitted });
    openAdd();
    rename('새로 만든 구역');
    act(() => button('구역 추가').click());

    await waitFor(() => expect(screen.queryByRole('textbox', { name: '이름' })).toBeNull());
    expectCollapsed();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ zone: { op: 'CREATE', body: { name: '새로 만든 구역' } } });
    // 고소 작업면을 체크하지 않았으니 작업면은 만들지 않는다.
    expect(commits[0]).not.toHaveProperty('surface');
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(viewport.selectedKey).toBeNull();
    expect(useZoneEditStore.getState().drafts[NEW_KEY]).toBeUndefined();
    expect((await fetchList('/api/zones')).map((zone) => zone.name)).toContain('새로 만든 구역');

    // 다시 펼치면 새 양식이다(방금 만든 구역이 열리지 않는다).
    openAdd();
    expect(picker().value).toBe(NEW_KEY);
    expect(nameInput().value).not.toBe('새로 만든 구역');
  });

  it('추가가 실패하면 접히지 않고 양식과 입력을 그대로 두고 알림을 보인다', async () => {
    await renderPage({ addOnDemand: true });
    openAdd();
    rename('실패할 구역');
    failCommit(409, 'CONCURRENT_EDIT');
    act(() => button('구역 추가').click());

    expect(
      await screen.findByText(
        '그 사이 다른 버전이 저장되어 최신 구역을 다시 받았습니다. 확인한 뒤 다시 저장하세요.',
      ),
    ).toBeTruthy();
    expect(nameInput().value).toBe('실패할 구역');
    expect(button('취소')).toBeTruthy();
  });

  it('접힌 상태에서도 구역 목록을 못 불러왔다는 알림이 보인다', async () => {
    server.use(http.get('*/api/zones', () => HttpResponse.json({ status: 500 }, { status: 500 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ZonesPage addOnDemand />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '구역 목록을 불러오지 못했습니다.',
    );
    expect(screen.queryByRole('textbox', { name: '이름' })).toBeNull();
    expect(button('구역 추가')).toBeTruthy();
  });

  it('addOnDemand 가 없으면 양식이 늘 열려 있고 취소 단추가 없다', async () => {
    await renderPage();
    expect(picker().value).toBe(NEW_KEY);
    expect(nameInput().value).toBe('위험구역 1');
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
  });
});

import { AlarmBanner } from '@/features/events/AlarmBanner';
import { useEventClearStore } from '@/features/events/eventClear.store';
import { applyEvents, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import {
  SpatialViewportContext,
  type SpatialViewportValue,
} from '@/features/layout/SpatialViewportHost';
import { HostEventPanel } from '@/features/layout/spatialHost/HostEventPanel';
import { MonitorPage } from '@/features/monitor/MonitorPage';
import { WorkSessionBar } from '@/features/monitor/WorkSessionBar';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { todayIsoDate } from '@/features/tbm/taskInput';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 관제 화면의 작업 세션 연동(S15P31A101-457). API 주소는 존재하지 않는 도메인(.invalid)이라 새는 연결이 DNS 에서 끝난다.
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'https://monitor-session.invalid' }) };
});
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: undefined, failed: false }),
}));

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** 오늘 날짜(작업 날짜). 관제의 오늘 작업 판정이 브라우저 시각의 오늘을 쓴다. */
const TODAY = todayIsoDate();
const YESTERDAY = todayIsoDate(new Date(Date.now() - DAY));
/** 작업 시작 시각. 이벤트는 이 시각을 기준으로 앞뒤에 둔다. */
const STARTED = Date.now() - 60 * MIN;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
/** 최근 구성 묶음(GET /api/config-bundles). 기본은 묶음 없음(현장이 작업 묶음을 쓰지 않는다). */
const serveBundles = (bundles: unknown[]) =>
  server.use(
    http.get('https://monitor-session.invalid/api/config-bundles', () =>
      HttpResponse.json(bundles),
    ),
  );

/** 묶음 하나. ppe_policy.work_id 가 그 묶음의 작업(null 이면 작업 없음 묶음)이다. */
function configBundle(version: string, status: string, workId: number | null, issuedAt = STARTED) {
  return {
    config_version: version,
    issued_at: issuedAt,
    status,
    applied_at: status === 'APPLIED' ? issuedAt : null,
    last_ack: null,
    items: [],
    ppe_policy: {
      helmet: workId === null ? 'NOT_REQUIRED' : 'REQUIRED',
      vest: workId === null ? 'NOT_REQUIRED' : 'REQUIRED',
      work_id: workId,
      effective_from_ms: issuedAt,
    },
  };
}

beforeEach(() => {
  navigate.mockReset();
  serveBundles([]);
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

/** 서버가 주는 작업 한 건(GET /api/work-units). 시각은 epoch ms 숫자다. 기본은 날짜만 열린 작업(보고서 작성 단계)이다. */
function serverWork(patch: Record<string, unknown> = {}) {
  return {
    work_id: '12',
    status: 'PLANNED',
    progress: 'REPORT',
    date: TODAY,
    name: '양중 작업',
    from_ms: STARTED - 30 * MIN,
    to_ms: STARTED + 240 * MIN,
    zone_id: 'z-04',
    place: '개구부 구역',
    planned_people: 3,
    lead: 'B조',
    layout_id: null,
    work_type: null,
    actual_started_at: null,
    actual_ended_at: null,
    active_setup_session_id: null,
    event_counts: { CRITICAL: 0, HIGH: 0 },
    ...patch,
  };
}

const inProgress = (patch: Record<string, unknown> = {}) =>
  serverWork({
    status: 'IN_PROGRESS',
    progress: 'IN_PROGRESS',
    actual_started_at: STARTED,
    ...patch,
  });

/** 세팅을 마치고 작업 전 확인을 기다리는 작업(아직 시작 전이라 상태는 예정이다). */
const setupDone = (patch: Record<string, unknown> = {}) =>
  serverWork({ progress: 'SETUP_DONE', ...patch });

/** 오늘 끝난 작업. */
const done = (patch: Record<string, unknown> = {}) =>
  serverWork({
    status: 'DONE',
    progress: 'ENDED',
    actual_started_at: STARTED - 300 * MIN,
    actual_ended_at: STARTED - 60 * MIN,
    ...patch,
  });

const serveWorks = (works: unknown[]) =>
  server.use(
    http.get('https://monitor-session.invalid/api/work-units', () => HttpResponse.json({ works })),
  );

function item(change: Partial<EventItem> = {}): EventItem {
  const raisedAt = change.raised_at ?? STARTED + 10 * MIN;
  return {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CAUTION',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0012'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: raisedAt,
    updated_at: raisedAt,
    ...change,
  };
}

/** 3D 호스트가 칼럼의 위험 구역 목록에 주는 값(구역은 없다). */
const VIEWPORT: SpatialViewportValue = {
  view: '3d',
  viewerReady: true,
  selectedKey: null,
  selectedZoneId: null,
  zones: [],
  zonesRaw: undefined,
  zonesFailed: false,
  selectTarget: () => undefined,
  clearSelection: vi.fn(),
};

/** 관제 화면 조각(칼럼·대기 화면·세션 바·경보 배너·이벤트 패널)을 이벤트가 든 캐시와 함께 그린다. */
function renderMonitor(events: EventItem[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  applyEvents(queryClient, events);
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => ({
    entries: [],
    ...old,
    loaded: true,
  }));
  render(
    <QueryClientProvider client={queryClient}>
      <SpatialViewportContext value={VIEWPORT}>
        <MonitorPage />
      </SpatialViewportContext>
      <WorkSessionBar />
      <AlarmBanner withPanel />
      <HostEventPanel visible selectedKey={null} onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const sessionBar = () => screen.queryByRole('region', { name: '작업 세션' });
const standby = () => screen.queryByRole('region', { name: '관제 대기' });
const idleNotice = () => screen.queryByRole('region', { name: '관제 상태' });
const cardNames = () =>
  screen.queryAllByRole('article').map((card) => card.getAttribute('aria-label'));
const card = (name: string) => screen.getByRole('article', { name });
/** 작업 외 진입 꼬리표(S15P31A101-731 에서 이유별 문구로 나눴다). */
const BADGE = '작업 구역 밖';
const NO_WORK_BADGE = '작업 시간 외';

describe('세션 바', () => {
  it('진행 중인 작업의 이름·시작 시각·경과·작업 구역과 작업 관리 링크를 보이고 대기 화면은 없다', async () => {
    serveWorks([serverWork({ work_id: '5', name: '지난 작업' }), inProgress()]);
    renderMonitor();

    const bar = await screen.findByRole('region', { name: '작업 세션' });
    expect(within(bar).getByText('양중 작업')).toBeTruthy();
    expect(bar.textContent).toContain('시작');
    expect(bar.textContent).toContain('경과 1시간 0분');
    expect(bar.textContent).toContain('작업 구역 개구부 구역');
    expect(standby()).toBeNull();

    fireEvent.click(within(bar).getByRole('button', { name: '작업 관리로' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/work', search: { workUnitId: '12' } });
  });

  it('이름이 빈 작업(작업내용을 고르기 전 날짜 작업)은 이름 자리에 대체어를 보인다', async () => {
    serveWorks([inProgress({ name: '' })]);
    renderMonitor();
    const bar = await screen.findByRole('region', { name: '작업 세션' });
    expect(within(bar).getByText('작업')).toBeTruthy();
  });

  it('구역 없는 작업은 작업 구역에 장소(없으면 현장 전체)를 보인다', async () => {
    serveWorks([inProgress({ zone_id: null, place: null })]);
    renderMonitor();
    const bar = await screen.findByRole('region', { name: '작업 세션' });
    expect(bar.textContent).toContain('작업 구역 현장 전체');
  });

  it('오늘 작업이 모두 끝났으면 세션 바 대신 작업이 끝났다는 대기 화면을 보인다', async () => {
    serveWorks([done({ work_id: '5' }), done({ work_id: '6' })]);
    renderMonitor();

    const waiting = await screen.findByRole('region', { name: '관제 대기' });
    expect(within(waiting).getByText('오늘 작업이 끝났습니다')).toBeTruthy();
    expect(within(waiting).queryByText('오늘 세팅이 끝나지 않았습니다')).toBeNull();
    expect(sessionBar()).toBeNull();

    fireEvent.click(within(waiting).getByRole('button', { name: '작업 관리로' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/work' });
  });

  it('오늘 세팅을 마친 작업이 없으면 세션 바 대신 세팅 대기 화면을 보인다', async () => {
    serveWorks([serverWork({ work_id: '6', progress: 'SETUP' })]);
    renderMonitor();

    const waiting = await screen.findByRole('region', { name: '관제 대기' });
    expect(within(waiting).getByText('오늘 세팅이 끝나지 않았습니다')).toBeTruthy();
    expect(
      within(waiting).getByText('세팅을 마친 뒤 작업을 시작하면 경보가 켜집니다.'),
    ).toBeTruthy();
    expect(sessionBar()).toBeNull();

    fireEvent.click(within(waiting).getByRole('button', { name: '작업 관리로' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/work' });
  });

  it.each([
    ['보고서 작성(REPORT)', serverWork({ work_id: '6' })],
    ['세팅 중(SETUP)', serverWork({ work_id: '6', progress: 'SETUP' })],
  ])('오늘 예정 작업이 %s 단계면 대기 화면을 보인다', async (_stage, pending) => {
    serveWorks([done({ work_id: '5' }), pending]);
    renderMonitor();
    expect(await screen.findByRole('region', { name: '관제 대기' })).toBeTruthy();
    expect(sessionBar()).toBeNull();
  });

  it('오늘 작업의 진행 값과 상태를 모르면 대기 화면으로 잠근다', async () => {
    serveWorks([serverWork({ work_id: '6', progress: null, status: undefined })]);
    renderMonitor();
    expect(await screen.findByRole('region', { name: '관제 대기' })).toBeTruthy();
  });

  it('세팅을 마친 예정 작업이 있으면 진행 중인 작업이 없어도 대기 화면은 없다', async () => {
    serveWorks([done({ work_id: '5' }), setupDone({ work_id: '6' })]);
    renderMonitor();
    await waitFor(() => expect(sessionBar()).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(standby()).toBeNull();
  });

  it('세팅을 마쳤지만 작업을 시작하지 않았으면 경보 배너 아래 자리에 「작업 시작 전 · 경보 꺼짐」을 짧게 보인다(-679)', async () => {
    serveWorks([setupDone({ work_id: '6' })]);
    renderMonitor();
    const notice = await screen.findByRole('region', { name: '관제 상태' });
    expect(notice.textContent).toBe('작업 시작 전 · 경보 꺼짐');
    expect(sessionBar()).toBeNull();
    expect(standby()).toBeNull();
  });

  it('작업을 시작하면 「작업 시작 전 · 경보 꺼짐」 대신 세션 바가 보이고, 대기 화면일 때는 그 표시가 없다', async () => {
    serveWorks([setupDone({ work_id: '6' })]);
    const queryClient = renderMonitor();
    await screen.findByRole('region', { name: '관제 상태' });
    act(() => {
      queryClient.setQueryData(TBM_WORKS_KEY, [inProgress({ work_id: '6' })]);
    });
    await screen.findByRole('region', { name: '작업 세션' });
    expect(idleNotice()).toBeNull();
    act(() => {
      queryClient.setQueryData(TBM_WORKS_KEY, [
        done({ work_id: '6', actual_started_at: STARTED, actual_ended_at: STARTED + 30 * MIN }),
      ]);
    });
    await screen.findByRole('region', { name: '관제 대기' });
    expect(idleNotice()).toBeNull();
  });

  it('작업을 끝내면(DONE) 다시 대기 화면이 된다', async () => {
    serveWorks([inProgress()]);
    const queryClient = renderMonitor();
    await screen.findByRole('region', { name: '작업 세션' });
    expect(standby()).toBeNull();

    act(() => {
      queryClient.setQueryData(TBM_WORKS_KEY, [
        done({ work_id: '12', actual_started_at: STARTED, actual_ended_at: STARTED + 30 * MIN }),
      ]);
    });
    expect(await screen.findByRole('region', { name: '관제 대기' })).toBeTruthy();
    expect(sessionBar()).toBeNull();
  });

  it('오늘 날짜가 아닌 예정 작업은 세팅을 마쳤어도 관제할 작업으로 세지 않아 대기 화면을 보인다', async () => {
    serveWorks([setupDone({ work_id: '7', date: YESTERDAY })]);
    renderMonitor();
    expect(await screen.findByRole('region', { name: '관제 대기' })).toBeTruthy();
  });

  it('어제 시작해 아직 끝나지 않은 진행 중 작업이 있으면 대기 화면은 없다', async () => {
    serveWorks([inProgress({ work_id: '8', date: YESTERDAY })]);
    renderMonitor();
    expect(await screen.findByRole('region', { name: '작업 세션' })).toBeTruthy();
    expect(standby()).toBeNull();
  });

  it('작업 목록을 받지 못하면 작업이 없다고 단정하지 않는다(대기 화면도 세션 바도 없다)', async () => {
    let asked = 0;
    server.use(
      http.get('https://monitor-session.invalid/api/work-units', () => {
        asked += 1;
        return HttpResponse.json({ code: 'INTERNAL' }, { status: 500 });
      }),
    );
    renderMonitor();
    await waitFor(() => expect(asked).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(standby()).toBeNull();
    expect(sessionBar()).toBeNull();
  });
});

describe('관제 단계(-692): 작업 시작 API 성공만으로 관제 중이라 하지 않는다', () => {
  const badge = (region: HTMLElement) => within(region).getAllByRole('status')[0]!.textContent;

  it('이번 작업 묶음이 현장에 적용되기 전에는 「관제 준비 중」, 적용(APPLIED)되면 「관제 중」', async () => {
    serveWorks([inProgress()]);
    serveBundles([
      configBundle('cfg-2', 'PENDING', 12, Date.now()),
      configBundle('cfg-1', 'APPLIED', null),
    ]);
    const queryClient = renderMonitor();
    const bar = await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(badge(bar)).toBe('관제 준비 중'));

    act(() => {
      queryClient.setQueryData(
        ['config-bundles'],
        [configBundle('cfg-2', 'APPLIED', 12, Date.now()), configBundle('cfg-1', 'APPLIED', null)],
      );
    });
    await waitFor(() => expect(badge(sessionBar()!)).toBe('관제 중'));
  });

  it('시작 뒤 10초 넘게 적용이 없으면 지연을 무엇이 / 어떻게로 알린다', async () => {
    serveWorks([inProgress()]);
    serveBundles([configBundle('cfg-2', 'PENDING', 12), configBundle('cfg-1', 'APPLIED', null)]);
    renderMonitor();
    const bar = await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(badge(bar)).toBe('관제 시작 지연'));
    expect(bar.textContent).toContain('경보가 아직 꺼져 있습니다');
    expect(bar.textContent).toContain('현장 노트북과 GPU 서버가 켜져 있고');
  });

  it('이번 작업 묶음이 거부되면 「현장에 다시 보내기」가 묶음만 다시 발행하고 작업 시작은 다시 보내지 않는다', async () => {
    const posted: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') posted.push(new URL(request.url).pathname);
    });
    serveWorks([inProgress()]);
    const before = [configBundle('cfg-2', 'REJECTED', 12), configBundle('cfg-1', 'APPLIED', null)];
    serveBundles(before);
    server.use(
      http.post('https://monitor-session.invalid/api/config-bundles', () => {
        const fresh = configBundle('cfg-3', 'PENDING', 12, Date.now());
        serveBundles([fresh, ...before]);
        return HttpResponse.json(fresh);
      }),
    );
    renderMonitor();
    const bar = await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(badge(bar)).toBe('관제 시작 실패'));
    fireEvent.click(within(bar).getByRole('button', { name: '현장에 다시 보내기' }));
    await waitFor(() => expect(badge(sessionBar()!)).toBe('관제 준비 중'));
    expect(posted).toEqual(['/api/config-bundles']);
    server.events.removeAllListeners();
  });

  it('작업을 끝냈는데 현장이 아직 그 작업 묶음을 쓰면 「종료 요청됨 · 현장 경보 끄는 중」, 종료 묶음이 적용되면 사라진다', async () => {
    const ended = done({ work_id: '12', actual_started_at: STARTED, actual_ended_at: Date.now() });
    serveWorks([ended, setupDone({ work_id: '13' })]);
    serveBundles([
      configBundle('cfg-3', 'PENDING', null, Date.now()),
      configBundle('cfg-2', 'APPLIED', 12),
    ]);
    const queryClient = renderMonitor();
    const notice = await screen.findByRole('region', { name: '작업 종료' });
    expect(badge(notice)).toBe('종료 요청됨 · 현장 경보 끄는 중');
    expect(idleNotice()).toBeNull();

    act(() => {
      queryClient.setQueryData(
        ['config-bundles'],
        [configBundle('cfg-3', 'APPLIED', null, Date.now()), configBundle('cfg-2', 'APPLIED', 12)],
      );
    });
    await screen.findByRole('region', { name: '관제 상태' });
    expect(screen.queryByRole('region', { name: '작업 종료' })).toBeNull();
  });
});

describe('이벤트 목록 필터', () => {
  it('진행 중 작업이 시작된 뒤 이벤트만 보이고, 시작 전 이벤트는 건수 한 줄로 남는다(작업 관리로는 세션 바 한 곳)', async () => {
    serveWorks([inProgress()]);
    renderMonitor([
      item({ event_id: 'old', world_ids: ['w-0011'], raised_at: STARTED - 30 * MIN }),
      item({ event_id: 'new', world_ids: ['w-0012'], raised_at: STARTED + 10 * MIN }),
    ]);

    await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(cardNames()).toEqual(['w-0012 이벤트']));
    expect(screen.getByText('이번 실행 전 이벤트 1건은 목록에서 뺐습니다')).toBeTruthy();
    // 「작업 관리로」 는 세션 바 한 곳에만 있다(S15P31A101-731)
    expect(screen.getAllByRole('button', { name: '작업 관리로' })).toHaveLength(1);
  });

  it('시작 전에 났어도 확인 대기 경보는 패널과 배너에서 숨지 않는다', async () => {
    serveWorks([inProgress()]);
    renderMonitor([
      item({
        event_id: 'old-alarm',
        world_ids: ['w-0011'],
        severity: 'CRITICAL',
        raised_at: STARTED - 20 * MIN,
      }),
      item({ event_id: 'old-quiet', world_ids: ['w-0013'], raised_at: STARTED - 20 * MIN }),
    ]);

    await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(cardNames()).toEqual(['w-0011 이벤트']));
    expect(screen.getByRole('group', { name: '확인 대기 경보' })).toBeTruthy();
  });

  it('진행 중인 작업이 없으면 거르지 않는다', async () => {
    serveWorks([done()]);
    renderMonitor([
      item({ event_id: 'old', world_ids: ['w-0011'], raised_at: STARTED - 30 * MIN }),
      item({ event_id: 'new', world_ids: ['w-0012'], raised_at: STARTED + 10 * MIN }),
    ]);

    await screen.findByRole('region', { name: '관제 대기' });
    expect(cardNames().sort()).toEqual(['w-0011 이벤트', 'w-0012 이벤트']);
    expect(screen.queryByText(/이번 실행 전 이벤트/)).toBeNull();
  });
});

describe('작업 외 진입 배지', () => {
  it('작업 구역 밖에서 난 이벤트에만 붙는다(작업 구역 안·구역이 없는 이벤트는 붙지 않는다)', async () => {
    serveWorks([inProgress()]);
    renderMonitor([
      item({ event_id: 'in', world_ids: ['w-0012'], zone_id: 'z-04' }),
      item({ event_id: 'out', world_ids: ['w-0013'], zone_id: 'z-09' }),
      item({ event_id: 'none', world_ids: ['w-0014'], zone_id: null }),
    ]);

    await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(screen.queryAllByRole('article')).toHaveLength(3));
    await waitFor(() => expect(within(card('w-0013 이벤트')).queryByText(BADGE)).toBeTruthy());
    expect(within(card('w-0012 이벤트')).queryByText(BADGE)).toBeNull();
    expect(within(card('w-0014 이벤트')).queryByText(BADGE)).toBeNull();
  });

  it('배지는 경보 등급·확인 대기 표시를 바꾸지 않는다', async () => {
    serveWorks([inProgress()]);
    renderMonitor([
      item({ event_id: 'out', world_ids: ['w-0013'], zone_id: 'z-09', severity: 'CRITICAL' }),
    ]);

    await screen.findByRole('region', { name: '작업 세션' });
    await waitFor(() => expect(within(card('w-0013 이벤트')).queryByText(BADGE)).toBeTruthy());
    expect(within(card('w-0013 이벤트')).getByText(/^(위험|CRITICAL)$/)).toBeTruthy();
    expect(screen.getByRole('group', { name: '확인 대기 경보' })).toBeTruthy();
  });

  it('진행 중인 작업이 없을 때 난 이벤트에도 붙는다', async () => {
    serveWorks([done()]);
    renderMonitor([item({ event_id: 'idle', world_ids: ['w-0012'], zone_id: 'z-04' })]);

    await screen.findByRole('region', { name: '관제 대기' });
    await waitFor(() =>
      expect(within(card('w-0012 이벤트')).queryByText(NO_WORK_BADGE)).toBeTruthy(),
    );
  });
});

describe('대기 화면이 아래 층을 막는다', () => {
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

  it('오늘 관제할 작업이 없으면 왼쪽 칼럼(위험 구역 목록)은 대기 화면보다 앞에서 inert 로 막힌다', async () => {
    serveWorks([done({ work_id: '5' })]);
    renderMonitor();

    const waiting = await screen.findByRole('region', { name: '관제 대기' });
    const zones = await screen.findByRole('region', { name: '위험 구역' });
    expect(zones.closest('[inert]')).not.toBeNull();
    expect(zones.compareDocumentPosition(waiting) & FOLLOWING).toBeTruthy();
    // 대기 화면 자체는 눌려야 한다(작업 관리로).
    expect(waiting.closest('[inert]')).toBeNull();
  });

  it('세팅을 마친 오늘 작업이 있으면 왼쪽 칼럼이 막히지 않고 대기 화면도 없다', async () => {
    serveWorks([setupDone({ work_id: '6' })]);
    const queryClient = renderMonitor();

    // 칼럼은 작업 목록을 받기 전에도 그려지므로, 목록이 들어온 뒤에 막히지 않았는지 본다.
    await waitFor(() => expect(queryClient.getQueryData(TBM_WORKS_KEY)).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('region', { name: '위험 구역' }).closest('[inert]')).toBeNull();
    expect(standby()).toBeNull();
  });

  it('대기 중에도 경보 배너와 이벤트 패널은 막히지 않는다', async () => {
    serveWorks([]);
    renderMonitor([item({ event_id: 'alarm', world_ids: ['w-0015'], severity: 'CRITICAL' })]);

    await screen.findByRole('region', { name: '관제 대기' });
    expect(screen.getByRole('group', { name: '확인 대기 경보' }).closest('[inert]')).toBeNull();
    expect(screen.getByRole('complementary', { name: '이벤트' }).closest('[inert]')).toBeNull();
  });
});

describe('대기 화면에서도 경보', () => {
  it('작업이 없어도 경보 배너와 이벤트 패널 카드가 보이고 대기 화면이 가리지 않는다', async () => {
    serveWorks([]);
    renderMonitor([
      item({ event_id: 'alarm', world_ids: ['w-0015'], severity: 'CRITICAL', zone_id: 'z-04' }),
    ]);

    const waiting = await screen.findByRole('region', { name: '관제 대기' });
    const banner = screen.getByRole('group', { name: '확인 대기 경보' });
    expect(banner).toBeTruthy();
    expect(card('w-0015 이벤트')).toBeTruthy();
    expect(within(card('w-0015 이벤트')).queryByText(NO_WORK_BADGE)).toBeTruthy();
    // 경보는 대기 화면 안에 있지 않고(가려지지 않고), 대기 화면보다 뒤에 그려져 위에 뜬다.
    expect(waiting.contains(banner)).toBe(false);
    const panel = screen.getByRole('complementary', { name: '이벤트' });
    expect(waiting.contains(panel)).toBe(false);
    expect(waiting.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('대기 중에 새 경보가 오면 곧바로 보인다', async () => {
    serveWorks([]);
    const queryClient = renderMonitor();
    await screen.findByRole('region', { name: '관제 대기' });
    expect(screen.queryByRole('group', { name: '확인 대기 경보' })).toBeNull();

    applyEvents(queryClient, [
      item({ event_id: 'late', world_ids: ['w-0016'], severity: 'HIGH', zone_id: 'z-04' }),
    ]);
    await waitFor(() => expect(screen.getByRole('group', { name: '확인 대기 경보' })).toBeTruthy());
    expect(card('w-0016 이벤트')).toBeTruthy();
  });
});

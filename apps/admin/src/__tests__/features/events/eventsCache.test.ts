import { ackErrorMessage, isStaleAckError } from '@/features/events/ack';
import {
  EVENTS_MAX_PAGES,
  EVENTS_PAGE_SIZE,
  requestAck,
  requestEvents,
} from '@/features/events/api';
import { isAlarming } from '@/features/events/events';
import {
  applyEvents,
  bindEventsCache,
  isLocalAck,
  LIVE_EVENTS_KEY,
  writeLocalAck,
  type LiveEvents,
} from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { ApiError, createHttp, NETWORK_ERROR } from '@/lib/http';
import { riskEventsBetween, viewerHealthAt } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRealtime } from './fakeRealtime';

// 시나리오의 R2(개구부 근접) 발생·갱신.
const [raised, updated] = riskEventsBetween(0, 40_000)
  .map((m) => m.payload)
  .filter((e) => e.rule_id === 'R2');

const R = raised!;
const NOW = 1_760_342_450_000;

// 마이크로태스크를 모두 비운다(보내기 실패 처리의 finally 까지).
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const signIn = (id = 'admin', role: 'ADMIN' | 'FOREMAN' | 'VIEWER' = 'ADMIN') =>
  useSessionStore.getState().signIn({ accessToken: 't', user: { id, role } });

beforeEach(() => {
  useSessionStore.setState({ session: undefined });
  useRealtimeStore.getState().reset();
});

describe('bindEventsCache', () => {
  it('/topic/events 를 순서대로 캐시에 합친다. 목록을 받기 전이라 loaded 는 false 다', () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const unbind = bindEventsCache(realtime, queryClient);

    realtime.emit('riskEvent', updated!, 0);
    realtime.emit('riskEvent', raised!, 0);
    const data = queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY);
    expect(data?.entries.map((e) => e.event.lifecycle)).toEqual(['UPDATED']);
    expect(data?.loaded).toBe(false);

    unbind();
    expect(realtime.count('riskEvent')).toBe(0);
    expect(realtime.count('open')).toBe(0);
  });

  it('연결이 다시 열리면 받은 목록도 다시 받을 때까지 loaded 를 내리고 다시 받게 한다', () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    bindEventsCache(realtime, queryClient);
    queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, { entries: [], loaded: true });

    realtime.emit('open');
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.loaded).toBe(false);
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(true);
  });

  it('viewer_health 의 held_events_revision 이 바뀌면 목록을 다시 받고, 처음 받은 판은 기준으로만 삼는다(S15P31A101-595)', () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const unbind = bindEventsCache(realtime, queryClient);
    queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, { entries: [], loaded: true });
    const health = (revision: string | undefined) =>
      useRealtimeStore.getState().receiveHealth({
        payload: { ...viewerHealthAt(NOW).payload, held_events_revision: revision },
        receivedAt: NOW,
        clockOffsetMs: 0,
      });

    health('boot-1');
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(false);
    health('boot-1');
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(false);
    // 판이 없는 health(이전 EC2)로는 다시 받지 않는다
    health(undefined);
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(false);
    health('boot-2');
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(true);
    // 목록 캐시의 loaded 는 그대로다(끊긴 것이 아니다)
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.loaded).toBe(true);

    unbind();
  });

  it('목록을 받기 전에 연결이 열려도 캐시를 만들지 않는다', () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    bindEventsCache(realtime, queryClient);
    realtime.emit('open');
    expect(queryClient.getQueryState(LIVE_EVENTS_KEY)).toBeUndefined();
  });
});

/** 끊긴 화면에서 확인한 상태: 캐시에 R2 가 있고 임시 확인과 보낼 것 목록이 있다. */
function frozenAck(queryClient: QueryClient) {
  applyEvents(queryClient, [R]);
  expect(writeLocalAck(queryClient, R.event_id, R.event_sequence)).toBe(true);
}

const acksOf = (queryClient: QueryClient) =>
  queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.entries[0]?.event.acks ?? [];
const pendingOf = (queryClient: QueryClient) =>
  queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.pendingAcks ?? [];

/** 서버가 확인을 받아 돌려주는 이벤트(진짜 ack 한 건, 순번 +1). */
const serverAcked = (): EventItem => ({
  ...R,
  event_sequence: (R.event_sequence ?? 0) + 1,
  acks: [
    {
      ack_id: 'srv-1',
      channel: 'CONTROL_ROOM',
      actor_role: 'ADMIN',
      actor_id: 'admin',
      acked_at: NOW,
    },
  ],
});

describe('끊긴 화면의 확인(writeLocalAck)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('local- 확인을 쓴다. 화면 경보가 바로 멈추고, 시계 차이를 더한 EC2 시각으로 남는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    signIn('foreman', 'FOREMAN');
    useRealtimeStore.setState({
      health: { clockOffsetMs: 7_000, receivedAt: NOW, payload: {} as never },
    });
    const queryClient = new QueryClient();
    applyEvents(queryClient, [R]);
    expect(isAlarming(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!.entries[0]!)).toBe(
      true,
    );

    expect(writeLocalAck(queryClient, R.event_id, 1)).toBe(true);

    const [ack] = acksOf(queryClient);
    expect(ack).toMatchObject({
      channel: 'CONTROL_ROOM',
      actor_role: 'FOREMAN',
      actor_id: 'foreman',
      acked_at: NOW + 7_000,
    });
    expect(isLocalAck(ack!)).toBe(true);
    expect(isAlarming(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!.entries[0]!)).toBe(
      false,
    );
    expect(pendingOf(queryClient)).toEqual([
      { eventId: R.event_id, eventSequence: 1, ackId: ack!.ack_id, actorId: 'foreman' },
    ]);
  });

  it('브라우저 시계가 뒤처져도 지금 보이는 경보 단계 뒤의 확인으로 센다', () => {
    vi.spyOn(Date, 'now').mockReturnValue((R.raised_at ?? 0) - 60_000);
    signIn();
    const queryClient = new QueryClient();
    applyEvents(queryClient, [R]);
    writeLocalAck(queryClient, R.event_id, 1);
    expect(isAlarming(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!.entries[0]!)).toBe(
      false,
    );
  });

  it('같은 이벤트를 또 확인해도 보낼 것은 하나만 남는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    signIn();
    const queryClient = new QueryClient();
    applyEvents(queryClient, [R]);
    writeLocalAck(queryClient, R.event_id, 1);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 1000);
    writeLocalAck(queryClient, R.event_id, 2);
    expect(pendingOf(queryClient)).toHaveLength(1);
    expect(pendingOf(queryClient)[0]?.eventSequence).toBe(2);
  });

  it('로그인이 없거나 열람 계정이거나 캐시에 없는 이벤트면 쓰지 않는다', () => {
    const queryClient = new QueryClient();
    applyEvents(queryClient, [R]);
    expect(writeLocalAck(queryClient, R.event_id, 1)).toBe(false);
    signIn('viewer', 'VIEWER');
    expect(writeLocalAck(queryClient, R.event_id, 1)).toBe(false);
    signIn();
    expect(writeLocalAck(queryClient, 'none', 1)).toBe(false);
    expect(acksOf(queryClient)).toEqual([]);
    expect(pendingOf(queryClient)).toEqual([]);
  });
});

describe('연결이 다시 열릴 때 보류한 확인 보내기', () => {
  beforeEach(() => signIn());

  it('서버가 받으면 임시 확인을 서버의 확인으로 바꾸고 보낼 것을 비운다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const sendAck = vi.fn().mockResolvedValue(serverAcked());
    const reload = vi.spyOn(queryClient, 'invalidateQueries');
    bindEventsCache(realtime, queryClient, sendAck);
    frozenAck(queryClient);

    realtime.emit('open');
    await vi.waitFor(() => expect(pendingOf(queryClient)).toEqual([]));

    // 목록은 열릴 때 한 번만 다시 받는다. 응답이 이벤트를 돌려줬으니 또 받을 필요가 없다.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sendAck).toHaveBeenCalledTimes(1);
    expect(sendAck).toHaveBeenCalledWith(R.event_id, R.event_sequence);
    expect(acksOf(queryClient).map((a) => a.ack_id)).toEqual(['srv-1']);
    // 확인된 상태가 이어져 경보음은 다시 울리지 않는다.
    expect(isAlarming(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!.entries[0]!)).toBe(
      false,
    );
  });

  it('서버가 거절(4xx)하면 임시 확인을 지우고 목록을 다시 받게 한다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const sendAck = vi.fn().mockRejectedValue(new ApiError(409, { code: 'EVENT_RESOLVED' }));
    const reload = vi.spyOn(queryClient, 'invalidateQueries');
    bindEventsCache(realtime, queryClient, sendAck);
    frozenAck(queryClient);

    realtime.emit('open');
    await vi.waitFor(() => expect(pendingOf(queryClient)).toEqual([]));

    expect(acksOf(queryClient)).toEqual([]);
    // 열릴 때 한 번, 거절당한 뒤 서버 상태를 보려고 한 번 더.
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('연결 실패·5xx 면 임시 확인과 보낼 것을 그대로 두고, 다음에 열릴 때 다시 보낸다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const sendAck = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(NETWORK_ERROR))
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValue(serverAcked());
    bindEventsCache(realtime, queryClient, sendAck);
    frozenAck(queryClient);

    realtime.emit('open');
    await vi.waitFor(() => expect(sendAck).toHaveBeenCalledTimes(1));
    await flush();
    realtime.emit('open');
    await vi.waitFor(() => expect(sendAck).toHaveBeenCalledTimes(2));
    await flush();
    expect(pendingOf(queryClient)).toHaveLength(1);
    expect(acksOf(queryClient).every(isLocalAck)).toBe(true);

    realtime.emit('open');
    await vi.waitFor(() => expect(pendingOf(queryClient)).toEqual([]));
    expect(sendAck).toHaveBeenCalledTimes(3);
    expect(acksOf(queryClient).map((a) => a.ack_id)).toEqual(['srv-1']);
  });

  it('보내는 중에 연결이 또 열려도 같은 확인을 두 번 보내지 않는다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    let release: (event: EventItem) => void = () => undefined;
    const sendAck = vi.fn(
      () =>
        new Promise<EventItem>((resolve) => {
          release = resolve;
        }),
    );
    bindEventsCache(realtime, queryClient, sendAck);
    frozenAck(queryClient);

    realtime.emit('open');
    realtime.emit('open');
    release(serverAcked());
    await vi.waitFor(() => expect(pendingOf(queryClient)).toEqual([]));
    expect(sendAck).toHaveBeenCalledTimes(1);
  });

  it('다른 계정이 누른 확인은 지금 토큰으로 보내지 않고 지운다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    const sendAck = vi.fn().mockResolvedValue(serverAcked());
    bindEventsCache(realtime, queryClient, sendAck);
    frozenAck(queryClient);
    signIn('foreman', 'FOREMAN');

    realtime.emit('open');
    await vi.waitFor(() => expect(pendingOf(queryClient)).toEqual([]));
    expect(sendAck).not.toHaveBeenCalled();
    expect(acksOf(queryClient)).toEqual([]);
  });

  it('보내는 함수를 주지 않으면 보내지 않고 남겨 둔다', async () => {
    const queryClient = new QueryClient();
    const realtime = fakeRealtime();
    bindEventsCache(realtime, queryClient);
    frozenAck(queryClient);

    realtime.emit('open');
    await flush();
    expect(pendingOf(queryClient)).toHaveLength(1);
  });
});

const BASE = 'http://api.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** 쪽 하나. id 는 e-{번호}, resolved 면 해소된 이벤트. */
const item = (index: number, resolved = false): EventItem => ({
  ...R,
  event_id: `e-${index}`,
  lifecycle: resolved ? 'RESOLVED' : 'RAISED',
});

/** 앞에서부터 total 건 중 resolvedFrom 번째부터는 해소된 이벤트인 목록을 쪽으로 자른다. */
function pagedServer(total: number, isResolved: (index: number) => boolean) {
  const requested: string[] = [];
  server.use(
    http.get(`${BASE}/api/events`, ({ request }) => {
      const url = new URL(request.url);
      requested.push(url.search);
      const number = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('size'));
      const content = Array.from({ length: total }, (_, i) => item(i, isResolved(i))).slice(
        number * size,
        (number + 1) * size,
      );
      return HttpResponse.json({ content, totalElements: total, number, size });
    }),
  );
  return requested;
}

describe('이벤트 REST', () => {
  it('목록을 받아 검사하고, ACK 는 보던 event_sequence 와 CONTROL_ROOM 을 실어 보낸다', async () => {
    let ackBody: unknown;
    server.use(
      http.get(`${BASE}/api/events`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('0');
        expect(url.searchParams.get('size')).toBe('100');
        return HttpResponse.json({ content: [raised], totalElements: 1, number: 0, size: 100 });
      }),
      http.post(`${BASE}/api/events/:id/ack`, async ({ request, params }) => {
        expect(params.id).toBe(raised!.event_id);
        ackBody = await request.json();
        return HttpResponse.json(serverAcked());
      }),
    );
    const api = createHttp({ baseUrl: BASE });

    const page = await requestEvents(api);
    expect(page.content[0]?.event_id).toBe(raised!.event_id);
    await expect(requestAck(api, raised!.event_id, 2)).resolves.toMatchObject({
      acks: [{ ack_id: 'srv-1' }],
    });
    expect(ackBody).toEqual({ event_sequence: 2, channel: 'CONTROL_ROOM' });
    await requestAck(api, raised!.event_id, undefined);
    expect(ackBody).toEqual({ channel: 'CONTROL_ROOM' });
  });

  it('서버가 보내는 추가 칸(운영자 종료 기록·식별자·상향 기록)을 버리지 않는다', async () => {
    const full = {
      ...R,
      lifecycle: 'RESOLVED',
      gateway_id: 'gw-1',
      config_version: 'cfg-3',
      calibration_version: 'cal-7',
      scene_version: 'scene-2',
      related_event_id: 'e-prev',
      resolved_at: NOW,
      resolution: {
        kind: 'OPERATOR_CLOSED',
        close_id: 'c-1',
        channel: 'CONTROL_ROOM',
        actor_role: 'ADMIN',
        actor_id: 'admin',
        requested_at: NOW,
        reason: '오탐',
      },
      escalations: [
        {
          escalation_id: 'esc-1',
          basis: 'VLM_PROPOSAL',
          assessment_job_id: 'job-1',
          target_severity: 'CRITICAL',
          channel: 'CONTROL_ROOM',
          actor_role: 'ADMIN',
          actor_id: 'admin',
          requested_at: NOW,
          note: '메모',
        },
      ],
    };
    server.use(http.get(`${BASE}/api/events`, () => HttpResponse.json({ content: [full] })));
    const [event] = (await requestEvents(createHttp({ baseUrl: BASE }))).content;
    expect(event).toMatchObject({
      rule_version: R.rule_version,
      gateway_id: 'gw-1',
      config_version: 'cfg-3',
      calibration_version: 'cal-7',
      scene_version: 'scene-2',
      related_event_id: 'e-prev',
      resolution: { close_id: 'c-1', actor_id: 'admin', reason: '오탐' },
      escalations: [{ escalation_id: 'esc-1', actor_id: 'admin', note: '메모' }],
    });
  });

  it('목록 형식이 다르면 INVALID_RESPONSE 다', async () => {
    server.use(http.get(`${BASE}/api/events`, () => HttpResponse.json([raised])));
    await expect(requestEvents(createHttp({ baseUrl: BASE }))).rejects.toMatchObject({
      kind: 'INVALID_RESPONSE',
    });
  });

  it('쪽이 하나뿐이면 한 번만 부른다', async () => {
    const requested = pagedServer(30, () => false);
    const page = await requestEvents(createHttp({ baseUrl: BASE }));
    expect(page.content).toHaveLength(30);
    expect(requested).toEqual(['?page=0&size=100']);
  });

  it('해소된 이벤트가 앞을 채워 진행 중 이벤트가 둘째 쪽으로 밀려도 받는다', async () => {
    // 최신순 250건: 앞 99건은 해소, 그 뒤는 진행 중이다(첫 쪽에 진행 중이 하나 있어 다음 쪽을 받는다).
    const requested = pagedServer(250, (i) => i < 99);
    const page = await requestEvents(createHttp({ baseUrl: BASE }));
    expect(page.content).toHaveLength(250);
    expect(requested).toEqual(['?page=0&size=100', '?page=1&size=100', '?page=2&size=100']);
  });

  it('진행 중 이벤트가 하나도 없는 쪽을 만나면 거기서 멈춘다', async () => {
    // 0..99: 진행 중 하나 포함, 100..199: 전부 해소 → 셋째 쪽은 부르지 않는다.
    const requested = pagedServer(500, (i) => i >= 100 || i < 99);
    const page = await requestEvents(createHttp({ baseUrl: BASE }));
    expect(page.content).toHaveLength(200);
    expect(requested).toHaveLength(2);
  });

  it(`쪽이 아무리 많아도 ${EVENTS_MAX_PAGES}쪽까지만 받는다`, async () => {
    const requested = pagedServer(2000, () => false);
    const page = await requestEvents(createHttp({ baseUrl: BASE }));
    expect(requested).toHaveLength(EVENTS_MAX_PAGES);
    expect(page.content).toHaveLength(EVENTS_MAX_PAGES * EVENTS_PAGE_SIZE);
  });

  it('서버가 totalElements 를 안 보내면 쪽이 꽉 찼는지로 다음 쪽을 판단한다', async () => {
    const requested: string[] = [];
    server.use(
      http.get(`${BASE}/api/events`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        requested.push(String(page));
        const count = page === 0 ? EVENTS_PAGE_SIZE : 3;
        return HttpResponse.json({
          content: Array.from({ length: count }, (_, i) => item(page * 1000 + i)),
        });
      }),
    );
    const page = await requestEvents(createHttp({ baseUrl: BASE }));
    expect(requested).toEqual(['0', '1']);
    expect(page.content).toHaveLength(EVENTS_PAGE_SIZE + 3);
  });

  it('둘째 쪽이 실패하면 목록 전체가 실패다(받은 앞 쪽만 loaded 로 치지 않는다)', async () => {
    server.use(
      http.get(`${BASE}/api/events`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 1) return HttpResponse.json({ detail: 'down' }, { status: 503 });
        return HttpResponse.json({
          content: Array.from({ length: EVENTS_PAGE_SIZE }, (_, i) => item(i)),
          totalElements: 300,
          number: 0,
          size: EVENTS_PAGE_SIZE,
        });
      }),
    );
    await expect(requestEvents(createHttp({ baseUrl: BASE }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it('ACK 실패 문구: code 별 문구, 4xx 서버 문구, 연결 실패는 따로, 그 밖은 기본 문구', () => {
    const byCode = (status: number, code: string) =>
      ackErrorMessage(new ApiError(status, { code, serverMessage: '서버 문구' }));
    expect(byCode(404, 'EVENT_NOT_FOUND')).toBe('이벤트를 찾을 수 없습니다');
    expect(byCode(409, 'EVENT_RESOLVED')).toBe('이미 해소된 이벤트입니다');
    expect(byCode(400, 'INVALID_EVENT_SEQUENCE')).toBe(
      '이벤트 상태가 바뀌었습니다. 새 상태를 받은 뒤 다시 확인하세요',
    );
    expect(byCode(400, 'INVALID_ACK_CHANNEL')).toBe('확인 경로가 올바르지 않습니다');
    // 모르는 code 는 기존대로 4xx 서버 문구만 보여 준다.
    expect(byCode(403, 'FORBIDDEN')).toBe('서버 문구');
    expect(ackErrorMessage(new ApiError(409, { serverMessage: '이미 해소된 이벤트입니다' }))).toBe(
      '이미 해소된 이벤트입니다',
    );
    expect(ackErrorMessage(new ApiError(NETWORK_ERROR))).toBe('서버에 연결할 수 없습니다');
    expect(ackErrorMessage(new ApiError(500, { serverMessage: 'NPE' }))).toBe(
      '확인하지 못했습니다',
    );
  });

  it('목록을 다시 받아야 하는 ACK 실패: 해소됨·순번 불일치만', () => {
    expect(isStaleAckError(new ApiError(409, { code: 'EVENT_RESOLVED' }))).toBe(true);
    expect(isStaleAckError(new ApiError(400, { code: 'INVALID_EVENT_SEQUENCE' }))).toBe(true);
    expect(isStaleAckError(new ApiError(404, { code: 'EVENT_NOT_FOUND' }))).toBe(false);
    expect(isStaleAckError(new ApiError(400, { code: 'INVALID_ACK_CHANNEL' }))).toBe(false);
    expect(isStaleAckError(new Error('x'))).toBe(false);
  });
});

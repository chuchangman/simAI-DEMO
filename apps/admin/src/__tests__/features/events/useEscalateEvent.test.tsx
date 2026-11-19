import { EventDetail } from '@/features/events/EventDetail';
import {
  escalationErrorMessage,
  escalationStatus,
  escalationStatusLabel,
  groupIncidents,
  isStaleEscalationError,
  mergedEscalations,
  mergeEvent,
  type EventEntry,
} from '@/features/events/events';
import { bindEventsCache, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventEscalation, EventItem } from '@/features/events/types';
import { useEscalateEvent } from '@/features/events/useEscalateEvent';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { createEventsMock } from '@/mocks/events';
import type { StompBroker } from '@/mocks/stompBroker';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { validateMessage, type RiskEventMessage } from '@simai/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRealtime } from './fakeRealtime';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const BASE = 'http://api.test';
const T = 1_760_342_400_000;
const EVENT_ID = '0192a6f0-7c1e-7b3a-9f2d-000000000002';

function makeEvent(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: EVENT_ID,
    event_sequence: 1,
    rule_id: 'R1',
    rule_version: 3,
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'HIGH',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0015'],
    zone_id: 'z-02',
    metrics: { zone_distance_m: 0 },
    rationale: '작업자가 위험 구역 경계 안쪽 단상 위에 서 있다. 난간이 보이지 않는다.',
    proposed_severity: 'CRITICAL',
    assessmentId: 'job-20261017-0052',
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const makeEntry = (change: Partial<EventItem> = {}): EventEntry =>
  mergeEvent(undefined, makeEvent(change));

const signInAs = (id: string, role: 'ADMIN' | 'FOREMAN' | 'VIEWER') =>
  useSessionStore.getState().signIn({ accessToken: `mock-token.${id}`, user: { id, role } });

const server = setupServer(http.get(`${BASE}/api/events/:id/clips`, () => HttpResponse.json([])));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  signInAs('admin', 'ADMIN');
  useRealtimeStore.getState().reset();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});
afterAll(() => server.close());

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** LIVE_EVENTS_KEY 캐시가 갱신되면 다시 그려지는 EventDetail 하네스. */
function LiveDetailHarness({ initialEntries }: { initialEntries: EventEntry[] }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, {
    entries: initialEntries,
    loaded: true,
  });

  function ConnectedDetail() {
    const { data } = useQuery<LiveEvents>({
      queryKey: LIVE_EVENTS_KEY,
      queryFn: () => queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!,
      staleTime: Infinity,
    });
    const entries = data?.entries ?? initialEntries;
    const incident = groupIncidents(entries)[0]!;
    return <EventDetail incident={incident} openEventId={EVENT_ID} onClose={vi.fn()} />;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedDetail />
    </QueryClientProvider>,
  );
  return {
    queryClient,
    dialog: screen.getByRole('dialog', { name: '사건 상세' }),
  };
}

describe('상향 의견 승인·거절 버튼 표시 조건', () => {
  it('관리자(ADMIN)이고 활성 이벤트에 proposed_severity 가 있을 때만 승인·거절 버튼이 보인다', () => {
    signInAs('admin', 'ADMIN');
    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
    expect(within(aiPanel).getByRole('button', { name: '승인' })).toBeTruthy();
    expect(within(aiPanel).getByRole('button', { name: '거절' })).toBeTruthy();
  });

  it.each(['FOREMAN', 'VIEWER'] as const)(
    '%s 권한에는 상향 의견 배지만 보이고 승인·거절 버튼은 보이지 않는다',
    (role) => {
      signInAs(role.toLowerCase(), role);
      const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
      const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
      expect(within(aiPanel).getByText(/상향 의견/)).toBeTruthy();
      expect(within(aiPanel).queryByRole('button', { name: '승인' })).toBeNull();
      expect(within(aiPanel).queryByRole('button', { name: '거절' })).toBeNull();
    },
  );

  it('proposed_severity 가 없거나 이미 해소(RESOLVED)된 이벤트에는 버튼이 보이지 않는다', () => {
    const { dialog: noProposal } = LiveDetailHarness({
      initialEntries: [makeEntry({ proposed_severity: null })],
    });
    expect(within(noProposal).queryByRole('button', { name: '승인' })).toBeNull();
    expect(within(noProposal).queryByRole('button', { name: '거절' })).toBeNull();
    cleanup();

    const { dialog: resolved } = LiveDetailHarness({
      initialEntries: [makeEntry({ lifecycle: 'RESOLVED', resolved_at: T + 1_000 })],
    });
    expect(within(resolved).queryByRole('button', { name: '승인' })).toBeNull();
    expect(within(resolved).queryByRole('button', { name: '거절' })).toBeNull();
  });
});

describe('확인 대화상자 및 승인·거절 API 호출', () => {
  it('승인·거절 버튼을 누르면 확인 대화상자가 열리고, 취소하면 API 를 부르지 않는다', () => {
    let called = 0;
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, () => {
        called += 1;
        return HttpResponse.json({});
      }),
    );
    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인' }));
    const confirmDialog = within(aiPanel).getByRole('alertdialog', {
      name: '상향 의견 승인 확인',
    });
    expect(within(confirmDialog).getByRole('button', { name: '승인 확인' })).toBeTruthy();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '취소' }));
    expect(within(aiPanel).queryByRole('alertdialog')).toBeNull();
    expect(called).toBe(0);
  });

  it('승인 확인을 누르면 assessmentId 와 decision=APPROVED 로 호출하고 이력을 남긴다', async () => {
    let receivedBody: unknown;
    let receivedId: string | undefined;
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, async ({ params, request }) => {
        receivedId = String(params.id);
        receivedBody = await request.json();
        return HttpResponse.json({
          escalation_id: '0192a6f0-7c1e-7b3a-9f2d-000000000308',
          event_id: EVENT_ID,
          assessmentId: 'job-20261017-0052',
          decision: 'APPROVED',
          target_severity: 'CRITICAL',
          actor_id: 'admin',
          requested_at: T + 2_000,
          decided_at: T + 2_010,
        });
      }),
    );
    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인' }));
    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인 확인' }));

    await waitFor(() =>
      expect(within(aiPanel).getByRole('list', { name: '상향 이력' })).toBeTruthy(),
    );
    expect(receivedId).toBe(EVENT_ID);
    expect(receivedBody).toEqual({
      assessmentId: 'job-20261017-0052',
      decision: 'APPROVED',
    });
    const history = within(aiPanel).getByRole('list', { name: '상향 이력' });
    expect(within(history).getByText('승인')).toBeTruthy();
    expect(within(history).getByText('admin')).toBeTruthy();
  });

  it('거절 확인을 누르면 assessmentId 와 decision=REJECTED 로 호출하고 거절 이력을 보여 준다', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          event_id: EVENT_ID,
          assessmentId: 'job-20261017-0052',
          decision: 'REJECTED',
          target_severity: 'CRITICAL',
          actor_id: 'admin',
          requested_at: T + 3_000,
          decided_at: T + 3_000,
        });
      }),
    );
    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    fireEvent.click(within(aiPanel).getByRole('button', { name: '거절' }));
    const confirmDialog = within(aiPanel).getByRole('alertdialog', {
      name: '상향 의견 거절 확인',
    });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '거절 확인' }));

    await waitFor(() =>
      expect(within(aiPanel).getByRole('list', { name: '상향 이력' })).toBeTruthy(),
    );
    expect(receivedBody).toEqual({
      assessmentId: 'job-20261017-0052',
      decision: 'REJECTED',
    });
    const history = within(aiPanel).getByRole('list', { name: '상향 이력' });
    expect(within(history).getByText('거절')).toBeTruthy();
  });
});

describe('요청 중 버튼 잠금과 중복 요청 막기', () => {
  it('요청 중에는 버튼을 잠그고, 연달아 눌러도 같은 이벤트로 중복 요청을 보내지 않는다', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({
          escalation_id: '0192a6f0-7c1e-7b3a-9f2d-000000000308',
          decision: 'APPROVED',
          result: 'ACCEPTED',
          target_severity: 'CRITICAL',
          requested_at: T + 1_000,
        });
      }),
    );

    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인' }));
    const confirmBtn = within(aiPanel).getByRole('button', { name: '승인 확인' });
    // 동기 시점에 두 번 눌러도 요청은 한 번만 나간다.
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(
        within(aiPanel).getAllByRole('button', { name: '승인 중…' })[0]?.hasAttribute('disabled'),
      ).toBe(true),
    );
    expect(within(aiPanel).getByRole('button', { name: '거절' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(aiPanel).getByRole('button', { name: '취소' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(calls).toBe(1);

    release();
    await waitFor(() => expect(within(aiPanel).getByText('적용')).toBeTruthy());
    // 처리 완료 뒤에도 버튼이 잠겨 중복 요청을 보내지 않는다.
    expect(within(aiPanel).getByRole('button', { name: '승인' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(aiPanel).getByRole('button', { name: '거절' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(calls).toBe(1);
  });

  it('같은 이벤트 ID 를 쓰는 여러 useEscalateEvent 훅이 pending 상태를 공유한다', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, async () => {
        await gate;
        return HttpResponse.json({ decision: 'APPROVED', result: 'ACCEPTED' });
      }),
    );
    const { wrapper } = setup();
    const ev = makeEvent();
    const { result } = renderHook(
      () => ({
        first: useEscalateEvent(EVENT_ID),
        second: useEscalateEvent(EVENT_ID),
        other: useEscalateEvent('other-event'),
      }),
      { wrapper },
    );

    act(() => result.current.first.escalate(ev, 'APPROVED'));
    await waitFor(() => expect(result.current.second.pending).toBe(true));
    expect(result.current.first.pending).toBe(true);
    expect(result.current.other.pending).toBe(false);

    release();
    await waitFor(() => expect(result.current.second.pending).toBe(false));
  });
});

describe('실패 표시와 목록 갱신', () => {
  it('네트워크 오류·4xx 코드·5xx 오류 문구를 role=alert 로 표시하고 다시 시도할 수 있게 한다', async () => {
    const cases: [() => Response, string][] = [
      [() => HttpResponse.error(), '서버에 연결할 수 없습니다'],
      [
        () => HttpResponse.json({ status: 404, code: 'EVENT_NOT_FOUND' }, { status: 404 }),
        '이벤트를 찾을 수 없습니다',
      ],
      [
        () => HttpResponse.json({ status: 409, code: 'EVENT_RESOLVED' }, { status: 409 }),
        '이미 해소된 이벤트입니다',
      ],
      [
        () => HttpResponse.json({ status: 503, code: 'JOURNAL_UNAVAILABLE' }, { status: 503 }),
        '현장 저널에 기록하지 못했습니다. 잠시 후 다시 시도하세요',
      ],
      [
        () => HttpResponse.json({ status: 500, detail: 'Internal NPE' }, { status: 500 }),
        '상향 의견을 처리하지 못했습니다',
      ],
    ];

    for (const [reply, expectedText] of cases) {
      server.use(http.post(`${BASE}/api/events/:id/escalation`, reply));
      const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
      const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

      fireEvent.click(within(aiPanel).getByRole('button', { name: '승인' }));
      fireEvent.click(within(aiPanel).getByRole('button', { name: '승인 확인' }));

      await waitFor(() =>
        expect(within(aiPanel).getByRole('alert').textContent).toBe(expectedText),
      );
      // 실패 뒤에는 다시 시도할 수 있도록 버튼이 풀린다.
      expect(within(aiPanel).getByRole('button', { name: '승인' }).hasAttribute('disabled')).toBe(
        false,
      );
      cleanup();
    }
  });

  it('서버 상태가 달라진 오류(EVENT_RESOLVED·NOT_ACTIVE·NOT_UPWARD·DUPLICATE)는 이벤트 목록을 다시 받게 한다', () => {
    expect(isStaleEscalationError(new ApiError(409, { code: 'EVENT_RESOLVED' }))).toBe(true);
    expect(isStaleEscalationError(new ApiError(409, { code: 'NOT_ACTIVE' }))).toBe(true);
    expect(isStaleEscalationError(new ApiError(409, { code: 'NOT_UPWARD' }))).toBe(true);
    expect(isStaleEscalationError(new ApiError(409, { code: 'DUPLICATE' }))).toBe(true);
    expect(isStaleEscalationError(new ApiError(404, { code: 'EVENT_NOT_FOUND' }))).toBe(false);
    expect(escalationErrorMessage(new ApiError(NETWORK_ERROR))).toBe('서버에 연결할 수 없습니다');
  });
});

describe('결과·이력 시간순 표시 및 STOMP 갱신 반영(승인 응답만으로 등급이 바뀌지 않음)', () => {
  it('escalations 이력을 시간순(오래된 것 → 최신)으로 정렬해 보여 준다', () => {
    const items: EventEscalation[] = [
      {
        escalation_id: 'esc-late',
        target_severity: 'CRITICAL',
        actor_id: 'admin-2',
        requested_at: T + 5_000,
        note: '두 번째 상향',
      },
      {
        escalation_id: 'esc-early',
        target_severity: 'HIGH',
        actor_id: 'admin-1',
        requested_at: T + 1_000,
        note: '첫 번째 상향',
      },
    ];
    const { dialog } = LiveDetailHarness({
      initialEntries: [
        makeEntry({
          severity: 'CRITICAL',
          proposed_severity: null,
          escalations: items,
        }),
      ],
    });
    const history = within(dialog).getByRole('list', { name: '상향 이력' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('admin-1');
    expect(rows[0]?.textContent).toContain('첫 번째 상향');
    expect(rows[1]?.textContent).toContain('admin-2');
    expect(rows[1]?.textContent).toContain('두 번째 상향');
  });

  it('승인·거절·적용·이미 적용·이벤트 종료 다섯 가지 상태를 모두 구분해 표시한다', () => {
    const cases: [Partial<EventEscalation>, string, string][] = [
      [{ decision: 'APPROVED', result: null }, 'approved', '승인'],
      [{ decision: 'REJECTED' }, 'rejected', '거절'],
      [{ decision: 'APPROVED', result: 'ACCEPTED' }, 'applied', '적용'],
      [{ decision: 'APPROVED', result: 'DUPLICATE' }, 'already_applied', '이미 적용'],
      [
        { decision: 'APPROVED', result: 'REJECTED', reject_reason: 'NOT_UPWARD' },
        'already_applied',
        '이미 적용',
      ],
      [
        { decision: 'APPROVED', result: 'REJECTED', reject_reason: 'NOT_ACTIVE' },
        'event_closed',
        '이벤트 종료',
      ],
    ];
    for (const [fields, expectedKind, expectedLabel] of cases) {
      const item: EventEscalation = {
        target_severity: 'CRITICAL',
        requested_at: T,
        ...fields,
      };
      expect(escalationStatus(item)).toBe(expectedKind);
      expect(escalationStatusLabel(item)).toBe(expectedLabel);
    }

    const entries: EventEscalation[] = [
      {
        escalation_id: '1',
        target_severity: 'HIGH',
        requested_at: T + 1_000,
        decision: 'APPROVED',
        result: null,
      },
      {
        escalation_id: '2',
        target_severity: 'CRITICAL',
        requested_at: T + 2_000,
        decision: 'REJECTED',
      },
      {
        escalation_id: '3',
        target_severity: 'CRITICAL',
        requested_at: T + 3_000,
        result: 'ACCEPTED',
      },
      {
        escalation_id: '4',
        target_severity: 'CRITICAL',
        requested_at: T + 4_000,
        result: 'DUPLICATE',
      },
      {
        escalation_id: '5',
        target_severity: 'CRITICAL',
        requested_at: T + 5_000,
        result: 'REJECTED',
        reject_reason: 'NOT_ACTIVE',
      },
    ];
    const { dialog } = LiveDetailHarness({
      initialEntries: [makeEntry({ proposed_severity: null, escalations: entries })],
    });
    const history = within(dialog).getByRole('list', { name: '상향 이력' });
    const labels = within(history)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(labels[0]).toContain('승인');
    expect(labels[1]).toContain('거절');
    expect(labels[2]).toContain('적용');
    expect(labels[3]).toContain('이미 적용');
    expect(labels[4]).toContain('이벤트 종료');
  });

  it('승인 API 응답만으로는 화면 등급 배지가 바뀌지 않고, STOMP(/topic/events)로 이벤트가 갱신될 때만 등급이 오른다', async () => {
    // 승인 API 가 ACCEPTED 와 CRITICAL 을 돌려주더라도 STOMP 전이가 오기 전까지는 HIGH(경고) 그대로여야 한다.
    server.use(
      http.post(`${BASE}/api/events/:id/escalation`, () =>
        HttpResponse.json({
          escalation_id: '0192a6f0-7c1e-7b3a-9f2d-000000000308',
          event_id: EVENT_ID,
          assessmentId: 'job-20261017-0052',
          decision: 'APPROVED',
          result: 'ACCEPTED',
          target_severity: 'CRITICAL',
          severity: 'CRITICAL',
          actor_id: 'admin',
          requested_at: T + 2_000,
          event_sequence: 2,
          decided_at: T + 2_010,
        }),
      ),
    );

    const realtime = fakeRealtime();
    const { queryClient, dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    bindEventsCache(realtime, queryClient);

    const rulesPanel = within(dialog).getByRole('region', { name: '규칙과 근거' });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    // 초기 상태: 규칙 등급 배지는 경고(HIGH)다.
    expect(within(rulesPanel).getByText('경고')).toBeTruthy();
    expect(within(rulesPanel).queryByText('위험')).toBeNull();

    // 승인 요청 후 응답 도착(아직 STOMP 전이 전)
    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인' }));
    fireEvent.click(within(aiPanel).getByRole('button', { name: '승인 확인' }));

    await waitFor(() =>
      expect(within(aiPanel).getByRole('list', { name: '상향 이력' })).toBeTruthy(),
    );
    expect(within(aiPanel).getByText('적용')).toBeTruthy();

    // 핵심 검증: POST 응답만으로는 규칙·머리줄의 등급 배지가 위험(CRITICAL)으로 바뀌지 않는다.
    expect(within(rulesPanel).getByText('경고')).toBeTruthy();
    expect(within(rulesPanel).queryByText('위험')).toBeNull();
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.entries[0]?.event.severity).toBe(
      'HIGH',
    );

    // 이제 STOMP(/topic/events)로 서버의 UPDATED 전이(severity=CRITICAL, escalations 포함)가 도착한다.
    act(() => {
      realtime.emit(
        'riskEvent',
        makeEvent({
          event_sequence: 2,
          lifecycle: 'UPDATED',
          severity: 'CRITICAL',
          proposed_severity: null,
          updated_at: T + 2_050,
          escalations: [
            {
              escalation_id: '0192a6f0-7c1e-7b3a-9f2d-000000000308',
              basis: 'VLM_PROPOSAL',
              assessment_job_id: 'job-20261017-0052',
              target_severity: 'CRITICAL',
              channel: 'CONTROL_ROOM',
              actor_role: 'ADMIN',
              actor_id: 'admin',
              requested_at: T + 2_000,
              note: 'VLM 근거 확인',
            },
          ],
        }) as RiskEventMessage['payload'],
        0,
      );
    });

    // STOMP 수신 뒤: 등급 배지가 위험(CRITICAL)으로 갱신되고 상향 의견 버튼은 사라지며 이력은 1건으로 합쳐진다.
    await waitFor(() => expect(within(rulesPanel).getByText('위험')).toBeTruthy());
    expect(within(rulesPanel).queryByText('경고')).toBeNull();
    expect(within(aiPanel).queryByText(/상향 의견/)).toBeNull();
    const historyItems = within(
      within(aiPanel).getByRole('list', { name: '상향 이력' }),
    ).getAllByRole('listitem');
    expect(historyItems).toHaveLength(1);
    expect(historyItems[0]?.textContent).toContain('VLM 근거 확인');
  });
});

describe('MSW createEventsMock POST /api/events/:id/escalation', () => {
  const published: RiskEventMessage[] = [];
  const broker = {
    publish: (_: string, body: RiskEventMessage) => published.push(body),
  } as unknown as StompBroker;

  beforeEach(() => {
    published.length = 0;
  });

  function setupMockStore(initialLifecycle: EventItem['lifecycle'] = 'RAISED') {
    const mock = createEventsMock({ broker, now: () => T + 5_000 });
    server.use(...mock.handlers);
    const message: RiskEventMessage = {
      schema_version: '2.1.0',
      msg_type: 'risk_event',
      msg_id: '0192a6f0-7c1e-7b3a-9f2d-000000000100',
      sent_at: T,
      source_id: 'ec2',
      payload: {
        event_id: EVENT_ID,
        event_sequence: 1,
        rule_id: 'R1',
        rule_version: 3,
        source: 'LIVE',
        lifecycle: initialLifecycle,
        verification: 'VERIFIED',
        severity: 'HIGH',
        confidence: 'HIGH',
        needs_check: false,
        world_ids: ['w-0015'],
        zone_id: 'z-02',
        metrics: { zone_distance_m: 0 },
        rationale: '난간 없음',
        proposed_severity: initialLifecycle === 'RESOLVED' ? null : 'CRITICAL',
        raised_at: T,
        updated_at: T,
        ...(initialLifecycle === 'RESOLVED' ? { resolved_at: T } : {}),
      },
    };
    mock.record(message);
    return mock;
  }

  const postEscalation = (account: string | null, body: unknown) =>
    fetch(`${BASE}/api/events/${EVENT_ID}/escalation`, {
      method: 'POST',
      headers: {
        ...(account ? { Authorization: `Bearer mock-token.${account}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  it('관리자만 호출할 수 있고 반장·열람 계정은 403, 미인증은 401 이다', async () => {
    setupMockStore();
    expect(
      (await postEscalation(null, { assessmentId: 'job-1', decision: 'APPROVED' })).status,
    ).toBe(401);
    expect(
      (await postEscalation('viewer', { assessmentId: 'job-1', decision: 'APPROVED' })).status,
    ).toBe(403);
    expect(
      (await postEscalation('foreman', { assessmentId: 'job-1', decision: 'APPROVED' })).status,
    ).toBe(403);
    expect(published).toHaveLength(0);
  });

  it('승인하면 ACCEPTED 결과를 돌려주고 계약에 맞는 UPDATED 전이를 /topic/events 로 발행하며, 같은 평가 ID 재요청은 DUPLICATE 다', async () => {
    setupMockStore();
    const res = await postEscalation('admin', {
      assessmentId: 'job-1',
      decision: 'APPROVED',
      note: '현장 확인 완료',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventEscalation;
    expect(body).toMatchObject({
      decision: 'APPROVED',
      result: 'ACCEPTED',
      target_severity: 'CRITICAL',
      actor_id: 'admin',
      note: '현장 확인 완료',
    });
    expect(published).toHaveLength(1);
    expect(validateMessage('risk_event', published[0]).ok).toBe(true);
    expect(published[0]?.payload.severity).toBe('CRITICAL');
    expect(published[0]?.payload.proposed_severity).toBeNull();
    expect(published[0]?.payload.escalations).toHaveLength(1);

    // 같은 assessmentId 로 다시 승인하면 DUPLICATE(이미 적용)를 돌려주고 새 전이는 발행하지 않는다.
    const dup = await postEscalation('admin', { assessmentId: 'job-1', decision: 'APPROVED' });
    const dupBody = (await dup.json()) as EventEscalation;
    expect(dupBody.result).toBe('DUPLICATE');
    expect(escalationStatusLabel(dupBody)).toBe('이미 적용');
    expect(published).toHaveLength(1);

    // 다른 assessmentId 로 보냈더라도 이미 CRITICAL 이면 NOT_UPWARD(이미 적용)다.
    const notUpward = await postEscalation('admin', {
      assessmentId: 'job-2',
      decision: 'APPROVED',
    });
    const notUpwardBody = (await notUpward.json()) as EventEscalation;
    expect(notUpwardBody).toMatchObject({ result: 'REJECTED', reject_reason: 'NOT_UPWARD' });
    expect(escalationStatusLabel(notUpwardBody)).toBe('이미 적용');
  });

  it('이미 해소된 이벤트는 NOT_ACTIVE(이벤트 종료)를 돌려주고, 거절은 전이 발행 없이 REJECTED 를 돌려준다', async () => {
    setupMockStore('RESOLVED');
    const closedRes = await postEscalation('admin', {
      assessmentId: 'job-1',
      decision: 'APPROVED',
    });
    const closedBody = (await closedRes.json()) as EventEscalation;
    expect(closedBody).toMatchObject({ result: 'REJECTED', reject_reason: 'NOT_ACTIVE' });
    expect(escalationStatusLabel(closedBody)).toBe('이벤트 종료');
    expect(published).toHaveLength(0);

    setupMockStore('RAISED');
    const rejectedRes = await postEscalation('admin', {
      assessmentId: 'job-1',
      decision: 'REJECTED',
    });
    const rejectedBody = (await rejectedRes.json()) as EventEscalation;
    expect(rejectedBody).toMatchObject({ decision: 'REJECTED', target_severity: 'CRITICAL' });
    expect(escalationStatusLabel(rejectedBody)).toBe('거절');
    expect(published).toHaveLength(0);

    // mergedEscalations 가 서버 escalations 와 로컬 거절 이력을 시간순으로 합치는지 확인한다.
    const combined = mergedEscalations(
      makeEvent({
        escalations: [
          {
            escalation_id: 'esc-1',
            target_severity: 'HIGH',
            requested_at: T + 1_000,
          },
        ],
      }),
      [rejectedBody],
    );
    expect(combined.map(escalationStatusLabel)).toEqual(['적용', '거절']);
  });
});

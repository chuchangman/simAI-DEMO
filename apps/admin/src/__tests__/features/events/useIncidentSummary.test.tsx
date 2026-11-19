import { EventDetail } from '@/features/events/EventDetail';
import {
  canRequestSummary,
  groupIncidents,
  isSummaryFailed,
  isSummaryInProgress,
  latestSummary,
  mergeEvent,
  summaryErrorMessage,
  summaryFailureMessage,
  summaryStatusLabel,
  type EventEntry,
} from '@/features/events/events';
import { bindEventsCache, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem, EventSummary } from '@/features/events/types';
import { useIncidentSummary } from '@/features/events/useIncidentSummary';
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
    proposed_severity: null,
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
function LiveDetailHarness({
  initialEntries,
  onSeekTimestamp,
}: {
  initialEntries: EventEntry[];
  onSeekTimestamp?: (timestampMs: number) => void;
}) {
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
    return (
      <EventDetail
        incident={incident}
        openEventId={EVENT_ID}
        onClose={vi.fn()}
        onSeekTimestamp={onSeekTimestamp}
      />
    );
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

describe('구간 요약 요청 버튼 표시 조건', () => {
  it('관리자(ADMIN)이고 LIVE 이벤트일 때만 구간 요약 요청 버튼이 보인다(활성·해소 이벤트 모두 포함)', () => {
    signInAs('admin', 'ADMIN');
    const { dialog: activeDialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const activeAiPanel = within(activeDialog).getByRole('region', { name: 'AI 설명' });
    expect(within(activeAiPanel).getByRole('button', { name: '구간 요약 요청' })).toBeTruthy();
    cleanup();

    const { dialog: resolvedDialog } = LiveDetailHarness({
      initialEntries: [makeEntry({ lifecycle: 'RESOLVED', resolved_at: T + 5_000 })],
    });
    const resolvedAiPanel = within(resolvedDialog).getByRole('region', { name: 'AI 설명' });
    expect(within(resolvedAiPanel).getByRole('button', { name: '구간 요약 요청' })).toBeTruthy();
  });

  it.each(['FOREMAN', 'VIEWER'] as const)(
    '%s 권한에는 구간 요약 요청 버튼이 보이지 않는다',
    (role) => {
      signInAs(role.toLowerCase(), role);
      const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
      const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
      expect(within(aiPanel).queryByRole('button', { name: '구간 요약 요청' })).toBeNull();
    },
  );

  it.each(['REPLAY', 'PLANNED', 'WHAT_IF'] as const)(
    'source=%s 인 비실시간 이벤트에는 관리자라도 구간 요약 요청 버튼이 보이지 않는다',
    (source) => {
      signInAs('admin', 'ADMIN');
      expect(canRequestSummary(makeEvent({ source }), 'ADMIN')).toBe(false);
      const { dialog } = LiveDetailHarness({
        initialEntries: [makeEntry({ source })],
      });
      const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
      expect(within(aiPanel).queryByRole('button', { name: '구간 요약 요청' })).toBeNull();
      cleanup();
    },
  );
});

describe('요청 → 대기 상태 표시 → STOMP 갱신 → 결과 표시', () => {
  it('구간 요약 요청 시 202 QUEUED 응답으로 버튼 대신 대기 중 상태를 보여 주고, STOMP 갱신으로 요약 본문·근거 시각·AI 설명 배지를 표시한다', async () => {
    let calledEventId: string | undefined;
    server.use(
      http.post(`${BASE}/api/events/:id/summary`, ({ params }) => {
        calledEventId = String(params.id);
        return HttpResponse.json(
          {
            summary_id: 17,
            job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000517',
            status: 'QUEUED',
          },
          { status: 202 },
        );
      }),
    );

    const seeked: number[] = [];
    const realtime = fakeRealtime();
    const { queryClient, dialog } = LiveDetailHarness({
      initialEntries: [makeEntry()],
      onSeekTimestamp: (ts) => seeked.push(ts),
    });
    bindEventsCache(realtime, queryClient);

    const rulesPanel = within(dialog).getByRole('region', { name: '규칙과 근거' });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    // 초기 규칙 등급 배지는 경고(HIGH)다.
    expect(within(rulesPanel).getByText('경고')).toBeTruthy();

    fireEvent.click(within(aiPanel).getByRole('button', { name: '구간 요약 요청' }));

    // 202 QUEUED 응답 뒤: 요청 버튼은 사라지고 대기 중 상태가 표시된다.
    await waitFor(() =>
      expect(within(aiPanel).getByRole('status').textContent).toContain('구간 요약 대기 중'),
    );
    expect(calledEventId).toBe(EVENT_ID);
    expect(within(aiPanel).queryByRole('button', { name: '구간 요약 요청' })).toBeNull();

    // STOMP 로 RUNNING 상태가 도착하면 실행 중 상태를 표시한다.
    act(() => {
      realtime.emit(
        'riskEvent',
        makeEvent({
          updated_at: T + 500,
          summaries: [
            {
              summary_id: 17,
              job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000517',
              status: 'RUNNING',
              requested_at: T + 100,
              finished_at: null,
              summary: null,
              evidence_timestamps_ms: [],
              window_start_ms: T - 5_000,
              window_end_ms: T + 10_000,
              error_code: null,
            },
          ],
        }) as unknown as RiskEventMessage['payload'],
        0,
      );
    });

    await waitFor(() =>
      expect(within(aiPanel).getByRole('status').textContent).toContain('구간 요약 실행 중'),
    );
    expect(within(aiPanel).queryByRole('button', { name: '구간 요약 요청' })).toBeNull();

    // STOMP(/topic/events)로 SUCCEEDED 결과가 도착한다(event_sequence 증가 없이 summaries 만 갱신된 재발행 포함).
    const summaryText =
      '작업자 w-0015가 단상 경계에 접근한 뒤 난간 없는 가장자리에서 4초간 머물렀습니다.';
    act(() => {
      realtime.emit(
        'riskEvent',
        makeEvent({
          updated_at: T + 2_000,
          summaries: [
            {
              summary_id: 17,
              job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000517',
              status: 'SUCCEEDED',
              requested_at: T + 100,
              finished_at: T + 1_900,
              summary: summaryText,
              evidence_timestamps_ms: [T + 200, T + 1_400],
              window_start_ms: T - 5_000,
              window_end_ms: T + 10_000,
              error_code: null,
            },
          ],
        }) as unknown as RiskEventMessage['payload'],
        0,
      );
    });

    await waitFor(() => expect(within(aiPanel).getByText(summaryText)).toBeTruthy());
    // AI 설명임을 표시하고 규칙 등급 배지·알람에는 영향을 주지 않는다(규칙 4).
    const summaryGroup = within(aiPanel).getByRole('group', { name: '사고 구간 요약' });
    expect(within(summaryGroup).getByText('AI 설명')).toBeTruthy();
    expect(within(rulesPanel).getByText('경고')).toBeTruthy();
    expect(within(rulesPanel).queryByText('위험')).toBeNull();
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.entries[0]?.event.severity).toBe(
      'HIGH',
    );

    // 근거 시각 목록 표시 및 클릭 시 해당 시각으로 이동 콜백 호출
    const tsList = within(summaryGroup).getByRole('list', { name: '근거 시각' });
    const tsButtons = within(tsList).getAllByRole('button');
    expect(tsButtons).toHaveLength(2);
    fireEvent.click(tsButtons[0]!);
    expect(seeked).toEqual([T + 200]);
  });

  it('onSeekTimestamp 콜백이 없으면 근거 시각을 클릭 버튼이 아닌 텍스트 목록으로만 표시한다', () => {
    const { dialog } = LiveDetailHarness({
      initialEntries: [
        makeEntry({
          summaries: [
            {
              summary_id: 18,
              job_id: 'job-18',
              status: 'SUCCEEDED',
              requested_at: T,
              finished_at: T + 1_000,
              summary: '요약 완료 본문입니다.',
              evidence_timestamps_ms: [T + 100, T + 800],
              window_start_ms: T - 5_000,
              window_end_ms: T + 5_000,
              error_code: null,
            },
          ],
        }),
      ],
    });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
    const tsList = within(aiPanel).getByRole('list', { name: '근거 시각' });
    expect(within(tsList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(tsList).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('실패 안내 및 다시 요청', () => {
  it('FAILED·TIMED_OUT 상태이면 오류 사유와 다시 요청 버튼을 보여 주고, 다시 요청하면 대기 상태로 전환된다', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/api/events/:id/summary`, () => {
        calls += 1;
        return HttpResponse.json(
          {
            summary_id: 21,
            job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000521',
            status: 'QUEUED',
          },
          { status: 202 },
        );
      }),
    );

    const failedSummary: EventSummary = {
      summary_id: 20,
      job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000520',
      status: 'FAILED',
      requested_at: T + 100,
      finished_at: T + 900,
      summary: null,
      evidence_timestamps_ms: [],
      window_start_ms: T - 5_000,
      window_end_ms: T + 10_000,
      error_code: 'VLM_UNAVAILABLE',
    };

    const { dialog } = LiveDetailHarness({
      initialEntries: [makeEntry({ summaries: [failedSummary] })],
    });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

    expect(within(aiPanel).getByRole('alert').textContent).toBe(
      'AI 요약 서버에 연결할 수 없습니다',
    );
    const retryBtn = within(aiPanel).getByRole('button', { name: '다시 요청' });
    expect(retryBtn).toBeTruthy();

    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(within(aiPanel).getByRole('status').textContent).toContain('구간 요약 대기 중'),
    );
    expect(calls).toBe(1);
    expect(within(aiPanel).queryByRole('button', { name: '다시 요청' })).toBeNull();
  });

  it('TIMED_OUT 과 각종 error_code 별 한국어 안내 문구를 정확히 매핑한다', () => {
    const base: EventSummary = {
      summary_id: 1,
      job_id: 'job-1',
      status: 'FAILED',
      requested_at: T,
      finished_at: T + 1_000,
      summary: null,
      evidence_timestamps_ms: [],
      window_start_ms: null,
      window_end_ms: null,
      error_code: null,
    };
    expect(summaryFailureMessage({ ...base, status: 'TIMED_OUT', error_code: 'TIMED_OUT' })).toBe(
      '구간 요약 시간이 초과되었습니다',
    );
    expect(summaryFailureMessage({ ...base, error_code: 'CLIP_NOT_READY' })).toBe(
      '클립이 아직 준비되지 않았습니다',
    );
    expect(summaryFailureMessage({ ...base, error_code: 'VLM_ANSWER_INVALID' })).toBe(
      'AI 요약 결과를 읽지 못했습니다',
    );
    expect(summaryFailureMessage({ ...base, error_code: 'UNKNOWN' })).toBe(
      '구간 요약에 실패했습니다 (UNKNOWN)',
    );
    expect(summaryFailureMessage(base)).toBe('구간 요약에 실패했습니다');
    expect(isSummaryInProgress({ ...base, status: 'QUEUED' })).toBe(true);
    expect(isSummaryInProgress({ ...base, status: 'RUNNING' })).toBe(true);
    expect(isSummaryFailed({ ...base, status: 'FAILED' })).toBe(true);
    expect(isSummaryFailed({ ...base, status: 'TIMED_OUT' })).toBe(true);
    expect(summaryStatusLabel('QUEUED')).toBe('구간 요약 대기 중');
    expect(summaryStatusLabel('RUNNING')).toBe('구간 요약 실행 중');
  });
});

describe('409 CLIP_NOT_READY 등 요청 에러 문구 표시', () => {
  it('409 CLIP_NOT_READY 응답 시 "클립이 아직 준비되지 않았습니다"를 표시하고 다시 요청할 수 있게 버튼을 풀어 둔다', async () => {
    const cases: [() => Response, string][] = [
      [
        () =>
          HttpResponse.json(
            {
              status: 409,
              code: 'CLIP_NOT_READY',
              detail: '클립이 아직 준비되지 않았습니다',
            },
            { status: 409 },
          ),
        '클립이 아직 준비되지 않았습니다',
      ],
      [
        () => HttpResponse.json({ status: 409, code: 'EVENT_NOT_LIVE' }, { status: 409 }),
        '실시간(LIVE) 이벤트에서만 구간 요약을 요청할 수 있습니다',
      ],
      [
        () => HttpResponse.json({ status: 404, code: 'EVENT_NOT_FOUND' }, { status: 404 }),
        '이벤트를 찾을 수 없습니다',
      ],
      [() => HttpResponse.error(), '서버에 연결할 수 없습니다'],
      [
        () => HttpResponse.json({ status: 500, detail: 'Internal error' }, { status: 500 }),
        '구간 요약을 요청하지 못했습니다',
      ],
    ];

    for (const [reply, expectedText] of cases) {
      server.use(http.post(`${BASE}/api/events/:id/summary`, reply));
      const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
      const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });

      fireEvent.click(within(aiPanel).getByRole('button', { name: '구간 요약 요청' }));

      await waitFor(() =>
        expect(within(aiPanel).getByRole('alert').textContent).toBe(expectedText),
      );
      expect(
        within(aiPanel).getByRole('button', { name: '구간 요약 요청' }).hasAttribute('disabled'),
      ).toBe(false);
      cleanup();
    }

    expect(summaryErrorMessage(new ApiError(NETWORK_ERROR))).toBe('서버에 연결할 수 없습니다');
  });
});

describe('중복 클릭 방지', () => {
  it('요청 중에는 버튼을 잠그고, 동기 시점에 연달아 눌러도 같은 이벤트로 중복 요청을 보내지 않는다', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post(`${BASE}/api/events/:id/summary`, async () => {
        calls += 1;
        await gate;
        return HttpResponse.json(
          {
            summary_id: 30,
            job_id: '0192a6f0-7c1e-7b3a-9f2d-000000000530',
            status: 'QUEUED',
          },
          { status: 202 },
        );
      }),
    );

    const { dialog } = LiveDetailHarness({ initialEntries: [makeEntry()] });
    const aiPanel = within(dialog).getByRole('region', { name: 'AI 설명' });
    const btn = within(aiPanel).getByRole('button', { name: '구간 요약 요청' });

    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() =>
      expect(
        within(aiPanel).getByRole('button', { name: '요청 중…' }).hasAttribute('disabled'),
      ).toBe(true),
    );
    expect(calls).toBe(1);

    release();
    await waitFor(() =>
      expect(within(aiPanel).getByRole('status').textContent).toContain('구간 요약 대기 중'),
    );
    expect(calls).toBe(1);
  });

  it('같은 이벤트 ID 를 쓰는 여러 useIncidentSummary 훅이 pending 상태를 공유한다', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/api/events/:id/summary`, async () => {
        await gate;
        return HttpResponse.json(
          { summary_id: 31, job_id: 'job-31', status: 'QUEUED' },
          { status: 202 },
        );
      }),
    );
    const { wrapper } = setup();
    const ev = makeEvent();
    const { result } = renderHook(
      () => ({
        first: useIncidentSummary(EVENT_ID),
        second: useIncidentSummary(EVENT_ID),
        other: useIncidentSummary('other-event'),
      }),
      { wrapper },
    );

    act(() => result.current.first.requestSummary(ev));
    await waitFor(() => expect(result.current.second.pending).toBe(true));
    expect(result.current.first.pending).toBe(true);
    expect(result.current.other.pending).toBe(false);

    release();
    await waitFor(() => expect(result.current.second.pending).toBe(false));
    expect(latestSummary(ev, result.current.second.localRecord)?.status).toBe('QUEUED');
  });
});

describe('MSW createEventsMock POST /api/events/:id/summary', () => {
  const published: RiskEventMessage[] = [];
  const broker = {
    publish: (_: string, body: RiskEventMessage) => published.push(body),
  } as unknown as StompBroker;

  beforeEach(() => {
    published.length = 0;
  });

  function setupMockStore(source: EventItem['source'] = 'LIVE') {
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
        source,
        lifecycle: 'RAISED',
        verification: 'VERIFIED',
        severity: 'HIGH',
        confidence: 'HIGH',
        needs_check: false,
        world_ids: ['w-0015'],
        zone_id: 'z-02',
        metrics: { zone_distance_m: 0 },
        rationale: '난간 없음',
        proposed_severity: null,
        raised_at: T,
        updated_at: T,
      },
    };
    mock.record(message);
    return mock;
  }

  const postSummary = (account: string | null, eventId = EVENT_ID) =>
    fetch(`${BASE}/api/events/${eventId}/summary`, {
      method: 'POST',
      headers: account ? { Authorization: `Bearer mock-token.${account}` } : {},
    });

  it('관리자만 호출할 수 있고, 첫 요청은 202 QUEUED, 진행 중 재요청은 200 으로 같은 작업을 돌려주며 STOMP 완료 갱신을 발행한다', async () => {
    const mock = setupMockStore('LIVE');

    expect((await postSummary(null)).status).toBe(401);
    expect((await postSummary('viewer')).status).toBe(403);
    expect((await postSummary('foreman')).status).toBe(403);

    const first = await postSummary('admin');
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as {
      summary_id: number;
      job_id: string;
      status: string;
    };
    expect(firstBody.status).toBe('QUEUED');
    expect(published).toHaveLength(1);

    // 진행 중(QUEUED)일 때 중복 호출하면 새 행을 만들지 않고 200 으로 같은 summary_id·job_id 를 돌려준다.
    const dup = await postSummary('admin');
    expect(dup.status).toBe(200);
    const dupBody = (await dup.json()) as typeof firstBody;
    expect(dupBody).toEqual(firstBody);
    expect(published).toHaveLength(1);

    // 워커 완료 시뮬레이션 → STOMP /topic/events 재발행
    mock.updateSummary(EVENT_ID, {
      status: 'SUCCEEDED',
      finished_at: T + 6_000,
      summary: '작업자 위험구역 진입 요약 완료',
      evidence_timestamps_ms: [T + 200, T + 900],
    });
    expect(published).toHaveLength(2);
    expect(validateMessage('risk_event', published[1]).ok).toBe(true);
    const summaries = (published[1]?.payload as unknown as EventItem).summaries;
    expect(summaries?.[0]?.status).toBe('SUCCEEDED');
    expect(summaries?.[0]?.summary).toBe('작업자 위험구역 진입 요약 완료');
  });

  it('CLIP_NOT_READY·EVENT_NOT_LIVE·EVENT_NOT_FOUND 에러 계약을 준수한다', async () => {
    const mock = setupMockStore('LIVE');
    mock.failNextSummary('CLIP_NOT_READY');
    const clipRes = await postSummary('admin');
    expect(clipRes.status).toBe(409);
    expect(await clipRes.json()).toMatchObject({
      code: 'CLIP_NOT_READY',
      detail: '클립이 아직 준비되지 않았습니다',
    });

    const missingRes = await postSummary('admin', 'missing-event');
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toMatchObject({ code: 'EVENT_NOT_FOUND' });

    setupMockStore('REPLAY');
    const replayRes = await postSummary('admin');
    expect(replayRes.status).toBe(409);
    expect(await replayRes.json()).toMatchObject({ code: 'EVENT_NOT_LIVE' });
  });
});

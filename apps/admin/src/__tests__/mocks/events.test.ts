import { createEventsMock } from '@/mocks/events';
import { riskEventsBetween, seededEventsAt } from '@/mocks/realtimeScenario';
import type { StompBroker } from '@/mocks/stompBroker';
import { validateMessage, type RiskEventMessage } from '@simai/contracts';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const published: unknown[] = [];
const broker = {
  publish: (_: string, body: unknown) => published.push(body),
} as unknown as StompBroker;
const NOW = 1_760_342_450_000;
const mock = createEventsMock({ broker, now: () => NOW });
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  published.length = 0;
});

const edge = riskEventsBetween(0, 40_000).filter((m) => m.payload.rule_id === 'R2');
const [raised, updated, resolved] = edge as [RiskEventMessage, RiskEventMessage, RiskEventMessage];

type Payload = RiskEventMessage['payload'];

const ack = (eventId: string, account: string, body: unknown = { event_sequence: 1 }) =>
  fetch(`http://api.test/api/events/${eventId}/ack`, {
    method: 'POST',
    headers: { Authorization: `Bearer mock-token.${account}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const list = (query = '', account: string | null = 'admin') =>
  fetch(`http://api.test/api/events${query}`, {
    headers: account ? { Authorization: `Bearer mock-token.${account}` } : {},
  });

interface Page {
  content: Payload[];
  totalElements: number;
  number: number;
  size: number;
}

/** 새 저장소로 시험한다(위 mock 의 상태와 섞이지 않게). */
function fresh() {
  const local = createEventsMock({ broker, now: () => NOW });
  server.use(...local.handlers);
  return local;
}

/** 번호가 같으면 같은 이벤트 id(UUIDv7 형식, 계약 검사를 통과한다). */
const id = (index: number) => `0192a6f0-7c1e-7b3a-9f2d-${String(index).padStart(12, '0')}`;

/** 번호 순으로 발생 시각이 늦은 이벤트(번호가 클수록 최신). */
const numbered = (index: number, lifecycle: Payload['lifecycle'] = 'RAISED'): RiskEventMessage => ({
  ...raised,
  sent_at: NOW,
  payload: {
    ...raised.payload,
    event_id: id(index),
    raised_at: NOW - 60_000 + index,
    updated_at: NOW,
    lifecycle,
  },
});

describe('createEventsMock', () => {
  it('ACK 하면 확인 기록을 더하고 순번을 올려 /topic/events 로 보내며, 다음 전이에도 확인 기록이 이어진다', async () => {
    expect(mock.record(raised).payload.event_sequence).toBe(1);

    const response = await ack(raised.payload.event_id, 'admin');
    expect(response.status).toBe(200);
    const body = (await response.json()) as RiskEventMessage['payload'];
    expect(body.event_sequence).toBe(2);
    expect(body.acks).toMatchObject([
      { channel: 'CONTROL_ROOM', actor_id: 'admin', actor_role: 'ADMIN', acked_at: NOW },
    ]);
    expect(published).toHaveLength(1);
    const sent = published[0] as RiskEventMessage;
    expect(validateMessage('risk_event', sent).ok).toBe(true);

    const next = mock.record(updated);
    expect(next.payload.event_sequence).toBe(3);
    expect(next.payload.acks).toHaveLength(1);
    expect(validateMessage('risk_event', next).ok).toBe(true);
  });

  it('목록은 저장소의 이벤트를 최신 발생순으로 준다', async () => {
    const page = (await (await list('?page=0&size=100')).json()) as Page;
    expect(page.content.map((e) => e.event_id)).toContain(raised.payload.event_id);
  });

  it('열람 계정은 403, 해소된 이벤트는 409, 로그인 없으면 401 이다', async () => {
    expect((await ack(raised.payload.event_id, 'viewer')).status).toBe(403);
    mock.record(resolved);
    expect((await ack(raised.payload.event_id, 'admin')).status).toBe(409);
    expect(
      (await fetch(`http://api.test/api/events/${raised.payload.event_id}/ack`, { method: 'POST' }))
        .status,
    ).toBe(401);
    expect(published).toHaveLength(0);
  });

  it('실서버 토큰(혼합 모드)은 sub·role 로 확인을 남기고, 만료됐거나 expireAuth 뒤 한 번은 401 이다', async () => {
    const local = fresh();
    local.record(raised);
    const jwt = (claims: object) =>
      `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;
    const ackWith = (token: string) =>
      fetch(`http://api.test/api/events/${raised.payload.event_id}/ack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    const expired = jwt({ sub: '42', role: 'ADMIN', exp: NOW / 1000 - 1 });
    const live = jwt({ sub: '42', role: 'FOREMAN', exp: NOW / 1000 + 1800 });

    const rejected = await ackWith(expired);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ code: 'UNAUTHORIZED' });

    local.expireAuth();
    expect((await ackWith(live)).status).toBe(401);
    const accepted = await ackWith(live);
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as RiskEventMessage['payload']).acks).toEqual([
      expect.objectContaining({ actor_id: '42', actor_role: 'FOREMAN' }),
    ]);
  });
});

describe('GET /api/events', () => {
  it('Spring Page 모양으로 최신 발생순에, 해소된 이벤트도 담아 준다', async () => {
    const local = fresh();
    local.record(numbered(1));
    local.record(numbered(3, 'RESOLVED'));
    local.record(numbered(2));

    const response = await list('?page=0&size=100');
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    expect(page).toMatchObject({ totalElements: 3, number: 0, size: 100 });
    expect(page.content.map((e) => e.event_id)).toEqual([id(3), id(2), id(1)]);
    expect(page.content[0]?.lifecycle).toBe('RESOLVED');
  });

  it('page·size 를 따르고, 기본 크기는 20 이다', async () => {
    const local = fresh();
    for (let i = 1; i <= 45; i++) local.record(numbered(i));

    const first = (await (await list()).json()) as Page;
    expect(first).toMatchObject({ totalElements: 45, number: 0, size: 20 });
    expect(first.content).toHaveLength(20);
    expect(first.content[0]?.event_id).toBe(id(45));

    const third = (await (await list('?page=2')).json()) as Page;
    expect(third.content.map((e) => e.event_id)).toEqual([id(5), id(4), id(3), id(2), id(1)]);

    const sized = (await (await list('?page=1&size=40')).json()) as Page;
    expect(sized).toMatchObject({ number: 1, size: 40 });
    expect(sized.content).toHaveLength(5);

    const beyond = (await (await list('?page=9&size=100')).json()) as Page;
    expect(beyond.content).toEqual([]);
    expect(beyond.totalElements).toBe(45);
  });

  it('size 는 100 까지, page 는 0 이상 정수만 받는다. 아니면 400', async () => {
    fresh();
    expect((await list('?size=100')).status).toBe(200);
    for (const query of [
      '?size=101',
      '?size=0',
      '?size=-1',
      '?size=abc',
      '?page=-1',
      '?page=1.5',
    ]) {
      const response = await list(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ status: 400, code: expect.any(String) });
    }
  });

  it('열람 계정은 403 ProblemDetail, 반장은 볼 수 있고, 로그인이 없으면 401 이다', async () => {
    fresh();
    const viewer = await list('', 'viewer');
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect((await list('', 'foreman')).status).toBe(200);
    expect((await list('', null)).status).toBe(401);
  });

  it('비어 있는 선택 칸은 빼고 zone_id·rationale·proposed_severity 는 null 로 보낸다', async () => {
    const local = fresh();
    // 저장소에 칸이 아예 없거나 비어 있는 이벤트.
    const bare = {
      ...numbered(1).payload,
      zone_id: undefined,
      rationale: undefined,
      proposed_severity: undefined,
      acks: [],
      confidence_reasons: [],
      resolved_at: null,
    };
    local.record({ ...numbered(1), payload: bare as unknown as Payload });

    const [event] = ((await (await list()).json()) as Page).content;
    expect(event).toMatchObject({ zone_id: null, rationale: null, proposed_severity: null });
    for (const key of ['acks', 'confidence_reasons', 'resolved_at', 'resolution', 'escalations']) {
      expect(event).not.toHaveProperty(key);
    }
  });
});

describe('POST /api/events/:id/ack', () => {
  it('본문 없이 보내면 CONTROL_ROOM 이고, FOREMAN_PWA 도 받는다', async () => {
    const local = fresh();
    local.record(numbered(1));
    const noBody = await fetch(`http://api.test/api/events/${id(1)}/ack`, {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-token.admin' },
    });
    expect(noBody.status).toBe(200);
    expect(((await noBody.json()) as Payload).acks?.[0]?.channel).toBe('CONTROL_ROOM');

    const pwa = await ack(id(1), 'foreman', { channel: 'FOREMAN_PWA' });
    expect(pwa.status).toBe(200);
    const body = (await pwa.json()) as Payload;
    expect(body.acks?.map((a) => [a.channel, a.actor_role])).toEqual([
      ['CONTROL_ROOM', 'ADMIN'],
      ['FOREMAN_PWA', 'FOREMAN'],
    ]);
  });

  it('돌려주는 것은 새 확인이 든 이벤트 전체이고, 서버처럼 빈 칸은 빼고 null 칸은 둔다', async () => {
    const local = fresh();
    local.record(numbered(1));
    const body = (await (await ack(id(1), 'admin')).json()) as Payload;
    expect(body).toMatchObject({
      event_id: id(1),
      rule_id: 'R2',
      lifecycle: 'RAISED',
      zone_id: 'z-04',
      rationale: null,
      proposed_severity: null,
    });
    expect(body.acks).toHaveLength(1);
    expect(validateMessage('risk_event', { ...raised, payload: body }).ok).toBe(true);
  });

  it('없는 이벤트는 404 EVENT_NOT_FOUND, 해소됐으면 409 EVENT_RESOLVED', async () => {
    const local = fresh();
    local.record(numbered(1, 'RESOLVED'));

    const missing = await ack('nope', 'admin');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ status: 404, code: 'EVENT_NOT_FOUND' });

    const closed = await ack(id(1), 'admin');
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ status: 409, code: 'EVENT_RESOLVED' });
    expect(published).toHaveLength(0);
  });

  it('channel 이 CONTROL_ROOM·FOREMAN_PWA 가 아니면 400 INVALID_ACK_CHANNEL', async () => {
    const local = fresh();
    local.record(numbered(1));
    for (const channel of ['SITE_BUTTON', 'control_room', '', 3]) {
      const response = await ack(id(1), 'admin', { channel });
      expect(response.status, String(channel)).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_ACK_CHANNEL' });
    }
    expect(published).toHaveLength(0);
  });

  it('보던 event_sequence 가 저장된 순번보다 크면 400 INVALID_EVENT_SEQUENCE, 같거나 작으면 받는다', async () => {
    const local = fresh();
    const stored = local.record(numbered(1));
    expect(stored.payload.event_sequence).toBe(1);

    for (const event_sequence of [2, 99, 'x', 1.5]) {
      const response = await ack(id(1), 'admin', { event_sequence });
      expect(response.status, String(event_sequence)).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_EVENT_SEQUENCE' });
    }
    expect((await ack(id(1), 'admin', { event_sequence: 1 })).status).toBe(200);
    // 확인이 순번을 올렸다(2). 이전 순번(1)으로 보낸 확인도 받는다.
    expect((await ack(id(1), 'admin', { event_sequence: 1 })).status).toBe(200);
    expect((await ack(id(1), 'admin', {})).status).toBe(200);
  });
});

describe('close(운영자 종료)', () => {
  it('해소 전이에 resolution 을 싣고 순번을 올려 /topic/events 로 보낸다', async () => {
    const local = fresh();
    local.record(numbered(1));

    const closed = local.close(id(1), { id: 'admin' }, '오탐');
    expect(closed?.payload).toMatchObject({
      lifecycle: 'RESOLVED',
      event_sequence: 2,
      resolved_at: NOW,
      resolution: {
        kind: 'OPERATOR_CLOSED',
        channel: 'CONTROL_ROOM',
        actor_role: 'ADMIN',
        actor_id: 'admin',
        requested_at: NOW,
        reason: '오탐',
      },
    });
    const resolution = closed?.payload.resolution;
    expect(resolution?.kind === 'OPERATOR_CLOSED' ? resolution.close_id : undefined).toEqual(
      expect.any(String),
    );
    expect(published).toEqual([closed]);
    expect(validateMessage('risk_event', closed).ok).toBe(true);

    // REST 목록에도 같은 상태가 보이고, 더는 확인할 수 없다.
    const [event] = ((await (await list()).json()) as Page).content;
    expect(event).toMatchObject({ lifecycle: 'RESOLVED', resolution: { reason: '오탐' } });
    expect((await ack(id(1), 'admin')).status).toBe(409);
  });

  it('없거나 이미 해소된 이벤트는 닫지 않는다', () => {
    const local = fresh();
    local.record(numbered(1, 'RESOLVED'));
    expect(local.close('none', { id: 'admin' })).toBeUndefined();
    expect(local.close(id(1), { id: 'admin' })).toBeUndefined();
    expect(published).toHaveLength(0);
  });
});

// S15P31A101-595: 개발 서버는 진행 중과 지난 관제(꺼진 관제에서 열린 채 남은) 이벤트를 함께 싣고 시작한다.
describe('createEventsMock 시드', () => {
  it('시드 이벤트는 계약을 지키고 목록에 held_by_tier0 그대로 나온다(진행 중 둘, 지난 관제 셋)', async () => {
    const seed = seededEventsAt(NOW);
    for (const message of seed) expect(validateMessage('risk_event', message).ok).toBe(true);
    const local = createEventsMock({ broker, now: () => NOW, seed });
    server.use(...local.handlers);
    const page = (await (await list('?size=100')).json()) as Page;
    const held = page.content.filter((e) => e.held_by_tier0).map((e) => e.event_id);
    const stale = page.content.filter((e) => e.held_by_tier0 === false).map((e) => e.event_id);
    expect(held).toHaveLength(2);
    expect(stale).toHaveLength(3);
    expect(page.content.every((e) => e.lifecycle !== 'RESOLVED')).toBe(true);
  });

  it('들고 있던 이벤트를 닫으면 해소 전이에서 held_by_tier0 가 false 다(계약: true 는 해소 전만)', () => {
    const seed = seededEventsAt(NOW);
    const local = createEventsMock({ broker, now: () => NOW, seed });
    const target = seed.find((m) => m.payload.held_by_tier0)!;
    const closed = local.close(target.payload.event_id, { id: 'admin' });
    expect(closed?.payload.lifecycle).toBe('RESOLVED');
    expect(closed?.payload.held_by_tier0).toBe(false);
    expect(validateMessage('risk_event', closed).ok).toBe(true);
  });
});

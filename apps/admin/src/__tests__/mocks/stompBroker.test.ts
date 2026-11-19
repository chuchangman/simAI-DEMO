import { createStompBroker, parseFrame, serializeFrame } from '@/mocks/stompBroker';
import { Client } from '@stomp/stompjs';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const URL = 'ws://stomp.test/ws';
const broker = createStompBroker({ url: URL, authorize: (auth) => auth === 'Bearer ok' });
const server = setupServer(broker.handler);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.deactivate()));
});

function connect(authorization: string) {
  const client = new Client({
    brokerURL: URL,
    connectHeaders: { Authorization: authorization },
    reconnectDelay: 0,
  });
  clients.push(client);
  return client;
}

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('시간 안에 조건이 맞지 않았다');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('STOMP 프레임', () => {
  it('헤더 이스케이프를 왕복한다(CONNECT 는 이스케이프하지 않는다)', () => {
    const text = serializeFrame('SEND', { destination: '/a:b\nc' }, '{"x":1}');
    expect(parseFrame(text)).toEqual({
      command: 'SEND',
      headers: { destination: '/a:b\nc' },
      body: '{"x":1}',
    });
    expect(parseFrame('CONNECT\nAuthorization:Bearer a:b\n\n\0')?.headers.Authorization).toBe(
      'Bearer a:b',
    );
  });

  it('하트비트(빈 줄)는 프레임이 아니다', () => {
    expect(parseFrame('\n')).toBeNull();
    expect(parseFrame('\r\n\r\n')).toBeNull();
  });
});

describe('createStompBroker', () => {
  it('stompjs 클라이언트가 연결·구독하면 publish 한 본문을 받는다', async () => {
    const received: unknown[] = [];
    const client = connect('Bearer ok');
    client.onConnect = () => {
      client.subscribe('/topic/health', (m) => received.push(JSON.parse(m.body)));
    };
    client.activate();
    await until(() => broker.connections === 1);
    // SUBSCRIBE 가 브로커에 닿을 때까지 보낸다.
    await until(() => {
      broker.publish('/topic/health', { n: 1, text: '한글: 콜론' });
      return received.length > 0;
    });
    broker.publish('/topic/world', { other: true });

    expect(received[0]).toEqual({ n: 1, text: '한글: 콜론' });
    expect(received).not.toContainEqual({ other: true });
  });

  it('인증이 틀리면 ERROR 를 보내고 연결을 닫는다', async () => {
    const errors: string[] = [];
    const client = connect('Bearer bad');
    client.onStompError = (frame) => errors.push(frame.headers.message ?? '');
    client.activate();

    await until(() => errors.length > 0);
    expect(errors[0]).toBe('Unauthorized');
    expect(broker.connections).toBe(0);
  });

  it('dropAll 하면 끊기고, 클라이언트가 다시 연결한다', async () => {
    let connects = 0;
    const client = connect('Bearer ok');
    client.reconnectDelay = 20;
    client.onConnect = () => {
      connects += 1;
    };
    client.activate();
    await until(() => connects === 1);

    broker.dropAll();
    await until(() => connects === 2);
    expect(broker.connections).toBe(1);
  });

  it('rejectNextConnects: 다음 연결을 인증과 상관없이 ERROR 로 거절하고, 그다음은 받는다', async () => {
    broker.rejectNextConnects();
    const errors: string[] = [];
    let connects = 0;
    const client = connect('Bearer ok');
    client.reconnectDelay = 20;
    client.onStompError = (frame) => errors.push(frame.headers.message ?? '');
    client.onConnect = () => {
      connects += 1;
    };
    client.activate();

    await until(() => connects === 1);
    expect(errors).toEqual(['Unauthorized']);
    expect(broker.connections).toBe(1);
  });
});

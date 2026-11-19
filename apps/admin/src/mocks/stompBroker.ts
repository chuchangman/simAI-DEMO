import { ws } from 'msw';

// 개발 서버와 시험에서 서버 STOMP 대신 쓰는 작은 브로커(msw WebSocket 가로채기).
// CONNECT·SUBSCRIBE·UNSUBSCRIBE·DISCONNECT 만 받고, publish 로 구독자에게 MESSAGE 를 보낸다. 하트비트는 쓰지 않는다(heart-beat:0,0).

export interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

const STOMP_VERSION = '1.2';
const NO_HEART_BEAT = '0,0';
/** 연결을 닫는 코드. 1008: 정책 위반(거절), 1012: 서비스 재시작(연결 끊김 흉내). */
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_SERVICE_RESTART = 1012;

/** 헤더 값의 이스케이프(STOMP 1.2). 읽을 때는 거꾸로 푼다. */
const HEADER_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  ':': '\\c',
};
const HEADER_UNESCAPES = Object.fromEntries(
  Object.entries(HEADER_ESCAPES).map(([char, escaped]) => [escaped, char]),
);
const unescapeHeader = (value: string) =>
  value.replace(/\\[\\nrc]/g, (escaped) => HEADER_UNESCAPES[escaped] ?? escaped);
const escapeHeader = (value: string) =>
  value.replace(/[\\\n\r:]/g, (char) => HEADER_ESCAPES[char] ?? char);

/** 프레임 하나를 읽는다. 하트비트(빈 줄)만 왔으면 null. */
export function parseFrame(data: string): StompFrame | null {
  const text = data.replace(/^(\r?\n)+/, '');
  if (text === '') return null;
  const end = text.indexOf('\0');
  const raw = end >= 0 ? text.slice(0, end) : text;
  const blank = /\r?\n\r?\n/.exec(raw);
  const head = blank ? raw.slice(0, blank.index) : raw;
  const body = blank ? raw.slice(blank.index + blank[0].length) : '';
  const [command = '', ...lines] = head.split(/\r?\n/);
  // CONNECT·CONNECTED 헤더는 이스케이프하지 않는다(STOMP 1.2). 같은 헤더가 여럿이면 처음 것을 쓴다.
  const plain = command === 'CONNECT' || command === 'STOMP';
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    const value = line.slice(colon + 1);
    if (!(key in headers)) headers[key] = plain ? value : unescapeHeader(value);
  }
  return { command, headers, body };
}

export function serializeFrame(command: string, headers: Record<string, string>, body = '') {
  const plain = command === 'CONNECTED';
  const lines = Object.entries(headers).map(([k, v]) => `${k}:${plain ? v : escapeHeader(v)}`);
  return `${command}\n${lines.map((l) => `${l}\n`).join('')}\n${body}\0`;
}

interface Connection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** 구독 id → 경로 */
  subscriptions: Map<string, string>;
  connected: boolean;
}

export interface StompBrokerOptions {
  /** 가로챌 STOMP 주소(VITE_STOMP_URL). */
  url: string;
  /** CONNECT 의 Authorization 헤더를 받는다. false 면 ERROR 를 보내고 닫는다. */
  authorize?: (authorization: string | undefined) => boolean;
}

export interface StompBroker {
  /** msw 에 넘길 핸들러. */
  handler: ReturnType<ReturnType<typeof ws.link>['addEventListener']>;
  /** 경로를 구독한 연결 모두에 JSON 본문을 보낸다. */
  publish(destination: string, body: unknown): void;
  /** 본문 문자열을 그대로 보낸다(JSON 이 아닌 본문 시험용). */
  publishText(destination: string, text: string): void;
  /** 연결을 모두 끊는다(서버 재시작·네트워크 단절 흉내). 클라이언트는 다시 연결한다. */
  dropAll(): void;
  /**
   * 다음 CONNECT count 번을 인증과 상관없이 ERROR 로 거절한다(토큰 만료 흉내). 클라이언트가 토큰을 갱신해 다시 붙는지 본다.
   * dropAll 과 함께 부르면 그 재연결부터 거절한다.
   */
  rejectNextConnects(count?: number): void;
  /** CONNECTED 까지 마친 연결 수. */
  readonly connections: number;
}

export function createStompBroker({
  url,
  authorize = () => true,
}: StompBrokerOptions): StompBroker {
  const link = ws.link(url);
  const connections = new Set<Connection>();
  let messageId = 0;
  let rejectConnects = 0;

  // 서버는 ERROR 프레임을 보낸 뒤 연결을 닫는다. 바로 닫으면 msw 가 아직 보내지 않은 ERROR 를 버리므로 한 틱 뒤에 닫는다.
  const reject = (connection: Connection, message: string) => {
    connection.send(serializeFrame('ERROR', { message }));
    setTimeout(() => connection.close(CLOSE_POLICY_VIOLATION, message), 0);
  };

  function onConnect(connection: Connection, frame: StompFrame) {
    const authorized = authorize(frame.headers.Authorization ?? frame.headers.authorization);
    if (rejectConnects > 0 || !authorized) {
      if (rejectConnects > 0) rejectConnects -= 1;
      return reject(connection, 'Unauthorized');
    }
    connection.connected = true;
    connection.send(
      serializeFrame('CONNECTED', { version: STOMP_VERSION, 'heart-beat': NO_HEART_BEAT }),
    );
  }

  function onSubscribe(connection: Connection, { headers }: StompFrame) {
    const { id, destination } = headers;
    if (!id || !destination) return;
    connection.subscriptions.set(id, destination);
  }

  function onDisconnect(connection: Connection, { headers }: StompFrame) {
    if (headers.receipt) {
      connection.send(serializeFrame('RECEIPT', { 'receipt-id': headers.receipt }));
    }
    connection.close();
  }

  function onFrame(connection: Connection, frame: StompFrame) {
    switch (frame.command) {
      case 'CONNECT':
      case 'STOMP':
        return onConnect(connection, frame);
      case 'SUBSCRIBE':
        return onSubscribe(connection, frame);
      case 'UNSUBSCRIBE':
        if (frame.headers.id) connection.subscriptions.delete(frame.headers.id);
        return;
      case 'DISCONNECT':
        return onDisconnect(connection, frame);
    }
  }

  const handler = link.addEventListener('connection', ({ client }) => {
    const connection: Connection = {
      send: (data) => client.send(data),
      close: (code, reason) => client.close(code, reason),
      subscriptions: new Map(),
      connected: false,
    };
    connections.add(connection);
    client.addEventListener('close', () => connections.delete(connection));
    client.addEventListener('message', (event) => {
      const frame = typeof event.data === 'string' ? parseFrame(event.data) : null;
      if (frame) onFrame(connection, frame);
    });
  });

  const messageFrame = (destination: string, subscription: string, text: string) =>
    serializeFrame(
      'MESSAGE',
      {
        destination,
        subscription,
        'message-id': String(++messageId),
        'content-type': 'application/json',
      },
      text,
    );

  function publishText(destination: string, text: string) {
    for (const connection of connections) {
      if (!connection.connected) continue;
      for (const [id, path] of connection.subscriptions) {
        if (path === destination) connection.send(messageFrame(destination, id, text));
      }
    }
  }

  return {
    handler,
    publish: (destination, body) => publishText(destination, JSON.stringify(body)),
    publishText,
    dropAll() {
      for (const connection of connections) {
        connection.close(CLOSE_SERVICE_RESTART, 'mock drop');
      }
    },
    rejectNextConnects(count = 1) {
      rejectConnects = count;
    },
    get connections() {
      return [...connections].filter((c) => c.connected).length;
    },
  };
}

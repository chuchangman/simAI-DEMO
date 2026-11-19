import type {
  ExternalSpatialSource,
  SourceConnection,
  SpatialSourceSink,
} from '@/features/viewer3d';
import {
  HEALTH_TIMEOUT_MS,
  isLinkAlive,
  type RealtimeState,
  type RealtimeStore,
} from '@/store/realtime.store';
import {
  validateMessage,
  type RiskEventPayload,
  type WatchEscalationPayload,
} from '@simai/contracts';
import { Client, ReconnectionTimeMode, type IMessage } from '@stomp/stompjs';

/** 토픽 이름(명세 12.4, 14장). mock 도 같은 값을 쓴다. */
export const WORLD_TOPIC = '/topic/world';
export const HEALTH_TOPIC = '/topic/health';
export const EVENTS_TOPIC = '/topic/events';
export const AVATAR_TOPIC = '/topic/avatar';
/** 워치 진동 알림 격상(watch_escalation, 확장 부록 C.6, S15P31A101-338·-342). 3D 뷰어 입력이 아니다. */
export const WATCH_TOPIC = '/topic/watch';
/** 사람별 안전모·조끼 화면용 현재 상태(ppe_view, 명세 12.4·13.3, S15P31A101-531). 3D 뷰어 Source 입력이 아니다. */
export const PPE_TOPIC = '/topic/ppe';
/** 로그인한 계정이면 누구나 구독하는 토픽. */
export const TOPICS = [
  WORLD_TOPIC,
  HEALTH_TOPIC,
  EVENTS_TOPIC,
  AVATAR_TOPIC,
  WATCH_TOPIC,
  PPE_TOPIC,
] as const;
/** 3D 뷰어(Source)에 넘기지 않는 토픽. 뷰어 계약 입력(world_state·risk_event·viewer_health·avatar_frame)이 아니다. */
const APP_ONLY_TOPICS: ReadonlySet<string> = new Set([WATCH_TOPIC, PPE_TOPIC]);

/** 연결에서 화면 쪽으로 알리는 일. 화면 데이터(Query 캐시 등)는 받는 쪽이 정한다. */
export interface RealtimeListeners {
  /** /topic/events 로 받아 계약 검사를 통과한 risk_event. */
  riskEvent: (event: RiskEventPayload, receivedAt: number) => void;
  /** 연결이 열릴 때마다(처음·재연결). 끊긴 사이 놓친 상태를 다시 받는 데 쓴다. */
  open: () => void;
  /** /topic/watch 로 받아 계약 검사를 통과한 watch_escalation(진동 뒤 확인 없음·보내지 못함). */
  watchEscalation: (escalation: WatchEscalationPayload, receivedAt: number) => void;
}

/** STOMP 하트비트 주기(ms). 들어오는 쪽·나가는 쪽이 같다. */
const HEARTBEAT_MS = 10_000;
/** 끊긴 뒤 첫 재연결까지 기본으로 기다리는 시간(ms). */
const DEFAULT_RECONNECT_DELAY_MS = 1000;
/** 재연결 간격의 상한(ms). */
const MAX_RECONNECT_DELAY_MS = 30_000;
/** health 가 끊겼는지 다시 보는 기본 간격(ms). */
const DEFAULT_WATCH_INTERVAL_MS = 500;
/** 이만큼(ms) 이어진 연결이 끝나면 한때의 문제로 보고, 그보다 짧으면 같은 문제가 되풀이되는 것으로 본다. */
const STABLE_CONNECTION_MS = 10_000;

export interface RealtimeSession {
  userId: string;
  /**
   * 연결·재연결할 때마다 읽는다. 갱신으로 토큰이 바뀌어도 연결을 다시 열지 않고 다음 재연결에 새 토큰을 싣는다.
   * Promise 면 기다린다(만료가 가까우면 먼저 갱신한다, authSession.freshToken).
   */
  getToken: () => string | undefined | Promise<string | undefined>;
  /**
   * 서버가 연결을 ERROR 프레임으로 거절하면(토큰 만료·거부) 다음 재연결 전에 부른다. 거절된 토큰을 받아 갱신하고
   * 새 토큰을 돌려준다(앱은 authSession.refresh). 못 받으면 undefined 다. 갱신 쿠키가 거부돼 세션이 끝났으면
   * authSession 이 이미 로그아웃시켜 bindSession 이 연결을 끝내므로 다시 붙지 않는다. 이 파일이 REST 를 읽지 않게 주입한다.
   * 같은 토큰으로는 한 번만 갱신한다(갱신한 토큰도 거절되면 토큰 문제가 아니다). 이후는 재연결 간격(지수 증가)으로만 다시 붙는다.
   * 없으면 갱신하지 않는다(다음 재연결이 getToken 이 주는 토큰으로 붙는다).
   */
  refreshToken?: (rejectedToken: string) => Promise<string | undefined>;
}

export interface Realtime {
  /** 사용자의 토큰으로 연결한다. 이전 연결이 있으면 끊고 데이터를 비운 뒤 새로 연결한다. */
  start(session: RealtimeSession): void;
  /** 연결을 끊고 받은 데이터를 비운다. 끊김이 끝나면 풀린다. */
  stop(): Promise<void>;
  /** 알림을 받는다. 해제 함수를 돌려준다. */
  on<K extends keyof RealtimeListeners>(type: K, listener: RealtimeListeners[K]): () => void;
}

export type SourceFactory = (id: string, now: () => number) => ExternalSpatialSource;

// viewer3d 입구는 Viewer3D(three.js)도 내보낸다. 정적으로 import 하면 로그인 화면 번들에 3D 코드가 들어가므로
// 연결과 따로 불러온다. 3D 코드를 받지 못해도 연결·경보·world 는 계속 받는다(2D 비상 화면, 명세 13.6).
const loadViewerSource = () =>
  import('@/features/viewer3d').then((viewer): SourceFactory => viewer.createExternalSource);

export interface RealtimeOptions {
  url: string;
  store: RealtimeStore;
  /** 뷰어 입력(Source)을 만드는 함수를 불러온다. 시험에서 바꿔 넣을 수 있다. */
  loadSourceFactory?: () => Promise<SourceFactory>;
  now?: () => number;
  healthTimeoutMs?: number;
  /** 끊긴 뒤 첫 재연결까지 기다리는 시간(ms). 실패할 때마다 두 배로 늘려 최대 30초까지 기다린다. */
  reconnectDelayMs?: number;
  /** health 가 끊겼는지 다시 보는 간격(ms). */
  watchIntervalMs?: number;
  /** 3D 뷰어에 넘기지 않을 본문(로그인한 계정별). 앱 화면 처리(이벤트 목록 등)는 그대로 받는다. */
  hideFromViewer?: (topic: string, raw: unknown, userId: string) => boolean;
}

interface ViewerLink {
  state: SourceConnection;
  reason?: string;
}

interface Received {
  raw: unknown;
  receivedAt: number;
}

interface ReceivedEvent extends Received {
  sequence: number | undefined;
  resolved: boolean;
}

/** 다시 넘길 이벤트 수. 넘치면 해소된 이벤트부터, 없으면 가장 오래 소식이 없던 이벤트부터 뺀다. */
const MAX_REPLAY_EVENTS = 200;

/** 3D 뷰어가 구독하는 순간 넘길 가장 새 메시지들. */
interface Replay {
  world: Received | null;
  health: Received | null;
  events: Map<string, ReceivedEvent>;
}

interface Connection {
  client: Client;
  /** 3D 뷰어 입력. 뷰어 코드를 받기 전에는 없다. */
  source: ExternalSpatialSource | null;
  /**
   * 계약을 통과한 가장 새 world·health 와 이벤트별 가장 새 risk_event. Source 는 구독 전 메시지를 남기지 않으므로,
   * 3D 뷰어가 구독하는 순간(코드를 늦게 받았거나 3D 를 다시 띄움) 그 뷰어에 넘겨 진행 중 경보를 놓치지 않게 한다.
   */
  replay: Replay;
  /** 3D 뷰어에 넘기지 않을 본문인가. */
  hidden: (topic: string, raw: unknown) => boolean;
  /** 뷰어에 연결 상태를 알리는 구독·타이머를 푼다. */
  dispose: () => void;
}

type Emit = <K extends keyof RealtimeListeners>(
  type: K,
  ...args: Parameters<RealtimeListeners[K]>
) => void;

// 다른 쪽(화면·3D 뷰어)의 오류는 따로 던져 콘솔에 남기고 연결 처리는 이어 간다. 3D 가 고장 나도 2D·경보는 계속 받는다.
const safely = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
};

/** 재연결 간격: 실패한 횟수만큼 두 배로 늘리되 상한을 넘기지 않는다. */
const backoffDelay = (baseMs: number, failures: number) =>
  Math.min(baseMs * 2 ** failures, MAX_RECONNECT_DELAY_MS);

function rememberEvent(
  events: Map<string, ReceivedEvent>,
  event: RiskEventPayload,
  received: Received,
) {
  const prev = events.get(event.event_id);
  // 늦게 온 이전 상태로 덮지 않는다. 같은 순번이면 확인 기록이 늘었을 수 있어 새것으로 본다.
  if (prev?.sequence !== undefined && (event.event_sequence ?? 0) < prev.sequence) return;
  events.delete(event.event_id);
  events.set(event.event_id, {
    ...received,
    sequence: event.event_sequence,
    resolved: event.lifecycle === 'RESOLVED',
  });
  if (events.size <= MAX_REPLAY_EVENTS) return;
  // 진행 중 경보는 소식이 오래 없어도 남긴다.
  const resolved = [...events].find(([, e]) => e.resolved)?.[0];
  events.delete(resolved ?? events.keys().next().value!);
}

/** 구독하는 순간 그 뷰어에 가장 새 world·health·이벤트를 넘기는 Source. 3D 뷰어 코드는 그대로 두고 감싼다. */
function withReplay(connection: Connection, source: ExternalSpatialSource): ExternalSpatialSource {
  const subscribe = (sink: SpatialSourceSink) => {
    const unsubscribe = source.subscribe(sink);
    const { world, health, events } = connection.replay;
    const shown = [...events.values()].filter((item) => !connection.hidden(EVENTS_TOPIC, item.raw));
    for (const item of [world, health, ...shown]) {
      if (item) safely(() => sink.onMessage(item.raw, item.receivedAt));
    }
    return unsubscribe;
  };
  return Object.create(source, { subscribe: { value: subscribe } }) as ExternalSpatialSource;
}

/** 뷰어에 알릴 연결 상태. STOMP 가 열려 있어도 health 가 끊기면 끊긴 것으로 알린다. */
function viewerLink(state: RealtimeState, now: number, timeoutMs: number): ViewerLink {
  if (state.phase === 'OPEN') {
    return isLinkAlive(state, now, timeoutMs)
      ? { state: 'OPEN' }
      : { state: 'CLOSED', reason: '상태 메시지 끊김' };
  }
  if (state.phase === 'CLOSED') return { state: 'CLOSED', reason: '연결 끊김' };
  return { state: 'CONNECTING' };
}

/** 알림을 받는 쪽 목록. 받는 쪽 하나가 실패해도 나머지는 받고 연결 처리도 이어 간다. */
function createListenerRegistry() {
  const listeners: { [K in keyof RealtimeListeners]: Set<RealtimeListeners[K]> } = {
    riskEvent: new Set(),
    open: new Set(),
    watchEscalation: new Set(),
  };

  function on<K extends keyof RealtimeListeners>(type: K, listener: RealtimeListeners[K]) {
    listeners[type].add(listener);
    return () => {
      listeners[type].delete(listener);
    };
  }

  const emit: Emit = (type, ...args) => {
    for (const listener of listeners[type]) {
      safely(() => (listener as (...a: typeof args) => void)(...args));
    }
  };

  return { on, emit };
}

interface RouteContext {
  store: RealtimeStore;
  replay: Replay;
  emit: Emit;
}

type TopicHandler = (received: Received, context: RouteContext) => void;

/** 앱이 쓰는 토픽별 처리: 메시지를 계약으로 검사해 저장소·이벤트 캐시에 넘긴다. 계약에 맞지 않으면 개수만 센다. */
const TOPIC_HANDLERS = new Map<string, TopicHandler>([
  [
    AVATAR_TOPIC,
    ({ raw }, { store }) => {
      const avatar = validateMessage('avatar_frame', raw);
      // 포즈는 실시간 표시용이다. 이전 포즈를 재생하지 않고 다음 갱신을 기다린다(0.5 s 캡슐 폴백).
      if (!avatar.ok) store.getState().reject();
    },
  ],
  [
    WORLD_TOPIC,
    (received, { store, replay }) => {
      // 2D 비상 화면은 3D 뷰어 없이 그리므로 앱도 검사해 최신 프레임을 둔다.
      const world = validateMessage('world_state', received.raw);
      if (!world.ok) return store.getState().reject();
      store
        .getState()
        .receiveWorld({ payload: world.message.payload, receivedAt: received.receivedAt });
      // 저장소가 받은(더 새) 프레임만 다시 넘길 것으로 둔다. 늦게 온 이전 프레임은 두지 않는다.
      if (store.getState().world?.payload === world.message.payload) replay.world = received;
    },
  ],
  [
    EVENTS_TOPIC,
    (received, { store, replay, emit }) => {
      // 이벤트 목록·경보는 앱 화면이 따로 쓰므로 앱도 검사한다.
      const event = validateMessage('risk_event', received.raw);
      if (!event.ok) return store.getState().reject();
      rememberEvent(replay.events, event.message.payload, received);
      emit('riskEvent', event.message.payload, received.receivedAt);
    },
  ],
  [
    WATCH_TOPIC,
    (received, { store, emit }) => {
      // 격상은 그때 한 번 알리는 것이다. 재연결 때 다시 보내지 않는다(놓친 격상은 서버 기록에 남는다).
      const escalation = validateMessage('watch_escalation', received.raw);
      if (!escalation.ok) return store.getState().reject();
      emit('watchEscalation', escalation.message.payload, received.receivedAt);
    },
  ],
  [
    PPE_TOPIC,
    (received, { store }) => {
      // 스냅샷이다. 재연결 때 놓친 것은 처음 상태 REST(usePpeSnapshot)가 채운다.
      const ppe = validateMessage('ppe_view', received.raw);
      if (!ppe.ok) return store.getState().reject();
      store
        .getState()
        .receivePpe({ payload: ppe.message.payload, receivedAt: received.receivedAt });
    },
  ],
  [
    HEALTH_TOPIC,
    (received, { store, replay }) => {
      const checked = validateMessage('viewer_health', received.raw);
      if (!checked.ok) return store.getState().reject();
      store.getState().receiveHealth({
        payload: checked.message.payload,
        receivedAt: received.receivedAt,
        clockOffsetMs: checked.message.sent_at - received.receivedAt,
      });
      replay.health = received;
    },
  ],
]);

/**
 * 연결 시도마다 실을 토큰을 정한다. 서버가 ERROR 로 거절한 토큰은 한 번만 갱신한다(갱신한 토큰도 거절되면 토큰 문제가 아니다).
 * 갱신은 한 번에 하나만 하고, 실패(예외)는 못 받은 것으로 본다.
 */
function createTokenFeed(
  getToken: RealtimeSession['getToken'],
  refreshToken: RealtimeSession['refreshToken'],
) {
  // 이번 시도에 실은 토큰.
  let used: string | undefined;
  // 직전 시도가 ERROR 프레임으로 거절됐으면 그때 실은 토큰. 다음 시도 전에 그 토큰을 갱신한다.
  let rejected: string | undefined;
  // ERROR 뒤 갱신으로 받은 토큰. 이 토큰도 거절되면 다시 갱신하지 않는다.
  let renewed: string | undefined;
  let refreshing: Promise<string | undefined> | undefined;

  const renew = (token: string) =>
    (refreshing ??= Promise.resolve()
      .then(() => refreshToken?.(token))
      .catch(() => undefined)
      .finally(() => {
        refreshing = undefined;
      }));

  return {
    /** 이번 시도에 실을 토큰. 재연결마다 가장 새 토큰을 읽는다. */
    async next() {
      // 실패해도 헤더 없이 붙어 거절당하고 다음 재연결에서 다시 받는다.
      let token = await Promise.resolve(getToken()).catch(() => undefined);
      const previous = rejected;
      rejected = undefined;
      // 직전 시도가 ERROR 로 거절됐는데 getToken 이 같은 토큰을 주면 갱신한다. 이미 새 토큰을 줬으면 그대로 쓴다.
      if (previous !== undefined && token === previous && previous !== renewed) {
        const fresh = await renew(previous);
        // 기다리는 사이 세션이 끝났으면(갱신 쿠키 거부 → 로그아웃) 이 연결은 이미 stop 됐고 stompjs 는
        // deactivate 된 client 를 연결하지 않는다. 서버가 일시적으로 실패한 것이면 세션은 그대로라 지금 토큰으로 붙어 보고,
        // 또 거절되면 재연결 간격(지수 증가)만큼 기다린 뒤 다시 갱신한다.
        if (fresh) {
          token = fresh;
          renewed = fresh;
        }
      }
      used = token;
      return token;
    },
    /** 이번 시도가 ERROR 로 거절됐다. 다음 시도 전에 이 토큰을 갱신한다. */
    rejectUsed() {
      rejected = used;
    },
    /** 오래 이어진 연결이 끝났다. 그다음 거절은 새 일이라 다시 갱신한다. */
    forgetRenewal() {
      renewed = undefined;
    },
  };
}

/**
 * 연결이 열린 직후 ERROR(구독 거부 등)가 되풀이되면 stompjs 는 연결이 될 때마다 재연결 간격을 처음으로 되돌려 계속 붙는다.
 * 그래서 오래 못 이어진 거절이 이어진 횟수만큼 기본 간격을 직접 늘린다.
 */
function createReconnectBackoff(baseMs: number, now: () => number) {
  // 이번 시도가 CONNECTED 를 받은 시각.
  let connectedAt: number | undefined;
  let shortFailures = 0;
  const stable = () => connectedAt !== undefined && now() - connectedAt >= STABLE_CONNECTION_MS;

  return {
    /** 새 연결 시도를 시작한다. */
    attempt() {
      connectedAt = undefined;
    },
    connected() {
      connectedAt = now();
    },
    /** ERROR 로 거절됐다. 연결이 열린 뒤였으면 다음 재연결 간격(ms)을, 아니면 undefined(간격 그대로)를 돌려준다. */
    rejected(): number | undefined {
      if (connectedAt === undefined) return undefined;
      shortFailures = stable() ? 0 : shortFailures + 1;
      return backoffDelay(baseMs, shortFailures);
    },
    /** 소켓이 닫혔다. 오래 이어진 연결이었으면 간격을 처음부터 세도록 true. */
    closed(): boolean {
      if (!stable()) return false;
      shortFailures = 0;
      return true;
    },
  };
}

// 화면은 연결을 직접 다루지 않는다. 로그인·로그아웃에 맞춰 bindSession 이 start·stop 을 부른다.
export function createRealtime({
  url,
  store,
  loadSourceFactory = loadViewerSource,
  now = Date.now,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  watchIntervalMs = DEFAULT_WATCH_INTERVAL_MS,
  hideFromViewer = () => false,
}: RealtimeOptions): Realtime {
  let current: Connection | null = null;
  // start·stop 마다 올린다. Source 이름에 붙여 세션마다 다른 스트림으로 보이게 한다.
  let generation = 0;
  const { on, emit } = createListenerRegistry();

  function stop() {
    generation += 1;
    if (!current) {
      if (store.getState().phase !== 'IDLE') store.getState().reset();
      return Promise.resolve();
    }
    const { client, source, dispose } = current;
    current = null;
    dispose();
    if (source) safely(() => source.setConnection('CLOSED', '연결 종료'));
    store.getState().reset();
    // 이미 끊긴 소켓을 정리하다 실패해도 새 연결에는 영향이 없다.
    return client.deactivate().catch(() => undefined);
  }

  function start(session: RealtimeSession) {
    void stop();
    const ticket = generation;
    store.getState().begin();
    loadSource(connect(session), `live:${session.userId}:${ticket}`);
  }

  /** 뷰어 코드를 받아 Source 를 붙인다. 못 받으면 재연결과 같은 간격으로 다시 받는다(그동안에도 연결은 쓴다). */
  function loadSource(connection: Connection, sourceName: string, attempt = 0) {
    loadSourceFactory()
      .then((createSource) => {
        if (current === connection) attachSource(connection, createSource(sourceName, now));
      })
      .catch((error: unknown) => {
        // 뷰어 코드를 받지 못했거나(일시적 네트워크 오류) Source 를 만들지 못했다. 그동안에도 연결은 쓴다(2D 평면·경보).
        if (current !== connection || connection.source) return;
        console.warn('3D 뷰어 코드를 불러오지 못해 다시 시도한다', error);
        setTimeout(
          () => {
            if (current === connection) loadSource(connection, sourceName, attempt + 1);
          },
          backoffDelay(reconnectDelayMs, attempt),
        );
      });
  }

  /**
   * 뷰어 입력을 붙인다. 붙인 뒤로 받은 본문을 넘기고, 연결 단계가 바뀌거나 health 가 끊기면 알린다.
   * 화면에는 구독하는 순간 가장 새 메시지를 받는 Source 를 준다(withReplay).
   */
  function attachSource(connection: Connection, source: ExternalSpatialSource) {
    // 같은 상태는 다시 알리지 않는다.
    let last: ViewerLink | null = null;
    const sync = () => {
      const next = viewerLink(store.getState(), now(), healthTimeoutMs);
      if (last?.state === next.state && last.reason === next.reason) return;
      last = next;
      safely(() => source.setConnection(next.state, next.reason));
    };
    const unsubscribe = store.subscribe(sync);
    const timer = setInterval(sync, watchIntervalMs);
    connection.dispose = () => {
      unsubscribe();
      clearInterval(timer);
    };
    sync();
    // 준비가 끝난 뒤에 붙인다. 앞에서 실패하면 Source 가 없는 것으로 보고 다시 시도한다.
    connection.source = source;
    store.getState().setSource(withReplay(connection, source));
  }

  function connect({ userId, getToken, refreshToken }: RealtimeSession): Connection {
    // 끊은 뒤 늦게 도착한 콜백은 버린다.
    const isCurrent = () => current === connection;
    const tokens = createTokenFeed(getToken, refreshToken);
    const backoff = createReconnectBackoff(reconnectDelayMs, now);
    const replay: Replay = { world: null, health: null, events: new Map() };
    const route: RouteContext = { store, replay, emit };

    const receive = (topic: string) => (message: IMessage) => {
      if (!isCurrent()) return;
      const receivedAt = now();
      let raw: unknown;
      try {
        raw = JSON.parse(message.body);
      } catch {
        store.getState().reject();
        return;
      }
      try {
        TOPIC_HANDLERS.get(topic)?.({ raw, receivedAt }, route);
      } finally {
        // 3D 뷰어는 받은 본문을 직접 계약으로 검사하고 순서를 정리한다(viewer3d 의 Source 입력).
        // 앱 처리 뒤에 넘기고 실패를 가둔다. 3D 가 고장 나도 2D 평면·경보는 계속 받는다.
        const { source } = connection;
        if (source && !APP_ONLY_TOPICS.has(topic) && !connection.hidden(topic, raw)) {
          safely(() => source.push(raw, receivedAt));
        }
      }
    };

    const client = new Client({
      brokerURL: url,
      heartbeatIncoming: HEARTBEAT_MS,
      heartbeatOutgoing: HEARTBEAT_MS,
      reconnectDelay: reconnectDelayMs,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
      // stompjs 는 이 함수가 끝난 뒤 connectHeaders 를 읽는다. 재연결마다 가장 새 토큰을 싣는다.
      beforeConnect: async (self) => {
        if (isCurrent()) store.getState().setPhase('CONNECTING');
        const token = await tokens.next();
        backoff.attempt();
        self.connectHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      },
      onConnect: () => {
        if (!isCurrent()) return;
        backoff.connected();
        store.getState().opened(now());
        for (const topic of TOPICS) client.subscribe(topic, receive(topic));
        emit('open');
      },
      // 서버는 인증 실패·권한 없는 구독에 ERROR 프레임을 보내고 소켓을 닫는다. 닫히지 않아도 단계가 멈추지 않게
      // 직접 닫는다. 닫히면 stompjs 가 재연결 간격(지수 증가)을 두고 beforeConnect 부터 다시 한다.
      onStompError: () => {
        if (!isCurrent()) return;
        tokens.rejectUsed();
        const delay = backoff.rejected();
        if (delay !== undefined) client.reconnectDelay = delay;
        store.getState().setPhase('CLOSED');
        client.forceDisconnect();
      },
      onWebSocketClose: () => {
        if (!isCurrent()) return;
        // 오래 이어진 연결이 끝났다. 이후 거절은 새 일이라 다시 갱신하고 간격도 처음부터 센다.
        if (backoff.closed()) {
          tokens.forgetRenewal();
          client.reconnectDelay = reconnectDelayMs;
        }
        store.getState().setPhase('CLOSED');
      },
    });

    const connection: Connection = {
      client,
      source: null,
      replay,
      hidden: (topic, raw) => hideFromViewer(topic, raw, userId),
      dispose: () => undefined,
    };
    current = connection;
    client.activate();
    return connection;
  }

  return { start, stop, on };
}

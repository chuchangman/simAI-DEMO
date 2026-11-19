// Mock·Live·재생 공통 입력 경계. Viewer 는 메시지를 어디서 받는지 모르고 이 인터페이스만 본다.
// 실제 STOMP 연결·인증·토픽 구독은 FE(src/lib/stomp.ts 예정)나 BE 연동이 소유한다. Spatial 은 받은 본문만 넘겨받는다.

export const SOURCE_CONNECTIONS = ['CONNECTING', 'OPEN', 'CLOSED', 'ERROR'] as const;
export type SourceConnection = (typeof SOURCE_CONNECTIONS)[number];

export interface SourceConnectionChange {
  state: SourceConnection;
  /** 이 브라우저 시계 기준 시각(ms). */
  at: number;
  reason?: string;
}

/**
 * 구역 조회 결과. 본문은 검증 전 값이다. BE GET /api/zones 응답 배열(-120)을 그대로 넘기거나,
 * 전환 기간에는 기존 DEMO 상자 묶음({ contract: 'DEMO_UNCONFIRMED', zones })을 넘긴다.
 */
export type ZonesResult = { ok: true; raw: unknown } | { ok: false; reason: string };

/**
 * 작업면·정적 객체 조회 결과(S15P31A101-188·-274). 본문은 검증 전 값이다.
 * BE GET /api/static-objects 응답 배열(-58, WORK_SURFACE·OBSTACLE 모두)을 그대로 넘기거나,
 * 구성 묶음 모양({ version?, work_surfaces?, static_objects? })을 넘긴다. Spatial 은 받은 본문만 검사해 그린다.
 */
export type WorkSurfacesResult = { ok: true; raw: unknown } | { ok: false; reason: string };

/** Source 가 마지막 값을 보관하는 형상 채널. World·Health·이벤트(STOMP)는 보관하지 않는다. */
export const SOURCE_SNAPSHOT_CHANNELS = ['zones', 'workSurfaces'] as const;
export type SourceSnapshotChannel = (typeof SOURCE_SNAPSHOT_CHANNELS)[number];

/**
 * 형상 조회 응답을 넘길 때 늦은 응답을 거르는 선택 정보. 없으면 예전처럼 받는다(단, setScope 로 범위를 정한 뒤에는 scope 가 필요하다).
 * 거르기를 쓰려면 한 채널에서 늘 같이 넘긴다(요청 시각 없는 응답은 비교하지 않는다).
 */
export interface SnapshotPushOptions {
  /**
   * 이 응답을 요청한 시각(ms, now 와 같은 시계). 더 늦게 요청한 응답을 이미 받았거나,
   * 그 채널을 clearSnapshot·setScope 로 비운 시각보다 앞서 요청한 응답이면 버린다.
   */
  requestedAt?: number;
  /**
   * 응답이 속한 범위(FE 가 정하는 사용자·세션·Scene 키 등). 지금 범위(setScope)와 다르면 버린다.
   * 범위를 정한 Source 에 scope 없이 넘기면 어느 범위의 응답인지 몰라 버린다.
   */
  scope?: string;
}

/** ACCEPTED 보관·전달함 · STALE_REQUEST 더 새 요청의 응답이 있거나 비운 뒤라 낡음 · SCOPE_MISMATCH 지금 범위가 아님. */
export type SnapshotPushOutcome = 'ACCEPTED' | 'STALE_REQUEST' | 'SCOPE_MISMATCH';

/** 보관 중인 형상 응답의 요약(진단용). 본문은 싣지 않는다. 새로 구독하는 쪽은 이 마지막 응답을 받는다. */
export interface SourceSnapshotInfo {
  /** 마지막으로 받은 응답이 정상인지. false 면 받는 쪽은 REJECTED(형상 없음)다. */
  ok: boolean;
  receivedAt: number;
  requestedAt: number | null;
  scope: string | null;
  /** 마지막 정상 응답을 받은 시각. 그 뒤 실패가 왔으면 receivedAt 과 다르다. 정상 응답이 없었으면 null. */
  lastOkReceivedAt: number | null;
}

export interface SpatialSourceSink {
  /**
   * 검증 전 메시지 하나(STOMP 본문을 JSON.parse 한 값 등). 계약 검사는 받는 쪽이 한다.
   * receivedAt 은 이 브라우저 시계 기준 수신 시각(ms)이다.
   */
  onMessage(raw: unknown, receivedAt: number): void;
  onConnectionChange(change: SourceConnectionChange): void;
  onZones?(result: ZonesResult, receivedAt: number): void;
  onWorkSurfaces?(result: WorkSurfacesResult, receivedAt: number): void;
  /** 보관하던 형상 채널을 버렸다(clearSnapshot·setScope). 받는 쪽은 그 채널만 비운다. */
  onSnapshotClear?(channel: SourceSnapshotChannel): void;
  /**
   * 지금까지 보낸 것을 버리고 처음부터 다시 보낸다는 알림(재생 되감기, -187). 받는 쪽은 받은 데이터를 비우고 같은 Source 를 이어 받는다.
   * Store 는 이미 받은 것보다 오래된 World 를 거부하므로, 시각을 뒤로 돌리는 Source 는 다시 보내기 전에 이것을 부른다.
   */
  onReset?(): void;
}

export interface SpatialSource {
  /** 같은 id 면 같은 스트림으로 보고 다시 구독해도 데이터를 비우지 않는다. 바뀌면 받은 데이터를 비운다. */
  readonly id: string;
  /** REPLAY 는 녹화 기록 재생(-187)이다. 이벤트는 기록의 출처(REPLAY)로만 들어가고 LIVE 로 바꾸지 않는다. */
  readonly kind: 'MOCK' | 'EXTERNAL' | 'REPLAY';
  /**
   * 구독을 시작하고 해제 함수를 돌려준다. 여러 번 구독할 수 있어야 한다(React StrictMode 는 효과를 두 번 돌린다).
   * 구독하자마자 지금 연결 상태를 한 번 알린다.
   */
  subscribe(sink: SpatialSourceSink): () => void;
}

/**
 * FE·BE 연동 쪽이 받은 메시지를 밀어 넣는 Source. 연결을 직접 맺지 않는다.
 * 구역·작업면/정적 객체는 채널마다 마지막으로 받은 응답을 보관하고 새로 구독하는 쪽에 다시 보낸다
 * (구독 전에 도착한 응답·Viewer 재마운트·StrictMode 재구독). 새 구독자는 지금 구독 중인 쪽과 같은 상태가 된다
 * (마지막이 실패면 실패를 받는다. 실패 뒤에도 형상을 계속 보일지는 FE 가 실패를 넘길지로 정한다). World·Health·이벤트는 보관하지 않는다
 * (STOMP 쪽 최신 값 재생은 FE lib/stomp 가 한다). 사용자·세션이 바뀌면 FE 가 새 Source 를 만들거나 clearSnapshot 한다.
 */
export interface ExternalSpatialSource extends SpatialSource {
  readonly kind: 'EXTERNAL';
  /** 지금 구독 중인 수. 누수 확인용이다. */
  readonly subscriberCount: number;
  /** 지금 범위. setScope 로 정한다. 없으면 null. */
  readonly scope: string | null;
  push(raw: unknown, receivedAt?: number): void;
  /** 구역 응답을 보관하고 구독 중인 쪽에 넘긴다. options 로 늦은 응답을 거른다. */
  pushZones(
    result: ZonesResult,
    receivedAt?: number,
    options?: SnapshotPushOptions,
  ): SnapshotPushOutcome;
  /** 작업면·정적 객체 응답을 보관하고 넘긴다(선택). 넘기지 않으면 작업면·정적 객체를 그리지 않는다. */
  pushWorkSurfaces(
    result: WorkSurfacesResult,
    receivedAt?: number,
    options?: SnapshotPushOptions,
  ): SnapshotPushOutcome;
  /** 보관한 형상을 버리고 구독 중인 쪽도 비우게 한다. channel 이 없으면 두 채널 모두다. */
  clearSnapshot(channel?: SourceSnapshotChannel): void;
  /**
   * 범위를 바꾼다. 바뀌면 보관한 형상을 모두 버린다(다른 사용자·Scene 의 형상을 남기지 않는다).
   * 이후 다른 scope 를 단 응답은 받지 않는다. 같은 값이면 아무것도 하지 않는다.
   */
  setScope(scope: string | null): void;
  /** 보관 중인 응답 요약. 없으면 null. */
  snapshotInfo(channel: SourceSnapshotChannel): SourceSnapshotInfo | null;
  setConnection(state: SourceConnection, reason?: string): void;
}

interface Retained {
  result: ZonesResult | WorkSurfacesResult;
  receivedAt: number;
  requestedAt: number | null;
  scope: string | null;
  lastOkReceivedAt: number | null;
}

/**
 * 외부 입력 Source. 예) STOMP 구독 콜백에서 `source.push(JSON.parse(frame.body))`,
 * 연결·끊김 콜백에서 `source.setConnection('OPEN')`·`source.setConnection('CLOSED', '하트비트 없음')`.
 */
export function createExternalSource(
  id: string,
  now: () => number = Date.now,
): ExternalSpatialSource {
  const sinks = new Set<SpatialSourceSink>();
  let connection: SourceConnectionChange = { state: 'CONNECTING', at: now() };
  let scope: string | null = null;
  const retained = new Map<SourceSnapshotChannel, Retained>();
  // 채널마다 받을 수 있는 가장 이른 요청 시각. 받은 응답의 요청 시각과 비운 시각 중 큰 값이다.
  const floor = new Map<SourceSnapshotChannel, number>();
  // 알리는 도중 구독이 바뀌어도 이번 알림 대상은 고정한다.
  const each = (fn: (sink: SpatialSourceSink) => void) => [...sinks].forEach(fn);
  const deliver = (sink: SpatialSourceSink, channel: SourceSnapshotChannel, kept: Retained) => {
    if (channel === 'zones') sink.onZones?.(kept.result, kept.receivedAt);
    else sink.onWorkSurfaces?.(kept.result, kept.receivedAt);
  };
  const pushSnapshot = (
    channel: SourceSnapshotChannel,
    result: ZonesResult | WorkSurfacesResult,
    receivedAt: number,
    options: SnapshotPushOptions = {},
  ): SnapshotPushOutcome => {
    // 범위를 정했으면 같은 범위를 단 응답만 받는다. 범위가 없으면 scope 없는 응답만 받는다.
    if ((options.scope ?? null) !== scope) return 'SCOPE_MISMATCH';
    const requestedAt = options.requestedAt ?? null;
    const prev = retained.get(channel);
    const earliest = floor.get(channel);
    if (requestedAt !== null && earliest !== undefined && requestedAt < earliest) {
      return 'STALE_REQUEST';
    }
    if (requestedAt !== null) floor.set(channel, Math.max(earliest ?? requestedAt, requestedAt));
    // 새 구독자에게 다시 보낼 값은 마지막으로 받은 응답이다(지금 구독 중인 쪽과 같은 상태가 되게).
    // 실패 뒤에 붙은 Viewer 가 이전 정상 형상을 지금 형상으로 보지 않게 한다. 마지막 정상 시각은 진단용으로만 남긴다.
    const kept: Retained = {
      result,
      receivedAt,
      requestedAt,
      scope,
      lastOkReceivedAt: result.ok ? receivedAt : (prev?.lastOkReceivedAt ?? null),
    };
    retained.set(channel, kept);
    each((sink) => deliver(sink, channel, kept));
    return 'ACCEPTED';
  };
  const clear = (channels: readonly SourceSnapshotChannel[]) => {
    // 비운 시각보다 앞서 요청한 응답(로그아웃 전 보낸 요청 등)은 이후에 와도 받지 않는다.
    const at = now();
    for (const channel of channels) floor.set(channel, Math.max(floor.get(channel) ?? at, at));
    for (const channel of channels) {
      if (!retained.delete(channel)) continue;
      each((sink) => sink.onSnapshotClear?.(channel));
    }
  };

  return {
    id,
    kind: 'EXTERNAL',
    get subscriberCount() {
      return sinks.size;
    },
    get scope() {
      return scope;
    },
    subscribe(sink) {
      sinks.add(sink);
      sink.onConnectionChange(connection);
      // 구독 전에 받은 형상을 다시 보낸다. 같은 값을 다시 받아도 Viewer 는 같은 형상으로 본다.
      for (const [channel, kept] of retained) deliver(sink, channel, kept);
      return () => {
        sinks.delete(sink);
      };
    },
    push(raw, receivedAt = now()) {
      each((sink) => sink.onMessage(raw, receivedAt));
    },
    pushZones(result, receivedAt = now(), options) {
      return pushSnapshot('zones', result, receivedAt, options);
    },
    pushWorkSurfaces(result, receivedAt = now(), options) {
      return pushSnapshot('workSurfaces', result, receivedAt, options);
    },
    clearSnapshot(channel) {
      clear(channel ? [channel] : SOURCE_SNAPSHOT_CHANNELS);
    },
    setScope(next) {
      if (next === scope) return;
      scope = next;
      clear(SOURCE_SNAPSHOT_CHANNELS);
    },
    snapshotInfo(channel) {
      const kept = retained.get(channel);
      return kept
        ? {
            ok: kept.result.ok,
            receivedAt: kept.receivedAt,
            requestedAt: kept.requestedAt,
            scope: kept.scope,
            lastOkReceivedAt: kept.lastOkReceivedAt,
          }
        : null;
    },
    setConnection(state, reason) {
      connection = reason ? { state, at: now(), reason } : { state, at: now() };
      each((sink) => sink.onConnectionChange(connection));
    },
  };
}

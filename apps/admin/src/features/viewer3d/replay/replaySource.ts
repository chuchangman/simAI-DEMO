import type {
  SourceConnectionChange,
  SpatialSource,
  SpatialSourceSink,
} from '@/features/viewer3d/data/spatialSource';
import {
  lastIndexAtOrBefore,
  type ReplayEntry,
  type ReplayLog,
} from '@/features/viewer3d/replay/replayLog';

// 녹화 재생 Source(S15P31A101-187). Mock·외부 입력과 같은 SpatialSource 경계로 기록된 World·RiskEvent 를 장면에 넣는다.
// 재생 시각(playhead)마다 "그 시각 이하의 마지막 기록"만 보낸다. 두 기록 사이를 보간하거나 기록 없는 위치를 만들지 않는다.
// 이벤트는 기록에 적힌 출처(REPLAY)를 그대로 보내 Store 의 REPLAY 키에만 들어간다(LIVE 키·LIVE 경보와 섞이지 않는다).
// 뒤로 돌릴 때는 onReset 으로 받은 데이터를 비우고 그 시각 상태를 처음부터 다시 보낸다(Store 는 더 오래된 World 를 거부한다).

/**
 * 기록 없는 구간으로 보는 기준(ms). world_state 는 10 Hz(명세 12.2)라 다섯 tick 넘게 기록이 없으면 빠진 것으로 본다.
 * 명세에 수치가 없어 개발 기준으로 둔다(options.gapMs 로 바꾼다).
 * 그 구간에는 마지막 기록 World 를 지우지 않고 기록 연령과 함께 두고, 연결을 CLOSED 로 알려 "마지막 수신"으로 보이게 한다.
 * 지우면 그 시각에 사람이 없었다는 기록처럼 보이므로, LIVE 끊김과 같게 마지막 상태를 오래됨 표시와 함께 남기는 쪽을 골랐다.
 */
export const REPLAY_GAP_MS = 500;
/** 재생 중 장면을 갱신하는 간격(ms). world_state 주기(10 Hz)에 맞췄다. */
export const REPLAY_TICK_MS = 100;
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;

export const REPLAY_GAP_REASON = '기록 없는 구간 · 마지막 기록 유지';
export const REPLAY_BEFORE_REASON = '이 시각 이전 World 기록 없음';
export const REPLAY_EMPTY_REASON = '재생할 기록 없음';

export interface ReplayStatus {
  /** 재생 시각(UTC ms, 기록 시계). 기록이 비었으면 null. */
  playhead: number | null;
  start: number | null;
  end: number | null;
  /** 재생 중인지(구독이 없으면 시각은 멈춘 채 둔다). */
  playing: boolean;
  /** 기록 끝에 닿았다. */
  ended: boolean;
  speed: number;
  /** 지금 보이는 World 의 t_latest_global. 없으면 null. */
  worldT: number | null;
  /** playhead − worldT. 기록 시각 기준 연령이다(이 브라우저 시계와 무관). */
  recordAgeMs: number | null;
  /** 이 시각을 덮는 World 기록이 없다(기록 전·빈 구간). 마지막 기록을 보간 없이 그대로 보인다. */
  gap: boolean;
}

export interface ReplaySpatialSource extends SpatialSource {
  readonly kind: 'REPLAY';
  /** 지금 재생 중인 기록. updateLog 로 바뀌면 새 객체다. */
  readonly log: ReplayLog;
  /** 지금 구독 중인 수. 누수 확인용이다. */
  readonly subscriberCount: number;
  /** 같은 객체를 돌려주다가 바뀌면 새 객체를 돌려준다(useSyncExternalStore 용). */
  getStatus(): ReplayStatus;
  subscribeStatus(listener: () => void): () => void;
  play(): void;
  pause(): void;
  /** 기록 시각으로 옮긴다. 범위 밖이면 처음·끝으로 맞춘다. 유한하지 않거나 기록이 비었으면 false. */
  seek(t: number): boolean;
  /** 앞(1)·뒤(−1) World 기록 시각으로 옮기고 멈춘다. 더 없으면 false. */
  stepFrame(direction: 1 | -1): boolean;
  /** 배속. 0 보다 큰 유한한 수만 받는다. */
  setSpeed(speed: number): boolean;
  /**
   * 기록을 더 받아 늘어난 새 기록으로 바꾼다. 재생 시각·재생 중·배속은 그대로 두고, 구독마다 지금 시각의 상태를 처음부터 다시 보낸다.
   * 시각 범위(start·end)가 지금 기록과 같아야 한다. 다르면 아무것도 바꾸지 않고 false 다.
   */
  updateLog(next: ReplayLog): boolean;
}

export interface ReplaySourceOptions {
  /** Source id. 없으면 새로 만든다(새 기록을 고르면 Viewer 가 데이터를 비운다). */
  id?: string;
  /** 이 브라우저 시계(ms). 수신 시각·재생 진행에 쓴다. */
  now?: () => number;
  gapMs?: number;
  tickMs?: number;
  /** 구독하면 바로 재생한다. 기본 false. */
  autoplay?: boolean;
}

/** 구독 하나에 이미 보낸 것. 같은 기록을 두 번 보내지 않고, 뒤로 가면 처음부터 다시 보낸다. */
interface Feed {
  sink: SpatialSourceSink;
  at: number | null;
  world: string | null;
  events: Map<string, string>;
  connection: string | null;
}

let created = 0;

export function createReplaySource(
  initialLog: ReplayLog,
  options: ReplaySourceOptions = {},
): ReplaySpatialSource {
  let log = initialLog;
  const now = options.now ?? Date.now;
  const gapMs = options.gapMs ?? REPLAY_GAP_MS;
  const tickMs = options.tickMs ?? REPLAY_TICK_MS;
  const id = options.id ?? 'replay:' + ++created;
  const feeds = new Set<Feed>();
  const listeners = new Set<() => void>();
  let playhead = log.start;
  let wantPlay = options.autoplay ?? false;
  let speed = 1;
  // 재생 중일 때만 있다. 재생 시각 = anchor.t + (now − anchor.wall) × speed.
  let anchor: { wall: number; t: number } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const worldAt = (t: number) => {
    const i = lastIndexAtOrBefore(log.worlds, t);
    return i >= 0 ? log.worlds[i]! : null;
  };

  /** t 이하의 이벤트별 마지막 전이. 전이 시각순. */
  const eventsAt = (t: number) => {
    const last = lastIndexAtOrBefore(log.events, t);
    const latest = new Map<string, ReplayEntry>();
    for (let i = 0; i <= last; i++) latest.set(log.events[i]!.eventId!, log.events[i]!);
    return [...latest.values()].sort((a, b) => a.t - b.t);
  };

  const connectionAt = (t: number | null): Omit<SourceConnectionChange, 'at'> => {
    if (t === null) return { state: 'CLOSED', reason: REPLAY_EMPTY_REASON };
    const world = worldAt(t);
    if (!world) return { state: 'CLOSED', reason: REPLAY_BEFORE_REASON };
    if (t - world.t > gapMs) return { state: 'CLOSED', reason: REPLAY_GAP_REASON };
    return { state: 'OPEN' };
  };

  const computeStatus = (): ReplayStatus => {
    const world = playhead === null ? null : worldAt(playhead);
    return {
      playhead,
      start: log.start,
      end: log.end,
      playing: wantPlay,
      ended: playhead !== null && log.end !== null && playhead >= log.end,
      speed,
      worldT: world?.t ?? null,
      recordAgeMs: world && playhead !== null ? playhead - world.t : null,
      gap: connectionAt(playhead).state !== 'OPEN',
    };
  };
  let status = computeStatus();
  const notify = () => {
    status = computeStatus();
    [...listeners].forEach((listener) => listener());
  };

  /** 이 구독에 지금 재생 시각의 상태를 보낸다. 앞으로 갔으면 바뀐 것만, 뒤로 갔거나 처음이면 비우고 전부 보낸다. */
  const deliver = (feed: Feed, fresh: boolean) => {
    const t = playhead;
    if (fresh || (feed.at !== null && t !== null && t < feed.at)) {
      feed.sink.onReset?.();
      feed.world = null;
      feed.events.clear();
      feed.connection = null;
    }
    feed.at = t;
    const connection = connectionAt(t);
    const key = connection.state + '|' + (connection.reason ?? '');
    if (key !== feed.connection) {
      feed.connection = key;
      feed.sink.onConnectionChange({ ...connection, at: now() });
    }
    if (t === null) return;
    const receivedAt = now();
    const world = worldAt(t);
    if (world && world.msgId !== feed.world) {
      feed.world = world.msgId;
      feed.sink.onMessage(JSON.parse(world.text), receivedAt);
    }
    for (const event of eventsAt(t)) {
      if (feed.events.get(event.eventId!) === event.msgId) continue;
      feed.events.set(event.eventId!, event.msgId);
      feed.sink.onMessage(JSON.parse(event.text), receivedAt);
    }
  };
  const deliverAll = () => [...feeds].forEach((feed) => deliver(feed, false));

  const current = () => {
    if (playhead === null || !anchor) return playhead;
    return Math.min(log.end!, anchor.t + (now() - anchor.wall) * speed);
  };

  /** 재생 의도가 있고 구독이 있고 끝이 아닐 때만 시계를 돌린다. 멈출 때 지금 시각을 굳힌다. */
  const sync = () => {
    const run = wantPlay && feeds.size > 0 && playhead !== null && playhead < log.end!;
    if (run && !timer) {
      anchor = { wall: now(), t: playhead! };
      timer = setInterval(advance, tickMs);
    } else if (!run && timer) {
      playhead = current();
      clearInterval(timer);
      timer = null;
      anchor = null;
    }
  };

  function advance() {
    playhead = current();
    // 끝에 닿으면 멈춘다. 끝 뒤를 지어내지 않는다.
    if (playhead !== null && playhead >= log.end!) wantPlay = false;
    deliverAll();
    sync();
    notify();
  }

  const moveTo = (t: number) => {
    playhead = Math.min(log.end!, Math.max(log.start!, t));
    if (anchor) anchor = { wall: now(), t: playhead };
    deliverAll();
    sync();
    notify();
  };

  return {
    id,
    kind: 'REPLAY',
    get log() {
      return log;
    },
    get subscriberCount() {
      return feeds.size;
    },
    subscribe(sink) {
      const feed: Feed = { sink, at: null, world: null, events: new Map(), connection: null };
      feeds.add(feed);
      deliver(feed, true);
      sync();
      notify();
      return () => {
        if (!feeds.delete(feed)) return;
        sync();
        notify();
      };
    },
    getStatus: () => status,
    subscribeStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play() {
      if (playhead === null) return;
      if (playhead >= log.end!) moveTo(log.start!);
      wantPlay = true;
      sync();
      notify();
    },
    pause() {
      wantPlay = false;
      sync();
      // 멈춘 시각이 마지막 tick 보다 조금 뒤일 수 있어 그 시각 상태로 맞춘다.
      deliverAll();
      notify();
    },
    seek(t) {
      if (playhead === null || !Number.isFinite(t)) return false;
      moveTo(t);
      return true;
    },
    stepFrame(direction) {
      if (playhead === null) return false;
      wantPlay = false;
      sync();
      const here = lastIndexAtOrBefore(log.worlds, playhead!);
      // 지금 시각이 World 기록 위가 아니면(빈 구간) 뒤로 한 칸은 그 마지막 기록이다.
      const onFrame = here >= 0 && log.worlds[here]!.t === playhead;
      const target = log.worlds[direction === 1 ? here + 1 : onFrame ? here - 1 : here];
      if (!target) {
        notify();
        return false;
      }
      moveTo(target.t);
      return true;
    },
    setSpeed(next) {
      if (!Number.isFinite(next) || next <= 0) return false;
      playhead = current();
      if (anchor) anchor = { wall: now(), t: playhead! };
      speed = next;
      notify();
      return true;
    },
    updateLog(next) {
      if (next.start !== log.start || next.end !== log.end) return false;
      // 재생 중이면 시계가 가리키는 시각을 먼저 굳히고, 새 기록으로 그 시각의 상태를 다시 보낸다.
      playhead = current();
      if (anchor) anchor = { wall: now(), t: playhead! };
      log = next;
      [...feeds].forEach((feed) => deliver(feed, true));
      sync();
      notify();
      return true;
    },
  };
}

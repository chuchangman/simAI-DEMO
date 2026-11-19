import {
  adaptMessage,
  adaptZones,
  NO_ZONES,
  type RejectReason,
} from '@/features/viewer3d/data/contractAdapter';
import { identityUncertainSince, pureMergeBase } from '@/features/viewer3d/data/identityCarry';
import type {
  EventSource,
  HealthView,
  RiskEventView,
  TrackView,
  WorldFrame,
  ZoneSnapshot,
} from '@/features/viewer3d/data/spatialFrame';
import { isActiveEvent } from '@/features/viewer3d/data/spatialFrame';
import type {
  SourceConnectionChange,
  SourceSnapshotChannel,
  WorkSurfacesResult,
  ZonesResult,
} from '@/features/viewer3d/data/spatialSource';
import { isNewerPose, type AvatarPoseView } from '@/features/viewer3d/people/avatarFrame';
import { adaptGeometry } from '@/features/viewer3d/surfaces/officialStaticObjects';
import {
  NO_WORK_SURFACES,
  type WorkSurfaceSnapshot,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { createStore, type StoreApi } from 'zustand/vanilla';

// Viewer 인스턴스마다 하나 두는 데이터 Store. 선택·모드(viewer3d.store)와 섞지 않는다.
// 10 Hz World 는 여기만 바꾸고 Canvas·장면 트리는 다시 만들지 않는다. 구독하는 렌더러만 갱신한다.

export type IngestOutcome =
  'world' | 'event' | 'health' | 'avatar' | 'rejected' | 'duplicate' | 'out_of_order';

export interface IngestCounts {
  world: number;
  event: number;
  health: number;
  /** 사람 포즈를 하나 이상 받은 avatar_frame(-65). */
  avatar: number;
  rejected: number;
  /** 같은 msg_id, 또는 같은 event_sequence 를 다시 받았다. */
  duplicate: number;
  /** 이미 받은 것보다 오래된 World·Health·이벤트 전이. 반영하지 않는다. */
  outOfOrder: number;
}

export interface RejectedInfo {
  reason: RejectReason;
  msgType: string | null;
  detail: string;
  at: number;
}

export interface SpatialDataState {
  /** 지금 구독 중인 Source 의 id. 없으면 null. */
  sourceId: string | null;
  /** 입력 연결 상태. 데이터 연령과 따로 둔다. */
  connection: SourceConnectionChange | null;
  /** 끊긴(CLOSED·ERROR) 뒤 다시 OPEN 된 횟수. */
  reconnects: number;
  /** 가장 최근(t_latest_global 기준) World. 끊겨도 지우지 않고, 연령으로 오래됨을 드러낸다. */
  world: WorldFrame | null;
  /** 키 `${source}:${event_id}`. LIVE·PLANNED·REPLAY·WHAT_IF 를 섞지 않는다. 해소된 이벤트도 남긴다. */
  events: ReadonlyMap<string, RiskEventView>;
  health: HealthView | null;
  /**
   * 사람별 가장 새 아바타 포즈(EXP-02, -65). 키 world_id. 존재·위치는 world 가 정본이라 여기 있어도 world 에 없으면 그리지 않는다.
   * 30초 넘게 새 포즈가 없는 사람은 뺀다(설계 '사람 제거').
   */
  avatars: ReadonlyMap<string, AvatarPoseView>;
  zones: ZoneSnapshot;
  /** 등록 작업면 OBB(Operational Geometry, -188). 10 Hz World 와 따로 바뀐다. */
  workSurfaces: WorkSurfaceSnapshot;
  lastRejected: RejectedInfo | null;
  counts: IngestCounts;

  ingest(raw: unknown, receivedAt: number): IngestOutcome;
  ingestZones(result: ZonesResult, receivedAt: number): void;
  ingestWorkSurfaces(result: WorkSurfacesResult, receivedAt: number): void;
  /** 한 형상 채널(구역·작업면/정적 객체)만 받기 전 상태로 비운다. World·이벤트·연결은 그대로다. */
  clearSnapshot(channel: SourceSnapshotChannel): void;
  setConnection(change: SourceConnectionChange): void;
  /** 다른 Source 로 바꿀 때 받은 데이터를 모두 비운다. */
  reset(sourceId: string | null): void;
}

export type SpatialDataStore = StoreApi<SpatialDataState>;

const ZERO: IngestCounts = {
  world: 0,
  event: 0,
  health: 0,
  avatar: 0,
  rejected: 0,
  duplicate: 0,
  outOfOrder: 0,
};
// 중복 확인용으로 기억하는 msg_id 수. 10 Hz World 기준 약 100초.
const SEEN_LIMIT = 1024;
/** 이만큼 새 포즈가 없으면 그 사람의 아바타 포즈를 지운다(ms, 설계 '사람 제거'). */
export const AVATAR_FORGET_MS = 30_000;

const eventKey = (source: EventSource, eventId: string) => `${source}:${eventId}`;
// event_sequence 가 없을 때(LIVE 가 아닌 출처 등) 순서를 가릴 시각.
const eventTime = (e: RiskEventView) => e.updatedAt ?? e.resolvedAt ?? e.raisedAt ?? e.meta.sentAt;

/** 새 전이를 반영할지. 같은 순번은 다시 받은 것, 낮은 순번·이전 시각은 늦게 온 것이다. */
function compareEvent(prev: RiskEventView, next: RiskEventView): 'newer' | 'duplicate' | 'older' {
  if (prev.eventSequence !== null && next.eventSequence !== null) {
    if (next.eventSequence > prev.eventSequence) return 'newer';
    return next.eventSequence === prev.eventSequence ? 'duplicate' : 'older';
  }
  return eventTime(next) > eventTime(prev) ? 'newer' : 'older';
}

export function createSpatialDataStore(): SpatialDataStore {
  // msg_id 기억은 화면에 쓰지 않으므로 상태 밖에 둔다.
  let seen = new Set<string>();
  // 끊긴(CLOSED·ERROR) 뒤 아직 OPEN 되지 않았는지. CONNECTING 을 거쳐도 이어 기억한다.
  let dropped = false;
  const remember = (msgId: string) => {
    seen.add(msgId);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value!);
  };

  return createStore<SpatialDataState>()((set, get) => {
    const bump = (key: keyof IngestCounts, patch: Partial<SpatialDataState> = {}) =>
      set({ ...patch, counts: { ...get().counts, [key]: get().counts[key] + 1 } });

    return {
      sourceId: null,
      connection: null,
      reconnects: 0,
      world: null,
      events: new Map(),
      health: null,
      avatars: new Map(),
      zones: NO_ZONES,
      workSurfaces: NO_WORK_SURFACES,
      lastRejected: null,
      counts: ZERO,

      ingest: (raw, receivedAt) => {
        const result = adaptMessage(raw, receivedAt);
        if (result.kind === 'rejected') {
          const { reason, msgType, detail } = result;
          bump('rejected', { lastRejected: { reason, msgType, detail, at: receivedAt } });
          return 'rejected';
        }
        const msgId = result.kind === 'avatar' ? result.frame.msgId : metaId(result);
        if (seen.has(msgId)) {
          bump('duplicate');
          return 'duplicate';
        }
        remember(msgId);

        switch (result.kind) {
          case 'avatar': {
            const avatars = new Map(get().avatars);
            let pruned = 0;
            for (const [id, pose] of avatars) {
              if (receivedAt - pose.receivedAt > AVATAR_FORGET_MS) {
                avatars.delete(id);
                pruned += 1;
              }
            }
            let accepted = 0;
            for (const pose of result.frame.avatars) {
              if (!isNewerPose(avatars.get(pose.worldId), pose)) continue;
              avatars.set(pose.worldId, pose);
              accepted += 1;
            }
            if (accepted === 0) {
              bump('outOfOrder', pruned > 0 ? { avatars } : {});
              return 'out_of_order';
            }
            bump('avatar', { avatars });
            return 'avatar';
          }
          case 'world': {
            const prev = get().world;
            if (prev && result.frame.tLatestGlobal <= prev.tLatestGlobal) {
              bump('outOfOrder');
              return 'out_of_order';
            }
            // 짧은 ID 불확실 동안 아바타 메시를 유지하려면 불확실이 이어진 시간을 알아야 한다(-661)
            const since = identityUncertainSince(prev, result.frame);
            // 순수 병합 직후 병합 전 차수의 포즈를 같은 사람의 것으로 잠깐 인정하려면 사슬 시작 차수가 필요하다(-743)
            const mergeBase = pureMergeBase(prev, result.frame);
            bump('world', {
              world:
                since.size > 0 || mergeBase.size > 0
                  ? {
                      ...result.frame,
                      ...(since.size > 0 ? { identityUncertainSince: since } : {}),
                      ...(mergeBase.size > 0 ? { pureMergeBase: mergeBase } : {}),
                    }
                  : result.frame,
            });
            return 'world';
          }
          case 'health': {
            const prev = get().health;
            if (prev && result.health.asOf <= prev.asOf) {
              bump('outOfOrder');
              return 'out_of_order';
            }
            bump('health', { health: result.health });
            return 'health';
          }
          case 'event': {
            const { event } = result;
            const key = eventKey(event.source, event.eventId);
            const prev = get().events.get(key);
            const order = prev ? compareEvent(prev, event) : 'newer';
            if (order === 'duplicate') {
              bump('duplicate');
              return 'duplicate';
            }
            if (order === 'older') {
              bump('outOfOrder');
              return 'out_of_order';
            }
            const events = new Map(get().events);
            events.set(key, event);
            bump('event', { events });
            return 'event';
          }
        }
      },

      ingestZones: (result, receivedAt) => {
        set({
          zones: result.ok
            ? adaptZones(result.raw, receivedAt)
            : { ...NO_ZONES, status: 'REJECTED', receivedAt, reason: result.reason },
        });
      },

      ingestWorkSurfaces: (result, receivedAt) => {
        set({
          workSurfaces: result.ok
            ? adaptGeometry(result.raw, receivedAt)
            : { ...NO_WORK_SURFACES, status: 'REJECTED', receivedAt, reason: result.reason },
        });
      },

      clearSnapshot: (channel) => {
        if (channel === 'zones') {
          if (get().zones !== NO_ZONES) set({ zones: NO_ZONES });
        } else if (get().workSurfaces !== NO_WORK_SURFACES) {
          set({ workSurfaces: NO_WORK_SURFACES });
        }
      },

      setConnection: (change) => {
        if (change.state === 'CLOSED' || change.state === 'ERROR') dropped = true;
        const recovered = change.state === 'OPEN' && dropped;
        if (recovered) dropped = false;
        set({ connection: change, reconnects: get().reconnects + (recovered ? 1 : 0) });
      },

      reset: (sourceId) => {
        seen = new Set();
        dropped = false;
        set({
          sourceId,
          connection: null,
          reconnects: 0,
          world: null,
          events: new Map(),
          health: null,
          avatars: new Map(),
          zones: NO_ZONES,
          workSurfaces: NO_WORK_SURFACES,
          lastRejected: null,
          counts: ZERO,
        });
      },
    };
  });
}

function metaId(
  result:
    | { kind: 'world'; frame: WorldFrame }
    | { kind: 'event'; event: RiskEventView }
    | { kind: 'health'; health: HealthView },
) {
  switch (result.kind) {
    case 'world':
      return result.frame.meta.msgId;
    case 'event':
      return result.event.meta.msgId;
    case 'health':
      return result.health.meta.msgId;
  }
}

// ---- 선택자: 렌더러(-44·-47·-185)와 진단이 같이 쓴다 ----
// useSpatialData 에 넘길 때 매번 새 배열을 만들면 끝없이 다시 그린다. 그래서 빈 값도 같은 객체를 돌려준다.

const NO_TRACKS: readonly TrackView[] = [];

/** 지금 World 의 사람. World 가 없으면 같은 빈 배열. */
export const selectTracks = (state: SpatialDataState): readonly TrackView[] =>
  state.world?.tracks ?? NO_TRACKS;

/** 한 출처의 이벤트(해소 포함). raised 순. 다른 출처와 섞지 않는다. 새 배열이라 useSpatialData 에는 s.events 를 넘기고 이것은 렌더 안에서 부른다. */
export function selectEvents(
  state: SpatialDataState,
  source: EventSource = 'LIVE',
): RiskEventView[] {
  return [...state.events.values()]
    .filter((e) => e.source === source)
    .sort((a, b) => (a.raisedAt ?? a.meta.sentAt) - (b.raisedAt ?? b.meta.sentAt));
}

export const selectActiveEvents = (state: SpatialDataState, source: EventSource = 'LIVE') =>
  selectEvents(state, source).filter(isActiveEvent);

export interface SpatialDataStatus {
  connection: SourceConnectionChange | null;
  reconnects: number;
  /** now − 마지막 World 수신 시각(이 브라우저 시계). World 를 받은 적 없으면 null. */
  receiveAgeMs: number | null;
  /** now − t_latest_global. 송신 측 시계와 이 브라우저 시계의 차이를 보정하지 않은 값이라 참고용이다. */
  sourceAgeMs: number | null;
  /** EC2 가 계산한 data_age_ms. 모르면 null. */
  healthDataAgeMs: number | null;
  systemHealth: HealthView['systemHealth'] | null;
  remoteState: HealthView['remoteState'] | null;
  /** viewer_health 가 알린 Scene 불일치. Health 가 없으면 null. */
  sceneMismatchReported: boolean | null;
  /** 받은 World 의 scene_version 과 Health 의 COMMITTED 버전 비교. 둘 중 하나라도 없으면 null. */
  sceneMismatchObserved: boolean | null;
}

/** 데이터 연령과 연결 상태를 따로 계산한다. 오래됨 기준(임계값)은 명세에 수치가 없어 여기서 정하지 않는다. */
export function selectStatus(state: SpatialDataState, now: number): SpatialDataStatus {
  const { world, health } = state;
  const committed = health?.scene.committedVersion ?? null;
  return {
    connection: state.connection,
    reconnects: state.reconnects,
    receiveAgeMs: world ? now - world.meta.receivedAt : null,
    sourceAgeMs: world ? now - world.tLatestGlobal : null,
    healthDataAgeMs: health?.dataAgeMs ?? null,
    systemHealth: health?.systemHealth ?? null,
    remoteState: health?.remoteState ?? null,
    sceneMismatchReported: health ? health.scene.mismatch : null,
    sceneMismatchObserved: world && committed ? world.sceneVersion !== committed : null,
  };
}

/**
 * 오래됨 판단. 임계값은 쓰는 쪽이 정해서 넘긴다(운영 기준이 정해지기 전 임의로 확정하지 않는다).
 * World 를 받은 적 없거나 연결이 OPEN 이 아니면 오래된 것으로 본다.
 */
export function isStale(status: SpatialDataStatus, thresholdMs: number): boolean {
  if (status.receiveAgeMs === null) return true;
  if (status.connection?.state !== 'OPEN') return true;
  return status.receiveAgeMs > thresholdMs;
}

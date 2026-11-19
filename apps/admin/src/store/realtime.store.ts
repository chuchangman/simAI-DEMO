import type { ExternalSpatialSource } from '@/features/viewer3d';
import { useCameraOrderStore } from '@/lib/cameraNames';
import {
  averageCameraLag,
  averageLag,
  lagSample,
  pushLagSample,
  type LagSample,
} from '@/lib/tier0Lag';
import {
  EMPTY_TRACK_LIFE,
  noteWatched,
  noteWorldFrame,
  type TrackLifeState,
} from '@/lib/trackLife';
import type { PpeViewPayload, ViewerHealthPayload, WorldStatePayload } from '@simai/contracts';
import { create } from 'zustand';

/** STOMP 연결 단계. IDLE 은 로그인 전·로그아웃 뒤다. */
export type LinkPhase = 'IDLE' | 'CONNECTING' | 'OPEN' | 'CLOSED';

export interface HealthSnapshot {
  payload: ViewerHealthPayload;
  /** 이 브라우저 시계로 받은 시각(ms). */
  receivedAt: number;
  /** EC2 시계 − 이 브라우저 시계(ms). envelope 의 sent_at 으로 잰다(전송 지연만큼 작게 나온다). */
  clockOffsetMs: number;
}

export interface WorldSnapshot {
  payload: WorldStatePayload;
  /** 이 브라우저 시계로 받은 시각(ms). */
  receivedAt: number;
}

/** Tier 0 하나의 PPE 화면용 스냅샷(/topic/ppe·GET /api/ppe/current, 명세 12.4·13.3). */
export interface PpeSnapshot {
  payload: PpeViewPayload;
  /** 이 브라우저 시계로 받은 시각(ms). 다음 스냅샷 전 만료를 볼 때 EC2 시각을 어림하는 기준이다. */
  receivedAt: number;
}

export interface RealtimeState {
  phase: LinkPhase;
  /** 마지막으로 연결이 열린 시각. 연결 뒤 health 를 아직 못 받았을 때 끊김 판단의 기준이다. */
  openedAt: number | null;
  health: HealthSnapshot | null;
  /** 최근 health 의 Tier 0 처리 지연 표본(lib/tier0Lag). 상단 바·CCTV 칸이 평균을 보인다. 모르면 빈 배열. */
  lagSamples: readonly LagSample[];
  /** 가장 새 World 상태(t_latest_global 기준). 3D 뷰어 없이 그리는 2D 비상 화면이 쓴다(명세 13.6). */
  world: WorldSnapshot | null;
  /**
   * 연결이 (다시) 열린 뒤 첫 world 는 순서와 상관없이 받는다. 서버 재시작·시계 보정으로 t_latest_global 이
   * 뒤로 가면 이후 프레임을 모두 버려 평면이 멈추기 때문이다.
   */
  worldResync: boolean;
  /**
   * World ID 가 이 브라우저에서 보인 구간·병합·워치 배정 기록(S15P31A101-785, lib/trackLife). 받은 world 마다 바뀌므로 화면은 구독하지 않고
   * 사람이 바뀔 때(selectAliveIdsKey) getState() 로 읽는다. 워치 기록(watched)은 새 배정이 있을 때만 바뀐다.
   */
  trackLife: TrackLifeState;
  /** Tier 0(tier0_source_id)별 가장 새 PPE 스냅샷. 스냅샷이라 이전 값을 이어 쓰지 않고 통째로 바꾼다. */
  ppe: Readonly<Record<string, PpeSnapshot>>;
  /** JSON 이 아니거나 계약 검사에 실패해 버린 메시지 수. */
  rejected: number;
  /** 3D 뷰어 입력. 세션마다 새로 만들어 이전 사용자의 데이터가 뷰어에 남지 않게 한다. */
  source: ExternalSpatialSource | null;
  /** 새 세션의 연결을 시작한다. 이전 값은 모두 비운다. */
  begin: () => void;
  setSource: (source: ExternalSpatialSource) => void;
  setPhase: (phase: LinkPhase) => void;
  opened: (at: number) => void;
  receiveHealth: (health: HealthSnapshot) => void;
  /** GET /api/health 로 받은 값. 그 사이 /topic/health 로 더 새(as_of) 값을 받았으면 버린다. */
  seedHealth: (health: HealthSnapshot) => void;
  /** 더 새 프레임만 받는다. 늦게 온 이전 프레임은 버린다. */
  receiveWorld: (world: WorldSnapshot) => void;
  /** 더 새(snapshot_at_ms) 스냅샷만 받는다. /topic/ppe 와 처음 상태 REST 가 같이 쓴다. */
  receivePpe: (snapshot: PpeSnapshot) => void;
  /** 워치가 배정된 World ID 를 기록에 더한다(배정이 풀려도 남긴다). */
  noteWatchedIds: (ids: readonly string[]) => void;
  reject: () => void;
  reset: () => void;
}

const INITIAL = {
  phase: 'IDLE',
  openedAt: null,
  health: null,
  lagSamples: [],
  world: null,
  worldResync: false,
  trackLife: EMPTY_TRACK_LIFE,
  ppe: {},
  rejected: 0,
  source: null,
} as const satisfies Partial<RealtimeState>;

// 10Hz 로 오는 world 는 최신 프레임 하나만 둔다. 3D 뷰어는 같은 메시지를 Source 로 받아 자기 저장소에 둔다(viewer3d).
// world 를 쓰는 화면(2D 평면)은 필요한 층만 구독한다. 다른 구독자는 원시값 셀렉터라 다시 그리지 않는다.
export const useRealtimeStore = create<RealtimeState>()((set) => ({
  ...INITIAL,
  begin: () => {
    useCameraOrderStore.getState().reset();
    set({ ...INITIAL, phase: 'CONNECTING' });
  },
  setSource: (source) => set({ source }),
  setPhase: (phase) => set({ phase }),
  opened: (at) => set({ phase: 'OPEN', openedAt: at, worldResync: true }),
  receiveHealth: (health) =>
    set((s) => ({ health, lagSamples: pushLagSample(s.lagSamples, lagSample(health.payload)) })),
  seedHealth: (health) =>
    set((s) =>
      s.health && s.health.payload.as_of >= health.payload.as_of
        ? s
        : { health, lagSamples: pushLagSample(s.lagSamples, lagSample(health.payload)) },
    ),
  receiveWorld: (world) =>
    set((s) =>
      s.world &&
      !s.worldResync &&
      s.world.payload.t_latest_global >= world.payload.t_latest_global &&
      // 연결이 그대로여도 시계가 뒤로 가면 이후 프레임을 모두 버리게 된다. 한동안 받지 못했으면 받는다.
      world.receivedAt - s.world.receivedAt <= WORLD_STALE_MS
        ? s
        : {
            world,
            worldResync: false,
            trackLife: noteWorldFrame(
              s.trackLife,
              world.payload.tracks,
              world.payload.t_latest_global,
            ),
          },
    ),
  receivePpe: (snapshot) =>
    set((s) => {
      const id = snapshot.payload.tier0_source_id;
      const prev = s.ppe[id];
      if (prev && prev.payload.snapshot_at_ms >= snapshot.payload.snapshot_at_ms) return s;
      return { ppe: { ...s.ppe, [id]: snapshot } };
    }),
  noteWatchedIds: (ids) =>
    set((s) => {
      const trackLife = noteWatched(s.trackLife, ids);
      return trackLife === s.trackLife ? s : { trackLife };
    }),
  reject: () => set((s) => ({ rejected: s.rejected + 1 })),
  reset: () => {
    useCameraOrderStore.getState().reset();
    set(INITIAL);
  },
}));

export type RealtimeStore = typeof useRealtimeStore;

/** 인원수에 넣는 생명주기. 확정됐거나(CONFIRMED) 확정 뒤 잠시 가려진(OCCLUDED) 사람만 센다. */
const COUNTED_LIFECYCLES: ReadonlySet<string> = new Set(['CONFIRMED', 'OCCLUDED']);

/**
 * 지금 추적 중인 사람 수. 확정(CONFIRMED)·가림(OCCLUDED)만 세고, 아직 확정 전(TENTATIVE)과 놓친(LOST) 트랙은
 * 세지 않는다(S15P31A101-661: 같은 사람의 중복 ID 가 병합 전 잠깐 TENTATIVE 로 생겼다 사라지면 인원이 출렁인다).
 * 숫자를 돌려주므로 world 가 10Hz 로 와도 수가 바뀔 때만 구독한 화면을 다시 그린다.
 */
export const selectTrackedCount = (state: Pick<RealtimeState, 'world'>): number =>
  state.world?.payload.tracks.filter((track) => COUNTED_LIFECYCLES.has(track.track_lifecycle))
    .length ?? 0;

/** selectAliveIdsKey 의 구분 글자. World ID 에 들어가지 않는 줄바꿈이다. */
export const ALIVE_ID_SEPARATOR = '\n';

/**
 * 지금 살아 있는(놓치지 않은, LOST 가 아닌) 사람의 World ID 와 병합으로 흡수된 이전 ID 를 정렬해 줄바꿈으로 이은 글자(S15P31A101-731).
 * 이벤트 패널의 화면 묶음이 살아 있는 서로 다른 두 사람을 한 카드로 섞지 않게 쓴다. 확정 전(TENTATIVE)도 실제 사람일 수 있어 넣는다.
 * World 를 아직 못 받았으면 null(모름). 글자를 돌려주므로 사람이 바뀔 때만 구독한 화면을 다시 그린다.
 */
export const selectAliveIdsKey = (state: Pick<RealtimeState, 'world'>): string | null => {
  const tracks = state.world?.payload.tracks;
  if (!tracks) return null;
  return tracks
    .filter((track) => track.track_lifecycle !== 'LOST')
    .flatMap((track) => [track.world_id, ...(track.aliases ?? [])])
    .sort()
    .join(ALIVE_ID_SEPARATOR);
};

/** 최근 몇 초 평균 Tier 0 처리 지연(ms). 모르면 undefined. 숫자라 값이 바뀔 때만 다시 그린다. */
export const selectTier0LagMs = (state: Pick<RealtimeState, 'lagSamples'>): number | undefined =>
  averageLag(state.lagSamples);

/** 최근 몇 초 평균 카메라별 지연(ms). 모르면 undefined. */
export const selectCameraLagMs = (
  state: Pick<RealtimeState, 'lagSamples'>,
  cameraId: string,
): number | undefined => averageCameraLag(state.lagSamples, cameraId);

/** /topic/health 는 1초마다 온다. 3번 연속 빠지면 끊긴 것으로 본다(명세 3장 하트비트, 13.2). */
export const HEALTH_TIMEOUT_MS = 3000;

/** world 는 10Hz 로 온다. 이 시간(ms) 넘게 없으면 health 가 와도 위치가 멈춘 것으로 본다. */
export const WORLD_STALE_MS = 1500;

/** 최근 world 를 받았는지. 연결이 살아 있어도 world 만 멈출 수 있다(파이프라인 정지). */
export function isWorldFresh(
  state: Pick<RealtimeState, 'world'>,
  now: number,
  staleMs = WORLD_STALE_MS,
): boolean {
  return state.world !== null && now - state.world.receivedAt <= staleMs;
}

/** EC2 와 이어져 있는지. STOMP 가 열려 있어도 health 가 정한 시간 넘게 없으면 끊긴 것이다. */
export function isLinkAlive(
  state: Pick<RealtimeState, 'phase' | 'openedAt' | 'health'>,
  now: number,
  timeoutMs = HEALTH_TIMEOUT_MS,
): boolean {
  if (state.phase !== 'OPEN') return false;
  const lastAlive = Math.max(state.openedAt ?? 0, state.health?.receivedAt ?? 0);
  return now - lastAlive <= timeoutMs;
}

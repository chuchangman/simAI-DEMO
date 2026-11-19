import type { WorldTrack } from '@simai/contracts';

// World ID 가 이 브라우저에서 얼마나 보였는지 적는 기록(S15P31A101-785). 화면 없이 시험한다.
// 이벤트 패널이 잠깐 생겼다 사라진 중복 트랙(유령 트랙)의 「지금 안 보임」 카드를 접을 때 근거로 쓴다.
// 모르면 길게 본다: 처음·마지막 모습을 이어서 보지 못했으면(접속 전부터 있었음, 프레임 공백 뒤) 수명을 모른다고 적는다.

/** World ID 하나가 보인(LOST 가 아닌 트랙으로 world 에 실린) 구간. 시각은 world 의 t_latest_global(EC2·Tier 0 ms)이다. */
export interface TrackLife {
  /** 처음 보인 프레임 시각. */
  first: number;
  /** 마지막으로 보인 프레임 시각. */
  last: number;
  /** 바로 앞 프레임에 없다가 이어서 받은 프레임에 처음 나타났다(생긴 때를 봤다). false 면 그 전부터 있었을 수 있다. */
  bornSeen: boolean;
  /** 지금 보이지 않고, 이어서 받은 프레임에서 사라졌다(끝난 때를 봤다). 지금 보이면 false. */
  endSeen: boolean;
}

export interface TrackLifeState {
  lives: Readonly<Record<string, TrackLife>>;
  /** 병합(aliases)으로 흡수된 ID → 흡수한 ID. 한 번 본 병합은 그 트랙이 사라져도 남긴다. */
  survivorOf: Readonly<Record<string, string>>;
  /** 워치가 한 번이라도 배정된 World ID. 배정이 풀려도 남긴다. */
  watched: Readonly<Record<string, true>>;
  /** 마지막으로 적은 프레임 시각. 없으면 아직 프레임을 받지 않았다. */
  lastFrameAt: number | null;
  /** 마지막 프레임에 보인 ID(정렬). */
  present: readonly string[];
}

export const EMPTY_TRACK_LIFE: TrackLifeState = {
  lives: {},
  survivorOf: {},
  watched: {},
  lastFrameAt: null,
  present: [],
};

/**
 * 이 간격(ms)보다 길게 프레임이 끊기면 앞뒤를 이어서 본 것으로 치지 않는다. world 는 10Hz 이고, 2D 평면이 멈춘 것으로 보는
 * 기준(WORLD_STALE_MS)과 같다.
 */
export const TRACK_LIFE_GAP_MS = 1500;

/**
 * world 프레임 하나를 기록에 더한다. 받은 프레임만 넣는다(realtime.store 가 늦게 온 이전 프레임을 버린 뒤).
 * 보인 사람은 LOST 가 아닌 트랙이다(selectAliveIdsKey 와 같다). 시계가 뒤로 가면(Tier 0 재시작 등) 이어서 보지 않은 것으로 친다.
 */
export function noteWorldFrame(
  state: TrackLifeState,
  tracks: readonly Pick<WorldTrack, 'world_id' | 'track_lifecycle' | 'aliases'>[],
  at: number,
): TrackLifeState {
  const continuous =
    state.lastFrameAt !== null &&
    at >= state.lastFrameAt &&
    at - state.lastFrameAt <= TRACK_LIFE_GAP_MS;
  const present = tracks
    .filter((t) => t.track_lifecycle !== 'LOST')
    .map((t) => t.world_id)
    .sort();
  const lives: Record<string, TrackLife> = { ...state.lives };
  for (const id of present) {
    const prev = lives[id];
    lives[id] = prev
      ? { ...prev, last: Math.max(prev.last, at), endSeen: false }
      : { first: at, last: at, bornSeen: continuous, endSeen: false };
  }
  const now = new Set(present);
  for (const id of state.present) {
    const prev = lives[id];
    if (!now.has(id) && prev) lives[id] = { ...prev, endSeen: continuous };
  }
  let survivorOf = state.survivorOf;
  for (const track of tracks) {
    for (const alias of track.aliases ?? []) {
      if (survivorOf[alias] !== track.world_id) {
        if (survivorOf === state.survivorOf) survivorOf = { ...state.survivorOf };
        (survivorOf as Record<string, string>)[alias] = track.world_id;
      }
    }
  }
  return { ...state, lives, survivorOf, lastFrameAt: at, present };
}

/** 워치가 배정된 ID 를 더한다. 새 ID 가 없으면 같은 기록을 돌려준다. */
export function noteWatched(state: TrackLifeState, ids: readonly string[]): TrackLifeState {
  const added = ids.filter((id) => !state.watched[id]);
  if (added.length === 0) return state;
  const watched: Record<string, true> = { ...state.watched };
  for (const id of added) watched[id] = true;
  return { ...state, watched };
}

/** 병합을 따라간 끝의 ID(흡수되지 않았으면 자기). 고리가 있어도 멈춘다. */
export function rootOf(state: Pick<TrackLifeState, 'survivorOf'>, id: string): string {
  let current = id;
  const seen = new Set<string>([current]);
  for (let next = state.survivorOf[current]; next !== undefined; next = state.survivorOf[current]) {
    if (seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** 같은 사람(병합으로 이어진 ID 전부): 끝 ID 와 그리로 흡수된 ID. */
export function identityOf(state: Pick<TrackLifeState, 'survivorOf'>, id: string): string[] {
  const root = rootOf(state, id);
  const members = new Set([root, id]);
  for (const alias of Object.keys(state.survivorOf)) {
    if (rootOf(state, alias) === root) members.add(alias);
  }
  return [...members];
}

/**
 * 이 ID 들이 보인 전체 길이(ms). 하나라도 기록이 없거나, 가장 먼저 보인 ID 의 생긴 때나 가장 늦게 보인 ID 의 끝난 때를
 * 이어서 보지 못했으면 모른다(null). 모르면 짧다고 보지 않는다.
 */
export function knownLifeMs(
  state: Pick<TrackLifeState, 'lives'>,
  ids: readonly string[],
): number | null {
  const lives = ids.map((id) => state.lives[id]);
  if (lives.length === 0 || lives.some((life) => life === undefined)) return null;
  const known = lives as TrackLife[];
  const earliest = known.reduce((a, b) => (b.first < a.first ? b : a));
  const latest = known.reduce((a, b) => (b.last > a.last ? b : a));
  if (!earliest.bornSeen || !known.every((life) => life.endSeen)) return null;
  return latest.last - earliest.first;
}

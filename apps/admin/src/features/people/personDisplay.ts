import type { WatchRow } from '@/features/watch/watchStatus';
import type { ViewerHealthPayload, WorldTrack } from '@simai/contracts';

// 사람 표시 이름·워치 상태 단일 어댑터(S15P31A101-658).
// 3D 이름표·사람 상세 패널·워치 연결 강조/알림·이벤트 카드/배너·2D 평면 말풍선·PPE 이름표가 모두 이 계산을 거친다.
// 2D 비상 평면 독립성(명세 13.6)을 지키기 위해 three·viewer3d 를 절대 import 하지 않는다.

export type ViewerHealthPersonName = NonNullable<ViewerHealthPayload['person_names']>[number];
export type ViewerHealthWatchName = NonNullable<ViewerHealthPayload['watch_names']>[number];

/** 사람 World ID 의 끝번호: `w-mw8y3hai-0722` → `0722`. 구분(`-`)이 없거나 끝이 비면 ID 그대로. */
export const shortPersonId = (id: string) => id.slice(id.lastIndexOf('-') + 1) || id;

/** 이름 없는 사람의 화면 표시 머리(S15P31A101-731). 확인 상태 배지 「미확인」과 헷갈리지 않게 「작업자 #N」으로 적는다. */
const WORKER_PREFIX = '작업자 #';

/**
 * 서버가 배정한 현장·날짜별 자동 번호 이름(`미확인 205`)을 화면 표시 `작업자 #205` 로 바꾼다(S15P31A101-731: 카드의 확인 상태 배지
 * 「미확인」과 같은 말이라 헷갈렸다). 그 꼴이 아니면 그대로다. 서버 값과 저장은 바꾸지 않는다(화면 표시만).
 */
export const workerLabel = (serverName: string): string => {
  const match = /^미확인\s*(\d+)$/u.exec(serverName);
  return match ? `${WORKER_PREFIX}${match[1]}` : serverName;
};

/** 이름 목록이 없을 때(수신 전·이전 EC2)의 짧은 표시: World ID 끝번호를 `작업자 #0722` 로(4자리 번호만 보이면 뜻을 몰랐다). */
const fallbackShortLabel = (worldId: string): string => `${WORKER_PREFIX}${shortPersonId(worldId)}`;

/** 지난 날 이벤트 로그처럼 이름 목록이 없는 자리의 표시(S15P31A101-751): `작업자 #0722`. 원래 World ID 는 hover 로 따로 보인다. */
export const workerShortLabel = fallbackShortLabel;

export const DISPLAY_NAME_MAX_LENGTH = 20;

export type PersonWatchStatus = 'connected' | 'disconnected' | 'none';

export type PersonNameSource = 'WORLD_MANUAL' | 'WATCH_DEVICE' | 'UNIDENTIFIED' | 'FALLBACK';

export interface PersonWatchState {
  status: PersonWatchStatus;
  deviceId: string | null;
}

export interface PersonDisplayInfo {
  worldId: string;
  /** 해석된 표시 이름(예: '김철수', '미확인 1', 수신 전 기본값 '미확인'). World ID·기기 ID 는 넣지 않는다. */
  displayName: string;
  nameSource: PersonNameSource;
  /** 현재 함께 표시되는 사람 중 같은 표시 이름이 둘 이상인지 여부(중복 이름 구분 근거). */
  isDuplicateName: boolean;
  watch: PersonWatchState;
}

export type PersonDisplayMap = Readonly<Record<string, PersonDisplayInfo>>;

export type NameOverride = { kind: 'SET'; displayName: string } | { kind: 'CLEAR' };

export type NormalizeDisplayNameResult =
  { ok: true; value: string } | { ok: false; message: string };

// 제어문자(Cc)·서식문자(Cf)·줄/문단 구분자(Zl/Zp)·대리 코드점(Cs) 금지 — 서버·계약 person_display_name 과 동일
const FORBIDDEN_CHAR_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const OUTER_SPACE_RE = /^[\s\uFEFF]+|[\s\uFEFF]+$/gu;

/**
 * 관리자 입력 표시 이름을 앞뒤 공백 제거 후 검사한다(서버 PersonDisplayNames.normalizeDisplayName 과 동일 규칙).
 */
export function normalizeDisplayName(raw: string): NormalizeDisplayNameResult {
  const trimmed = raw.replace(OUTER_SPACE_RE, '');
  if (trimmed.length === 0) {
    return { ok: false, message: '표시 이름을 입력해 주세요.' };
  }
  const codePointLength = [...trimmed].length;
  if (codePointLength > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `표시 이름은 1~${DISPLAY_NAME_MAX_LENGTH}자로 입력해 주세요.` };
  }
  if (FORBIDDEN_CHAR_RE.test(trimmed)) {
    return { ok: false, message: '줄바꿈·탭 등 제어문자는 사용할 수 없습니다.' };
  }
  return { ok: true, value: trimmed };
}

/** 10 Hz world 에서 사람 ID 집합만 뽑은 문자열. 좌표가 바뀌어도 다시 그리지 않는다. */
export function worldIdsKeyOf(
  tracks: readonly Pick<WorldTrack, 'world_id' | 'track_lifecycle'>[] | undefined,
): string {
  if (!tracks || tracks.length === 0) return '';
  return tracks
    .filter((t) => t.track_lifecycle !== 'LOST')
    .map((t) => t.world_id)
    .sort()
    .join('\u0001');
}

export function worldIdsOfKey(key: string): string[] {
  return key ? key.split('\u0001') : [];
}

/** 1 Hz viewer_health 에서 person_names 만 뽑은 문자열. 시계·지표 변화로 다시 그리지 않는다. */
export function personNamesKeyOf(items: readonly ViewerHealthPersonName[] | undefined): string {
  if (!items || items.length === 0) return '';
  return items
    .map((i) => `${i.world_id}\u0000${i.name_source}\u0000${i.display_name}`)
    .sort()
    .join('\u0001');
}

export function personNamesOfKey(key: string): ViewerHealthPersonName[] {
  if (!key) return [];
  return key.split('\u0001').map((entry) => {
    const [world_id = '', rawSource = 'UNIDENTIFIED', display_name = ''] = entry.split('\u0000');
    const name_source: ViewerHealthPersonName['name_source'] =
      rawSource === 'WORLD_MANUAL' || rawSource === 'WATCH_DEVICE' ? rawSource : 'UNIDENTIFIED';
    return { world_id, name_source, display_name };
  });
}

/** 1 Hz viewer_health 에서 watch_names 만 뽑은 문자열. */
export function watchNamesKeyOf(items: readonly ViewerHealthWatchName[] | undefined): string {
  if (!items || items.length === 0) return '';
  return items
    .map((i) => `${i.device_id}\u0000${i.display_name}`)
    .sort()
    .join('\u0001');
}

export function watchNamesOfKey(key: string): ViewerHealthWatchName[] {
  if (!key) return [];
  return key.split('\u0001').map((entry) => {
    const [device_id = '', display_name = ''] = entry.split('\u0000');
    return { device_id, display_name };
  });
}

export interface ResolvePersonDisplayInput {
  /** 현재 활성 World 트랙 ID 목록(중복 이름 판정의 우선 기준). */
  activeWorldIds?: readonly string[];
  personNames?: readonly ViewerHealthPersonName[];
  watchNames?: readonly ViewerHealthWatchName[];
  watchRows?: readonly WatchRow[];
  watchOverrides?: Readonly<Record<string, NameOverride>>;
  worldOverrides?: Readonly<Record<string, NameOverride>>;
}

function resolveWatchState(
  worldId: string,
  byWorld: ReadonlyMap<string, WatchRow>,
): PersonWatchState {
  const row = byWorld.get(worldId);
  if (!row) return { status: 'none', deviceId: null };
  return {
    status: row.connected ? 'connected' : 'disconnected',
    deviceId: row.deviceId,
  };
}

function resolveNameAndSource(
  worldId: string,
  watch: PersonWatchState,
  serverPersonByWorld: ReadonlyMap<string, ViewerHealthPersonName>,
  serverWatchByDevice: ReadonlyMap<string, string>,
  watchOverrides: Readonly<Record<string, NameOverride>>,
  worldOverrides: Readonly<Record<string, NameOverride>>,
): { displayName: string; nameSource: PersonNameSource } {
  const serverPerson = serverPersonByWorld.get(worldId);
  const worldOverride = worldOverrides[worldId];

  // 1순위: 관리자 당일 World ID 지정 이름(낙관적 갱신 포함)
  if (worldOverride?.kind === 'SET') {
    return { displayName: worldOverride.displayName, nameSource: 'WORLD_MANUAL' };
  }
  if (worldOverride?.kind !== 'CLEAR' && serverPerson?.name_source === 'WORLD_MANUAL') {
    return { displayName: serverPerson.display_name, nameSource: 'WORLD_MANUAL' };
  }

  // 2순위: 배정된 워치 기기 표시 이름(현장 지속, 낙관적 갱신 포함)
  if (watch.deviceId !== null) {
    const watchOverride = watchOverrides[watch.deviceId];
    if (watchOverride?.kind === 'SET') {
      return { displayName: watchOverride.displayName, nameSource: 'WATCH_DEVICE' };
    }
    if (watchOverride?.kind !== 'CLEAR') {
      const watchName = serverWatchByDevice.get(watch.deviceId);
      if (watchName !== undefined) {
        return { displayName: watchName, nameSource: 'WATCH_DEVICE' };
      }
      if (serverPerson?.name_source === 'WATCH_DEVICE') {
        return { displayName: serverPerson.display_name, nameSource: 'WATCH_DEVICE' };
      }
    }
  } else if (serverPerson?.name_source === 'WATCH_DEVICE') {
    // 배정 REST 응답이 아직 도착하기 전이라도 서버 health 가 워치 이름을 이미 해석했으면 따른다
    return { displayName: serverPerson.display_name, nameSource: 'WATCH_DEVICE' };
  }

  // 3순위: 서버가 배정한 현장·날짜별 '미확인 N'(또는 상위 이름이 지워진 직후 기본 표시)
  if (serverPerson?.name_source === 'UNIDENTIFIED') {
    return { displayName: workerLabel(serverPerson.display_name), nameSource: 'UNIDENTIFIED' };
  }

  return { displayName: '미확인', nameSource: 'FALLBACK' };
}

/**
 * 알려진 모든 World ID 에 대해 {표시 이름, 이름 출처, 중복 여부, 워치 상태} 를 한 번에 해석한다.
 */
export function resolvePersonDisplayMap({
  activeWorldIds = [],
  personNames = [],
  watchNames = [],
  watchRows = [],
  watchOverrides = {},
  worldOverrides = {},
}: ResolvePersonDisplayInput): PersonDisplayMap {
  const byWorldWatch = new Map<string, WatchRow>();
  for (const row of watchRows) {
    if (row.worldId) byWorldWatch.set(row.worldId, row);
  }
  const serverPersonByWorld = new Map<string, ViewerHealthPersonName>();
  for (const item of personNames) {
    serverPersonByWorld.set(item.world_id, item);
  }
  const serverWatchByDevice = new Map<string, string>();
  for (const item of watchNames) {
    serverWatchByDevice.set(item.device_id, item.display_name);
  }

  const allWorldIds = new Set<string>(activeWorldIds);
  for (const item of personNames) allWorldIds.add(item.world_id);
  for (const row of watchRows) {
    if (row.worldId) allWorldIds.add(row.worldId);
  }
  for (const worldId of Object.keys(worldOverrides)) allWorldIds.add(worldId);

  const preliminary = new Map<
    string,
    { displayName: string; nameSource: PersonNameSource; watch: PersonWatchState }
  >();
  for (const worldId of allWorldIds) {
    const watch = resolveWatchState(worldId, byWorldWatch);
    const { displayName, nameSource } = resolveNameAndSource(
      worldId,
      watch,
      serverPersonByWorld,
      serverWatchByDevice,
      watchOverrides,
      worldOverrides,
    );
    preliminary.set(worldId, { displayName, nameSource, watch });
  }

  // 중복 이름은 현재 화면에 함께 있는 사람(activeWorldIds 가 있으면 그 집합, 없으면 전체) 기준으로 판정한다
  const duplicateScope = activeWorldIds.length > 0 ? activeWorldIds : [...allWorldIds];
  const counts = new Map<string, number>();
  for (const worldId of duplicateScope) {
    const entry = preliminary.get(worldId);
    if (!entry || entry.nameSource === 'FALLBACK') continue;
    counts.set(entry.displayName, (counts.get(entry.displayName) ?? 0) + 1);
  }

  const out: Record<string, PersonDisplayInfo> = {};
  for (const [worldId, entry] of preliminary) {
    out[worldId] = {
      worldId,
      displayName: entry.displayName,
      nameSource: entry.nameSource,
      isDuplicateName: entry.nameSource !== 'FALLBACK' && (counts.get(entry.displayName) ?? 0) > 1,
      watch: entry.watch,
    };
  }
  return out;
}

/** 맵에 아직 없는 World ID 도 안전하게 기본값으로 돌려준다. */
export function resolvePersonDisplay(
  worldId: string,
  map: PersonDisplayMap | undefined,
): PersonDisplayInfo {
  const existing = map?.[worldId];
  if (existing) return existing;
  return {
    worldId,
    displayName: '미확인',
    nameSource: 'FALLBACK',
    isDuplicateName: false,
    watch: { status: 'none', deviceId: null },
  };
}

/** 사람 상세 패널에 보일 이름 출처 설명. */
export function personNameSourceText(source: PersonNameSource): string {
  switch (source) {
    case 'WATCH_DEVICE':
      return '워치 기기 이름 · 현장 지속';
    case 'WORLD_MANUAL':
      return '관리자 지정 · 오늘 한정';
    case 'UNIDENTIFIED':
      return '이름 없는 사람 자동 번호 · 오늘 한정';
    case 'FALLBACK':
      return '이름 확인 중';
  }
}

/** 워치 연결 순간 3D 큰 이름표 강조 문구("⌚ 김철수 연결됨"). */
export function formatWatchBindHighlight(displayName: string): string {
  return `⌚ ${displayName} 연결됨`;
}

/** 워치 연결 순간 상단/패널 알림 문구("⌚ 김철수 연결됨(자동)"). 중복 이름이면 기기 ID 를 괄호로 보탠다. */
export function formatWatchBindNotice(
  info: Pick<PersonDisplayInfo, 'displayName' | 'isDuplicateName' | 'watch'>,
  methodLabel: string,
): string {
  const subject =
    info.isDuplicateName && info.watch.deviceId
      ? `${info.displayName}(${info.watch.deviceId})`
      : info.displayName;
  return `⌚ ${subject} 연결됨(${methodLabel})`;
}

/**
 * 이벤트 카드·경보 배너·2D 말풍선용 짧은 사람 표시.
 * 해석된 이름이 있으면 이름을 쓰고(동명이인이면 끝번호를 함께 붙여 구분), 이전 EC2·단위 시험처럼 이름 목록이 없으면 `작업자 #끝번호` 로 폴백한다(S15P31A101-731).
 */
export function formatPersonShort(worldId: string, map?: PersonDisplayMap): string {
  const info = map?.[worldId];
  if (!info || info.nameSource === 'FALLBACK') return fallbackShortLabel(worldId);
  // 이름 없는 사람(자동 번호 「작업자 #N」)은 괄호 번호를 붙이지 않는다(S15P31A101-757). 내부 ID 는 올려 보면 나온다(formatPersonFull).
  return info.isDuplicateName && info.nameSource !== 'UNIDENTIFIED'
    ? `${info.displayName} (${shortPersonId(worldId)})`
    : info.displayName;
}

/**
 * 사건 상세·카드 툴팁·접근성 이름용 전체 사람 표시.
 * 해석된 이름이 있으면 `김철수 (w-0015)` 처럼 이름과 World ID 를 함께 보여 동명이인도 정확히 가린다.
 */
export function formatPersonFull(worldId: string, map?: PersonDisplayMap): string {
  const info = map?.[worldId];
  if (!info || info.nameSource === 'FALLBACK') return worldId;
  return `${info.displayName} (${worldId})`;
}

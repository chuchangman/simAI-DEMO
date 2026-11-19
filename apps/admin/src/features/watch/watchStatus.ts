import type { WatchBinding } from '@/features/watch/api';
import type { ViewerHealthPayload } from '@simai/contracts';

export type HealthWatches = NonNullable<ViewerHealthPayload['watches']>;

/** 워치 한 대의 줄. 연결은 health(1초마다)가 정본이고, 배정은 REST 로 받는다. */
export interface WatchRow {
  deviceId: string;
  connected: boolean;
  worldId: string | null;
}

/**
 * 등록된 워치 목록(health)과 배정(REST)을 한 줄씩 합친다. health 에 없는 배정 워치(health 를 아직 못 받음 등)는
 * 배정 응답의 채널 상태로 보인다. 기기 ID 순.
 */
export function watchRows(
  watches: HealthWatches | undefined,
  bindings: readonly WatchBinding[],
): WatchRow[] {
  const byDevice = new Map(bindings.map((b) => [b.device_id, b] as const));
  const rows = new Map<string, WatchRow>();
  for (const item of watches?.items ?? []) {
    const b = byDevice.get(item.device_id);
    rows.set(item.device_id, {
      deviceId: item.device_id,
      connected: item.link === 'CONNECTED',
      worldId: b?.world_id ?? null,
    });
  }
  for (const b of bindings) {
    if (!rows.has(b.device_id)) {
      rows.set(b.device_id, {
        deviceId: b.device_id,
        connected: b.channel_state === 'BOUND',
        worldId: b.world_id,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/** 작업 전 확인의 워치 한 줄(S15P31A101-692): 표시 이름·기기·연결·사람과 짝지음. */
export interface WatchSummaryRow {
  deviceId: string;
  /** 현장 워치 표시 이름(health watch_names). 없으면 null. */
  name: string | null;
  connected: boolean;
  /** 현장의 사람(World ID)과 짝지어졌는지(배정 있음). */
  bound: boolean;
}

/**
 * 작업 전 확인에 보일 워치 줄. 연결·배정은 watchRows 와 같고(health 정본, 없으면 배정 응답), 이름은 health 의 watch_names 다.
 * 기기 ID 순.
 */
export function watchSummaryRows(
  watches: HealthWatches | undefined,
  watchNames: ViewerHealthPayload['watch_names'],
  bindings: readonly WatchBinding[],
): WatchSummaryRow[] {
  const names = new Map((watchNames ?? []).map((w) => [w.device_id, w.display_name] as const));
  return watchRows(watches, bindings).map((row) => ({
    deviceId: row.deviceId,
    name: names.get(row.deviceId) ?? null,
    connected: row.connected,
    bound: row.worldId !== null,
  }));
}

/**
 * 아바타 이름표 뒤에 붙일 글(World ID → 글). 배정된 사람만 싣는다: 연결이면 '워치 기기ID', 끊김이면 '워치 끊김 기기ID'.
 * 배정 없는 사람(UNBOUND)은 싣지 않는다. 착용 여부는 알 수 없으므로 '미착용'으로 단정하지 않는다(FR-117).
 */
export function watchBadges(rows: readonly WatchRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.worldId)
      out[row.worldId] = row.connected ? `워치 ${row.deviceId}` : `워치 끊김 ${row.deviceId}`;
  }
  return out;
}

/**
 * 이름표에 쓰는 연결만 뽑은 문자열('기기=CONNECTED|기기=LOST', 기기 순). health 는 1초마다 새 객체라 이 원시값을 구독해야
 * 연결이 실제로 바뀔 때만 다시 그린다(배터리·시각 변화로 3D 호스트를 다시 그리지 않게).
 */
export function linkKeyOf(watches: HealthWatches | undefined): string {
  return (watches?.items ?? [])
    .map((i) => `${i.device_id}=${i.link}`)
    .sort()
    .join('|');
}

/** linkKeyOf 를 되돌린 최소 health(배터리·시각 없음). 빈 문자열이면 health 없음 */
export function watchesOfLinkKey(key: string): HealthWatches | undefined {
  if (!key) return undefined;
  const items = key.split('|').map((part) => {
    const at = part.lastIndexOf('=');
    const link: 'CONNECTED' | 'LOST' = part.slice(at + 1) === 'CONNECTED' ? 'CONNECTED' : 'LOST';
    return {
      device_id: part.slice(0, at),
      link,
      last_heartbeat_at: 0,
      battery_pct: null,
      transport: null,
    };
  });
  return {
    registered: items.length,
    connected: items.filter((i) => i.link === 'CONNECTED').length,
    items,
  } as HealthWatches;
}

/** 새로 이어진 배정을 알릴 때 쓰는 방식 표시. 서버가 모르는 값(손 흔들기 등)을 내면 '자동'으로 본다 */
export type BindMethodLabel = 'AUTO' | 'MANUAL';

export const BIND_METHOD_TEXT: Record<BindMethodLabel, string> = { AUTO: '자동', MANUAL: '수동' };

export function bindMethodOf(method: string): BindMethodLabel {
  return method === 'MANUAL' ? 'MANUAL' : 'AUTO';
}

/** 배정 하나의 식별: 워치와 World ID 가 모두 같아야 같은 배정이다(워치가 다른 사람으로 옮겨가면 새 배정) */
export function bindKeyOf(b: Pick<WatchBinding, 'device_id' | 'world_id'>): string {
  return `${b.device_id}\u0000${b.world_id}`;
}

export interface NewBind {
  deviceId: string;
  worldId: string;
  method: BindMethodLabel;
}

/**
 * 이전 조회와 비교해 새로 이어진 (워치, World ID) 만 돌려준다. prev 가 null(처음 불러옴)이면 없다.
 * 같은 배정 유지·재로드는 효과 없음. 워치가 연결 상태(BOUND)일 때만 센다(끊긴 배정은 '연결됨'이 아니다).
 */
export function newBinds(
  prev: ReadonlySet<string> | null,
  bindings: readonly WatchBinding[],
): NewBind[] {
  if (prev === null) return [];
  return bindings
    .filter((b) => b.channel_state === 'BOUND' && !prev.has(bindKeyOf(b)))
    .map((b) => ({ deviceId: b.device_id, worldId: b.world_id, method: bindMethodOf(b.method) }));
}

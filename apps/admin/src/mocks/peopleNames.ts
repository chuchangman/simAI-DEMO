import {
  normalizeDisplayName,
  type ViewerHealthPersonName,
  type ViewerHealthWatchName,
} from '@/features/people/personDisplay';
import type { WatchBinding } from '@/features/watch/api';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import type { ViewerHealthPayload } from '@simai/contracts';
import { http, HttpResponse } from 'msw/http';

// 로컬 QA·단위 시험용 사람·워치 표시 이름 mock(S15P31A101-658).
// 서버 PersonDisplayNames 와 같은 우선순위(WORLD_MANUAL > WATCH_DEVICE > UNIDENTIFIED)와 추가 전용(append-only) 이력을 따른다.

const MOCK_SITE_ID = 'classroom-1';
const MOCK_WORKERS = ['w-0012', 'w-0015', 'w-0021'] as const;

type HistoryAction = 'SET' | 'CLEAR';

interface WatchNameRow {
  historyId: number;
  deviceId: string;
  action: HistoryAction;
  displayName: string | null;
  changedByUserId: number;
  createdAt: number;
}

interface WorldNameRow {
  historyId: number;
  siteDate: string;
  worldId: string;
  action: HistoryAction;
  displayName: string | null;
  changedByUserId: number;
  createdAt: number;
}

export interface HealthPeopleSnapshot {
  watches: NonNullable<ViewerHealthPayload['watches']>;
  watchNames: ViewerHealthWatchName[];
  personNames: ViewerHealthPersonName[];
}

export interface PeopleNamesMock {
  handlers: ReturnType<typeof http.get>[];
  bindings: () => WatchBinding[];
  snapshotAt: (t: number) => HealthPeopleSnapshot;
  bindWatch: (
    deviceId: string,
    worldId: string,
    method?: 'MOTION_MATCH' | 'MANUAL',
  ) => WatchBinding;
  onChange: (listener: () => void) => void;
}

const SEOUL_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function seoulDateOf(ms: number): string {
  return SEOUL_DATE_FMT.format(ms);
}

function numericUserId(id: string): number {
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function readDisplayNameBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('display_name' in body)) return null;
  const raw = (body as { display_name: unknown }).display_name;
  return typeof raw === 'string' ? raw : null;
}

/** 기본 시나리오 스냅샷(viewerHealthAt 기본값·계약 검증용). */
export function defaultHealthPeopleSnapshot(t: number): HealthPeopleSnapshot {
  return {
    watches: {
      registered: 3,
      connected: 2,
      items: [
        {
          device_id: 'watch-01',
          link: 'CONNECTED',
          last_heartbeat_at: Math.max(0, t - 500),
          battery_pct: 84,
          transport: 'WIFI',
        },
        {
          device_id: 'watch-02',
          link: 'LOST',
          last_heartbeat_at: Math.max(0, t - 15_000),
          battery_pct: null,
          transport: null,
        },
        {
          device_id: 'watch-03',
          link: 'CONNECTED',
          last_heartbeat_at: Math.max(0, t - 400),
          battery_pct: 92,
          transport: 'WIFI',
        },
      ],
    },
    watchNames: [
      { device_id: 'watch-01', display_name: '김철수' },
      { device_id: 'watch-02', display_name: '이영희' },
      { device_id: 'watch-03', display_name: '박민수' },
    ],
    personNames: [
      { world_id: 'w-0012', display_name: '김철수', name_source: 'WATCH_DEVICE' },
      { world_id: 'w-0015', display_name: '이영희', name_source: 'WATCH_DEVICE' },
      { world_id: 'w-0021', display_name: '미확인 1', name_source: 'UNIDENTIFIED' },
    ],
  };
}

export function createPeopleNamesMock(now: () => number = Date.now): PeopleNamesMock {
  let historySeq = 0;
  let bindingSeq = 2;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };

  const registeredWatches = new Map<
    string,
    { link: 'CONNECTED' | 'LOST'; batteryPct: number | null }
  >([
    ['watch-01', { link: 'CONNECTED', batteryPct: 84 }],
    ['watch-02', { link: 'LOST', batteryPct: null }],
    ['watch-03', { link: 'CONNECTED', batteryPct: 92 }],
  ]);

  // w-0012: 연결된 워치(김철수), w-0015: 끊긴 워치(이영희), w-0021: 워치 없음(미확인 1) — A안 3가지 상태를 한눈에 검수
  let activeBindings: WatchBinding[] = [
    {
      binding_id: 1,
      device_id: 'watch-01',
      world_id: 'w-0012',
      method: 'MOTION_MATCH',
      bound_at: 1_760_342_400_000,
      channel_state: 'BOUND',
    },
    {
      binding_id: 2,
      device_id: 'watch-02',
      world_id: 'w-0015',
      method: 'MANUAL',
      bound_at: 1_760_342_400_000,
      channel_state: 'LOST',
    },
  ];

  // 추가만 하는(append-only) 이력 배열 — 기존 행을 덮어쓰거나 지우지 않는다(AGENTS 규칙 6)
  const watchHistory: WatchNameRow[] = [
    {
      historyId: ++historySeq,
      deviceId: 'watch-01',
      action: 'SET',
      displayName: '김철수',
      changedByUserId: 1,
      createdAt: 1_760_342_400_000,
    },
    {
      historyId: ++historySeq,
      deviceId: 'watch-02',
      action: 'SET',
      displayName: '이영희',
      changedByUserId: 1,
      createdAt: 1_760_342_400_000,
    },
    {
      historyId: ++historySeq,
      deviceId: 'watch-03',
      action: 'SET',
      displayName: '박민수',
      changedByUserId: 1,
      createdAt: 1_760_342_400_000,
    },
  ];

  const worldHistory: WorldNameRow[] = [];
  const unidentifiedByDate = new Map<string, Map<string, number>>();
  const nextUnidentifiedByDate = new Map<string, number>();

  function ensureUnidentifiedNumber(siteDate: string, worldId: string): number {
    let byWorld = unidentifiedByDate.get(siteDate);
    if (!byWorld) {
      byWorld = new Map();
      unidentifiedByDate.set(siteDate, byWorld);
    }
    const existing = byWorld.get(worldId);
    if (existing !== undefined) return existing;
    const next = (nextUnidentifiedByDate.get(siteDate) ?? 0) + 1;
    nextUnidentifiedByDate.set(siteDate, next);
    byWorld.set(worldId, next);
    return next;
  }

  function currentWatchNames(): Map<string, string> {
    const latest = new Map<string, WatchNameRow>();
    for (const row of watchHistory) {
      latest.set(row.deviceId, row);
    }
    const out = new Map<string, string>();
    for (const [deviceId, row] of latest) {
      if (row.action === 'SET' && row.displayName !== null && registeredWatches.has(deviceId)) {
        out.set(deviceId, row.displayName);
      }
    }
    return out;
  }

  function currentWorldManualNames(siteDate: string): Map<string, string> {
    const latest = new Map<string, WorldNameRow>();
    for (const row of worldHistory) {
      if (row.siteDate === siteDate) latest.set(row.worldId, row);
    }
    const out = new Map<string, string>();
    for (const [worldId, row] of latest) {
      if (row.action === 'SET' && row.displayName !== null) {
        out.set(worldId, row.displayName);
      }
    }
    return out;
  }

  function resolveOnePerson(
    worldId: string,
    siteDate: string,
    watchNames: ReadonlyMap<string, string>,
    worldManual: ReadonlyMap<string, string>,
  ): ViewerHealthPersonName {
    const manual = worldManual.get(worldId);
    if (manual !== undefined) {
      return { world_id: worldId, display_name: manual, name_source: 'WORLD_MANUAL' };
    }
    const binding = activeBindings.find((b) => b.world_id === worldId);
    if (binding) {
      const watchName = watchNames.get(binding.device_id);
      if (watchName !== undefined) {
        return { world_id: worldId, display_name: watchName, name_source: 'WATCH_DEVICE' };
      }
    }
    const num = ensureUnidentifiedNumber(siteDate, worldId);
    return { world_id: worldId, display_name: `미확인 ${num}`, name_source: 'UNIDENTIFIED' };
  }

  function snapshotAt(t: number): HealthPeopleSnapshot {
    const siteDate = seoulDateOf(t);
    const watchNamesMap = currentWatchNames();
    const worldManualMap = currentWorldManualNames(siteDate);

    const knownWorlds = new Set<string>(MOCK_WORKERS);
    for (const b of activeBindings) knownWorlds.add(b.world_id);
    for (const row of worldHistory) {
      if (row.siteDate === siteDate) knownWorlds.add(row.worldId);
    }

    const personNames = [...knownWorlds]
      .sort()
      .map((worldId) => resolveOnePerson(worldId, siteDate, watchNamesMap, worldManualMap));

    const watchNames: ViewerHealthWatchName[] = [...watchNamesMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([device_id, display_name]) => ({ device_id, display_name }));

    const items = [...registeredWatches.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([device_id, meta]) => ({
        device_id,
        link: meta.link,
        last_heartbeat_at:
          meta.link === 'CONNECTED' ? Math.max(0, t - 500) : Math.max(0, t - 15_000),
        battery_pct: meta.link === 'CONNECTED' ? meta.batteryPct : null,
        transport: meta.link === 'CONNECTED' ? ('WIFI' as const) : null,
      }));

    return {
      watches: {
        registered: items.length,
        connected: items.filter((i) => i.link === 'CONNECTED').length,
        items,
      },
      watchNames,
      personNames,
    };
  }

  function requireAdmin(request: Request, t: number) {
    const user = readLiveUser(request, t);
    if (!user) return { error: unauthorized() } as const;
    if (user.role !== 'ADMIN') {
      return { error: problem(403, 'FORBIDDEN', '관리자 권한이 필요합니다.') } as const;
    }
    return { user } as const;
  }

  return {
    bindings: () => activeBindings,
    snapshotAt,
    onChange: (listener) => {
      listeners.add(listener);
    },
    bindWatch: (deviceId, worldId, method = 'MOTION_MATCH') => {
      if (!registeredWatches.has(deviceId)) {
        registeredWatches.set(deviceId, { link: 'CONNECTED', batteryPct: 88 });
      } else {
        registeredWatches.set(deviceId, { link: 'CONNECTED', batteryPct: 88 });
      }
      const next: WatchBinding = {
        binding_id: ++bindingSeq,
        device_id: deviceId,
        world_id: worldId,
        method,
        bound_at: now(),
        channel_state: 'BOUND',
      };
      activeBindings = [
        ...activeBindings.filter((b) => b.device_id !== deviceId && b.world_id !== worldId),
        next,
      ];
      notify();
      return next;
    },
    handlers: [
      http.get('*/api/watch-bindings', ({ request }) => {
        if (!readLiveUser(request, now())) return unauthorized();
        return HttpResponse.json(activeBindings);
      }),
      http.put('*/api/watches/:deviceId/display-name', async ({ request, params }) => {
        const t = now();
        const auth = requireAdmin(request, t);
        if ('error' in auth) return auth.error;
        const deviceId = String(params['deviceId'] ?? '');
        if (!registeredWatches.has(deviceId)) {
          return problem(404, 'WATCH_NOT_FOUND', '등록된 워치를 찾을 수 없습니다.');
        }
        const raw = readDisplayNameBody(await request.json().catch(() => undefined));
        const checked = normalizeDisplayName(raw ?? '');
        if (!checked.ok) {
          return problem(400, 'INVALID_DISPLAY_NAME', checked.message);
        }
        const userId = numericUserId(auth.user.id);
        watchHistory.push({
          historyId: ++historySeq,
          deviceId,
          action: 'SET',
          displayName: checked.value,
          changedByUserId: userId,
          createdAt: t,
        });
        notify();
        return HttpResponse.json({
          device_id: deviceId,
          site_id: MOCK_SITE_ID,
          display_name: checked.value,
          changed_by_user_id: userId,
          updated_at: t,
        });
      }),
      http.delete('*/api/watches/:deviceId/display-name', ({ request, params }) => {
        const t = now();
        const auth = requireAdmin(request, t);
        if ('error' in auth) return auth.error;
        const deviceId = String(params['deviceId'] ?? '');
        if (!registeredWatches.has(deviceId)) {
          return problem(404, 'WATCH_NOT_FOUND', '등록된 워치를 찾을 수 없습니다.');
        }
        watchHistory.push({
          historyId: ++historySeq,
          deviceId,
          action: 'CLEAR',
          displayName: null,
          changedByUserId: numericUserId(auth.user.id),
          createdAt: t,
        });
        notify();
        return new HttpResponse(null, { status: 204 });
      }),
      http.put('*/api/people/:worldId/display-name', async ({ request, params }) => {
        const t = now();
        const auth = requireAdmin(request, t);
        if ('error' in auth) return auth.error;
        const worldId = String(params['worldId'] ?? '').trim();
        if (!worldId) {
          return problem(400, 'INVALID_DISPLAY_NAME', '유효하지 않은 World ID 입니다.');
        }
        const raw = readDisplayNameBody(await request.json().catch(() => undefined));
        const checked = normalizeDisplayName(raw ?? '');
        if (!checked.ok) {
          return problem(400, 'INVALID_DISPLAY_NAME', checked.message);
        }
        const siteDate = seoulDateOf(t);
        const userId = numericUserId(auth.user.id);
        worldHistory.push({
          historyId: ++historySeq,
          siteDate,
          worldId,
          action: 'SET',
          displayName: checked.value,
          changedByUserId: userId,
          createdAt: t,
        });
        notify();
        return HttpResponse.json({
          world_id: worldId,
          site_id: MOCK_SITE_ID,
          site_date: siteDate,
          display_name: checked.value,
          name_source: 'WORLD_MANUAL',
          changed_by_user_id: userId,
          updated_at: t,
        });
      }),
      http.delete('*/api/people/:worldId/display-name', ({ request, params }) => {
        const t = now();
        const auth = requireAdmin(request, t);
        if ('error' in auth) return auth.error;
        const worldId = String(params['worldId'] ?? '').trim();
        if (!worldId) {
          return problem(400, 'INVALID_DISPLAY_NAME', '유효하지 않은 World ID 입니다.');
        }
        worldHistory.push({
          historyId: ++historySeq,
          siteDate: seoulDateOf(t),
          worldId,
          action: 'CLEAR',
          displayName: null,
          changedByUserId: numericUserId(auth.user.id),
          createdAt: t,
        });
        notify();
        return new HttpResponse(null, { status: 204 });
      }),
    ],
  };
}

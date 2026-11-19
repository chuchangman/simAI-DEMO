import { createSetupSession, requestSetupZonePlan } from '@/features/setup/api';
import { draftZoneFootprint } from '@/features/setup/draftZone';
import { resetSetupFlowStore, useSetupFlowStore } from '@/features/setup/setup.store';
import {
  applyCommitToPlan,
  confirmPlanItems,
  confirmUnchangedPlanItems,
  liveZonesAsItems,
  OPINION_PENDING_REFETCH_MS,
  pendingReviewCount,
  planRefetchIntervalMs,
  planZonesView,
  removePlanItem,
  SETUP_NEW_ZONE_PREFIX,
  SetupZonePlanEditError,
  toPlanRequestItems,
  unchangedPendingReviewCount,
  type SetupZonePlanItem,
  type SetupZonePlanView,
} from '@/features/setup/setupZonePlan';
import { reviewOrder } from '@/features/setup/SetupZoneReviewCard';
import {
  zoneDraftItemSchema,
  type SetupSessionResponse,
  type ZoneDraftItem,
} from '@/features/setup/types';
import {
  useImportPreviousZones,
  useSeedSetupZonePlan,
} from '@/features/setup/useSeedSetupZonePlan';
import { useSetupSession } from '@/features/setup/useSetupStep1';
import { useSetupZonePlanQuery } from '@/features/setup/useSetupZonePlan';
import { useSetupZoneReview } from '@/features/setup/useSetupZoneReview';
import {
  pairDraftsWithCarried,
  sameZoneSpot,
  type ZoneFootprint,
} from '@/features/setup/zoneOverlap';
import { commitErrorText } from '@/features/zones/commitErrors';
import type { Zone } from '@/features/zones/types';
import { useZoneCommitMutation } from '@/features/zones/useZoneCommitMutation';
import { useZones } from '@/features/zones/useZones';
import { bodyOf, formOf } from '@/features/zones/zoneForm';
import { readZones, toViewerZones } from '@/features/zones/zones';
import { ZoneSourceContext } from '@/features/zones/zoneSource';
import { api } from '@/lib/api';
import { problem } from '@/mocks/problem';
import { buildDefaultZoneDraftItems, createSetupMock } from '@/mocks/setup';
import { createZonesMock, MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 세팅 구역 단계의 구역 저장(S15P31A101-615): 관제 구역(zones/commit) 대신 세션 구역 목록(-612 PUT)에 저장하고, 화면 목록도
// 그 목록 기준이다. 재사용은 서버 seed 로 지금 관제 구역을 그대로 채운다. 새 모델은 이전 구역을 기본으로 이어 오지 않고, World
// 이어짐이면 「이전 구역 불러오기」로만 확인 필요로 더한다(S15P31A101-629, -758). World 가 끊긴 새 모델은 빈 목록에서 시작한다.
// 아직 고르지 않은 AI 초안과 같은 자리인 이어 온 구역은 한 항목으로 묶어 둘 중 하나만 남긴다(-758). 충돌(revision)은 다시 받는다.

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

const server = setupServer();
let setupMock: ReturnType<typeof createSetupMock>;
let requests: string[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetSetupFlowStore();
  setupMock = createSetupMock({ now: () => 1_800_000_000_000 });
  const zonesMock = createZonesMock();
  setupMock.bindLiveZones(() => zonesMock.currentZones());
  server.resetHandlers(...zonesMock.handlers, ...setupMock.handlers);
  requests = [];
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});

const z04 = readZones(MOCK_ZONES)[0]!;
const body = (name: string) => bodyOf(z04, { ...formOf(z04), name }, null);
const emptyPlan: SetupZonePlanView = { setup_session_id: 's', items: [], revision: 0 };

async function readySession(patch: Partial<SetupSessionResponse> = {}): Promise<string> {
  const created = await createSetupSession(api, {
    work_unit_id: 1,
    camera_heights_m: { cam_A: 2.4 },
  });
  setupMock.updateSession(created.setup_session_id, {
    status: 'READY_FOR_ZONES',
    stage: 'READY_FOR_ZONES',
    preview_scene_version: 'scene-preview-1',
    calibration_version: 'cal-1',
    ...patch,
  });
  return created.setup_session_id;
}

function wrapperFor(sessionId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ZoneSourceContext value={{ sessionId }}>{children}</ZoneSourceContext>
    </QueryClientProvider>
  );
}

describe('목록 계산', () => {
  it('만들기는 새 항목, 새 버전은 본문 바꾸기, 보관은 항목 빼기이고 화면 ID 는 이어 쓰는 zone_id 또는 임시 ID 다', () => {
    const created = applyCommitToPlan(
      emptyPlan,
      MOCK_ZONES,
      { zone: { op: 'CREATE', body: body('새 구역') } },
      {
        source: 'AI',
        candidateId: 'cand-1',
      },
    );
    expect(created.items).toEqual([
      {
        zone_id: null,
        source: 'AI',
        candidate_id: 'cand-1',
        zone: body('새 구역'),
        surface: null,
        needs_review: false,
      },
    ]);
    expect(created.result.zone_id).toBe(`${SETUP_NEW_ZONE_PREFIX}0`);
    expect(created.result.zone?.name).toBe('새 구역');

    const plan: SetupZonePlanView = {
      ...emptyPlan,
      items: [...liveZonesAsItems(MOCK_ZONES), ...created.items],
    };
    const updated = applyCommitToPlan(plan, MOCK_ZONES, {
      zone: { op: 'UPDATE', zone_id: 'z-04', body: body('바꾼 이름') },
    });
    expect(updated.items.find((i) => i.zone_id === 'z-04')?.zone?.name).toBe('바꾼 이름');
    const view = planZonesView({ ...plan, items: updated.items }, MOCK_ZONES);
    expect(view.find((z) => z.zone_id === 'z-04')).toMatchObject({
      name: '바꾼 이름',
      zone_version: 1,
    });
    expect(view).toHaveLength(plan.items.length);

    const newId = `${SETUP_NEW_ZONE_PREFIX}${plan.items.length - 1}`;
    const archived = applyCommitToPlan(plan, MOCK_ZONES, {
      zone: { op: 'ARCHIVE', zone_id: newId },
    });
    expect(archived.items).toHaveLength(plan.items.length - 1);
    expect(() =>
      applyCommitToPlan(emptyPlan, MOCK_ZONES, { zone: { op: 'ARCHIVE', zone_id: 'z-none' } }),
    ).toThrow(SetupZonePlanEditError);
  });

  it('지금 관제 구역을 가져올 때 이미 목록에 있는 구역은 빼고 본문 없이(그대로 두기) 넣는다', () => {
    const items = liveZonesAsItems(MOCK_ZONES, [
      {
        zone_id: 'z-04',
        source: 'MANUAL',
        candidate_id: null,
        zone: null,
        surface: null,
        needs_review: false,
      },
    ]);
    expect(items.some((i) => i.zone_id === 'z-04')).toBe(false);
    expect(items.every((i) => i.zone === null && i.source === 'MANUAL')).toBe(true);
  });
});

describe('확인 필요(S15P31A101-629)', () => {
  const pending = (zoneId: string): SetupZonePlanItem => ({
    zone_id: zoneId,
    source: 'MANUAL',
    candidate_id: null,
    zone: null,
    surface: null,
    needs_review: true,
  });
  const liveIds = readZones(MOCK_ZONES).map((z) => z.zoneId);
  const reviewPlan: SetupZonePlanView = { ...emptyPlan, items: liveIds.map(pending) };

  it('확인 필요 항목은 화면 구역·3D 입력에 needs_review 로 실리고 개수를 센다', () => {
    expect(pendingReviewCount(reviewPlan)).toBe(liveIds.length);
    expect(pendingReviewCount(undefined)).toBe(0);
    const zones = readZones(planZonesView(reviewPlan, MOCK_ZONES));
    expect(zones.every((z) => z.needsReview === true)).toBe(true);
    expect(toViewerZones(zones).every((z) => z.needs_review === true)).toBe(true);
    // 관제 구역은 확인 표시가 없다
    expect(readZones(MOCK_ZONES).some((z) => z.needsReview)).toBe(false);
    expect(toViewerZones(readZones(MOCK_ZONES)).some((z) => 'needs_review' in z)).toBe(false);
  });

  it('하나 확인·모두 확인·빼기는 목록을 고치고 바뀐 것이 없으면 null 이다', () => {
    const [first, second] = liveIds as [string, string];
    const one = confirmPlanItems(reviewPlan.items, [first])!;
    expect(one.find((i) => i.zone_id === first)?.needs_review).toBe(false);
    expect(one.find((i) => i.zone_id === second)?.needs_review).toBe(true);
    const all = confirmPlanItems(one)!;
    expect(all.every((i) => !i.needs_review)).toBe(true);
    expect(confirmPlanItems(all)).toBeNull();
    expect(removePlanItem(reviewPlan.items, first)?.map((i) => i.zone_id)).not.toContain(first);
    expect(removePlanItem(reviewPlan.items, 'z-none')).toBeNull();
  });

  it('구역 편집으로 고치면(새 버전) 확인한 것으로 바뀐다', () => {
    const [first] = liveIds as [string];
    const updated = applyCommitToPlan(reviewPlan, MOCK_ZONES, {
      zone: { op: 'UPDATE', zone_id: first, body: body('고친 구역') },
    });
    expect(updated.items.find((i) => i.zone_id === first)?.needs_review).toBe(false);
    expect(pendingReviewCount({ ...reviewPlan, items: updated.items })).toBe(liveIds.length - 1);
  });

  it('높이 차이 판정(S15P31A101-630): 변경 의심을 먼저 정렬하고 변화 없음만 일괄 확인하며 모름·변경 의심은 남겨 둔다', () => {
    const [first, second] = liveIds as [string, string];
    const thirdZone = {
      ...(MOCK_ZONES[0] as Record<string, unknown>),
      zone_id: 'z-06',
      name: '추가 구역',
    };
    const threeZones = [...MOCK_ZONES, thirdZone];
    const planWithHeight: SetupZonePlanView = {
      ...emptyPlan,
      items: [
        {
          ...pending(first),
          height_change: {
            zone_id: first,
            status: 'UNCHANGED',
            reason: null,
            changed_area_ratio: 0,
            max_height_diff_m: 0.02,
            max_diff_xy: [1, 1],
            total_cells: 50,
            compared_cells: 50,
            changed_cells: 0,
          },
        },
        {
          ...pending(second),
          height_change: {
            zone_id: second,
            status: 'UNKNOWN',
            reason: 'INSUFFICIENT_COVERAGE',
            changed_area_ratio: null,
            max_height_diff_m: null,
            max_diff_xy: null,
            total_cells: 50,
            compared_cells: 5,
            changed_cells: null,
          },
        },
        {
          ...pending('z-06'),
          height_change: {
            zone_id: 'z-06',
            status: 'CHANGE_SUSPECTED',
            reason: null,
            changed_area_ratio: 0.32,
            max_height_diff_m: 0.35,
            max_diff_xy: [2, 2],
            total_cells: 50,
            compared_cells: 50,
            changed_cells: 16,
          },
        },
      ],
    };

    expect(unchangedPendingReviewCount(planWithHeight)).toBe(1);
    const ordered = reviewOrder(readZones(planZonesView(planWithHeight, threeZones)));
    expect(ordered.map((z) => z.zoneId)).toEqual(['z-06', second, first]);

    const afterUnchanged = confirmUnchangedPlanItems(planWithHeight.items)!;
    expect(afterUnchanged.find((i) => i.zone_id === first)?.needs_review).toBe(false);
    expect(afterUnchanged.find((i) => i.zone_id === second)?.needs_review).toBe(true);
    expect(afterUnchanged.find((i) => i.zone_id === 'z-06')?.needs_review).toBe(true);
    expect(confirmUnchangedPlanItems(afterUnchanged)).toBeNull();
  });

  it('AI 의견(S15P31A101-631): 화면 구역에 의견을 싣고, 대기 중이면 짧게·사진 주소가 끝나기 전에 목록을 다시 받으며 저장 본문에는 보내지 않는다', () => {
    const [first, second] = liveIds as [string, string];
    const now = 1_000_000;
    const box: [number, number, number, number] = [0.1, 0.1, 0.5, 0.5];
    const opinion = {
      status: 'OPINION' as const,
      reason: null,
      recommended_action: 'MODIFY' as const,
      rationale: '단상이 옮겨졌습니다.',
      confidence: 0.6,
      camera_id: 'cam_A',
      before: { image_url: 'https://s/b.jpg', crop_box_norm: box },
      after: { image_url: 'https://s/a.jpg', crop_box_norm: box },
      image_expires_at_ms: now + 300_000,
    };
    const plan: SetupZonePlanView = {
      ...emptyPlan,
      items: [{ ...pending(first), ai_opinion: opinion }, pending(second)],
    };
    const zones = readZones(planZonesView(plan, MOCK_ZONES));
    expect(zones.find((z) => z.zoneId === first)?.aiOpinion?.recommended_action).toBe('MODIFY');
    expect(zones.find((z) => z.zoneId === second)?.aiOpinion).toBeUndefined();

    expect(planRefetchIntervalMs(plan, now)).toBe(300_000 - 30_000);
    const waiting: SetupZonePlanView = {
      ...plan,
      items: [{ ...pending(first), ai_opinion: { ...opinion, status: 'PENDING' } }],
    };
    expect(planRefetchIntervalMs(waiting, now)).toBe(OPINION_PENDING_REFETCH_MS);
    expect(planRefetchIntervalMs(emptyPlan, now)).toBe(false);
    expect(planRefetchIntervalMs(undefined, now)).toBe(false);

    const body = toPlanRequestItems(plan.items);
    expect(body.every((item) => !('ai_opinion' in item))).toBe(true);
  });
});

describe('세팅 구역 단계의 저장', () => {
  it('구역 저장은 세션 구역 목록 PUT 으로 가고 zones/commit 은 부르지 않으며 화면 목록은 그 목록을 따른다', async () => {
    const sessionId = await readySession();
    const { result } = renderHook(() => ({ commit: useZoneCommitMutation(), zones: useZones() }), {
      wrapper: wrapperFor(sessionId),
    });
    await waitFor(() => expect(result.current.zones.raw).toEqual([]));

    let done: Awaited<ReturnType<typeof result.current.commit.mutateAsync>> | undefined;
    await act(async () => {
      done = await result.current.commit.mutateAsync({
        request: { zone: { op: 'CREATE', body: body('세팅 구역') } },
        zone: null,
        linked: null,
      });
    });
    expect(done?.publishError).toBeNull();
    expect(done?.result.zone_id).toBe(`${SETUP_NEW_ZONE_PREFIX}0`);
    expect(requests).toContain(`PUT /api/setup-sessions/${sessionId}/zones`);
    expect(requests.some((r) => r.endsWith('/api/zones/commit'))).toBe(false);
    expect(setupMock.zonePlans.get(sessionId)).toMatchObject({ revision: 1 });
    await waitFor(() =>
      expect(result.current.zones.zones.map((z) => z.name)).toEqual(['세팅 구역']),
    );
  });

  it('다른 곳에서 먼저 고쳤으면(revision) 409 를 안내하고 목록을 다시 받아 다음 저장은 새 revision 으로 간다', async () => {
    const sessionId = await readySession();
    const { result } = renderHook(() => ({ commit: useZoneCommitMutation(), zones: useZones() }), {
      wrapper: wrapperFor(sessionId),
    });
    await waitFor(() => expect(result.current.zones.raw).toEqual([]));
    // 다른 PC 가 먼저 저장했다
    setupMock.zonePlans.set(sessionId, {
      items: [{ zone_id: 'z-04', source: 'MANUAL', candidate_id: null, zone: null, surface: null }],
      revision: 3,
      updatedAt: 0,
    });
    let failure: unknown;
    await act(async () => {
      await result.current.commit
        .mutateAsync({
          request: { zone: { op: 'CREATE', body: body('늦은 저장') } },
          zone: null,
          linked: null,
        })
        .catch((e: unknown) => (failure = e));
    });
    expect(commitErrorText(failure)).toContain('다른 곳에서 먼저 고친 세팅 구역 목록');
    await waitFor(() => expect(result.current.zones.zones.map((z) => z.zoneId)).toEqual(['z-04']));

    await act(async () => {
      await result.current.commit.mutateAsync({
        request: { zone: { op: 'CREATE', body: body('다시 저장') } },
        zone: null,
        linked: null,
      });
    });
    expect(setupMock.zonePlans.get(sessionId)?.revision).toBe(4);
  });

  it('완료 뒤 저장은 409 SETUP_ZONES_CLOSED 로 막힌다', async () => {
    const sessionId = await readySession({ setup_completed_at_ms: 1 });
    const { result } = renderHook(() => useZoneCommitMutation(), {
      wrapper: wrapperFor(sessionId),
    });
    let failure: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({
          request: { zone: { op: 'CREATE', body: body('닫힘') } },
          zone: null,
          linked: null,
        })
        .catch((e: unknown) => (failure = e));
    });
    expect(commitErrorText(failure)).toContain('더 고칠 수 없습니다');
  });
});

describe('세팅 구역 목록 시드(useSeedSetupZonePlan)', () => {
  const plainWrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
  function seed(sessionId: string) {
    renderHook(
      () => {
        const session = useSetupSession(sessionId).data ?? null;
        useSeedSetupZonePlan(session);
      },
      { wrapper: plainWrapper() },
    );
  }
  const liveIds = () => readZones(MOCK_ZONES).map((z) => z.zoneId);
  const planRequests = (sessionId: string, method: string, path = '/zones') =>
    requests.filter((r) => r === `${method} /api/setup-sessions/${sessionId}${path}`);
  const seedRequests = (sessionId: string) => planRequests(sessionId, 'POST', '/zones/seed');
  const kept = (zoneId: string) => ({
    zone_id: zoneId,
    source: 'MANUAL' as const,
    candidate_id: null,
    zone: null,
    surface: null,
  });

  it('이전 모델 재사용은 빈 목록을 지금 관제 구역(zone_id 유지)으로 확인 표시 없이 한 번 채운다', async () => {
    const sessionId = await readySession({ mode: 'REUSE' });
    seed(sessionId);
    await waitFor(() => expect(setupMock.zonePlans.get(sessionId)?.revision).toBe(1));
    const plan = await requestSetupZonePlan(api, sessionId);
    expect(plan.items.map((i) => i.zone_id)).toEqual(liveIds());
    expect(plan.items.every((i) => i.zone === null && !i.needs_review)).toBe(true);
    expect(seedRequests(sessionId)).toHaveLength(1);
    expect(planRequests(sessionId, 'PUT')).toEqual([]);
  });

  it('새 모델은 World 가 이어져도 이전 구역을 기본으로 채우지 않는다(S15P31A101-758)', async () => {
    const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: true } });
    seed(sessionId);
    await waitFor(() => expect(planRequests(sessionId, 'GET')).toHaveLength(1));
    await act(async () => {});
    expect(seedRequests(sessionId)).toEqual([]);
    expect(setupMock.zonePlans.get(sessionId)).toBeUndefined();
  });

  it('이미 목록이 채워져 있으면 채우지 않는다', async () => {
    const sessionId = await readySession({ mode: 'REUSE' });
    setupMock.zonePlans.set(sessionId, { items: [kept('z-04')], revision: 3, updatedAt: 0 });
    seed(sessionId);
    await waitFor(() => expect(planRequests(sessionId, 'GET')).toHaveLength(1));
    await act(async () => {});
    expect(seedRequests(sessionId)).toEqual([]);
    expect(setupMock.zonePlans.get(sessionId)).toMatchObject({ revision: 3 });
  });

  it('World 가 끊긴 새 모델은 빈 목록에서 시작하고 지금 관제 구역을 가져오지 않는다', async () => {
    const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: false } });
    seed(sessionId);
    await waitFor(() => expect(planRequests(sessionId, 'GET')).toHaveLength(1));
    await act(async () => {});
    expect(seedRequests(sessionId)).toEqual([]);
    expect(setupMock.zonePlans.get(sessionId)).toBeUndefined();
  });

  it('세션이 없으면(구역 단계가 아니거나 이미 완료) 목록을 받지도 채우지도 않는다', async () => {
    await readySession({ mode: 'REUSE' });
    renderHook(() => useSeedSetupZonePlan(null), { wrapper: plainWrapper() });
    await act(async () => {});
    expect(requests.some((r) => r.includes('/zones'))).toBe(false);
  });

  it('채우다 실패하면 목록을 다시 받고 같은 세션에서 다시 시도하지 않는다', async () => {
    const sessionId = await readySession({ mode: 'REUSE' });
    server.use(
      http.post('*/api/setup-sessions/:id/zones/seed', () =>
        problem(409, 'SETUP_ZONES_CLOSED', '세팅이 끝나 구역 목록을 고칠 수 없습니다'),
      ),
    );
    seed(sessionId);
    await waitFor(() => expect(seedRequests(sessionId)).toHaveLength(1));
    await waitFor(() => expect(planRequests(sessionId, 'GET')).toHaveLength(2));
    await act(async () => {});
    expect(seedRequests(sessionId)).toHaveLength(1);
  });
});

describe('이전 구역 불러오기(useImportPreviousZones, S15P31A101-758)', () => {
  const plainWrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
  const importRequests = (sessionId: string) =>
    requests.filter((r) => r === `POST /api/setup-sessions/${sessionId}/zones/import-previous`);
  function importer(sessionId: string) {
    return renderHook(
      () => ({
        importer: useImportPreviousZones(sessionId),
        plan: useSetupZonePlanQuery(sessionId),
      }),
      { wrapper: plainWrapper() },
    ).result;
  }

  it('새 모델 + World 이어짐은 누를 때만 지금 관제 구역을 확인 필요로 더하고, 다시 누르면 더할 것이 없다', async () => {
    const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: true } });
    const result = importer(sessionId);
    await waitFor(() => expect(result.current.plan.data?.items).toEqual([]));
    expect(result.current.importer.result).toBeNull();
    expect(importRequests(sessionId)).toEqual([]);

    act(() => result.current.importer.run());
    await waitFor(() => expect(result.current.importer.result).not.toBeNull());
    const liveIds = readZones(MOCK_ZONES).map((z) => z.zoneId);
    expect(result.current.importer.result).toEqual({ added: liveIds.length, skipped: [] });
    // 응답 목록으로 세션 목록을 바로 바꾼다
    expect(result.current.plan.data?.items.map((i) => i.zone_id)).toEqual(liveIds);
    expect(pendingReviewCount(result.current.plan.data)).toBe(liveIds.length);

    act(() => result.current.importer.run());
    await waitFor(() => expect(importRequests(sessionId)).toHaveLength(2));
    await waitFor(() => expect(result.current.importer.busy).toBe(false));
    expect(result.current.importer.result).toEqual({ added: 0, skipped: [] });
    expect(result.current.importer.error).toBeNull();
  });

  it('World 가 끊긴 새 모델은 불러오지 못하고(409) 실패 문구를 보인다', async () => {
    const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: false } });
    const result = importer(sessionId);
    act(() => result.current.importer.run());
    await waitFor(() => expect(result.current.importer.error).not.toBeNull());
    expect(result.current.importer.result).toBeNull();
    expect(setupMock.zonePlans.get(sessionId)).toBeUndefined();
  });

  it('서버가 AI 초안 구역과 같은 자리라 뺀 이름을 결과에 싣는다', async () => {
    const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: true } });
    server.use(
      http.post('*/api/setup-sessions/:id/zones/import-previous', () =>
        Response.json({
          setup_session_id: sessionId,
          items: [],
          revision: 0,
          import_skipped: ['동쪽 개구부'],
        }),
      ),
    );
    const result = importer(sessionId);
    act(() => result.current.importer.run());
    await waitFor(() =>
      expect(result.current.importer.result).toEqual({ added: 0, skipped: ['동쪽 개구부'] }),
    );
  });
});

describe('같은 자리 판정과 AI 초안 묶음(zoneOverlap, S15P31A101-758)', () => {
  const square = (x: number, y: number, size: number): [number, number][] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  const spot = (
    polygon: [number, number][],
    zMin: number | null = 0,
    zMax: number | null = 2,
  ): ZoneFootprint => ({ polygon, zMin, zMax });

  it('작은 쪽 면적의 절반 이상이 겹치고 크기·높이가 비슷해야 같은 자리다', () => {
    expect(sameZoneSpot(spot(square(0, 0, 2)), spot(square(0, 0, 2)))).toBe(true);
    // 절반 겹침(경계값)은 같은 자리, 그보다 덜 겹치면 다른 자리
    expect(sameZoneSpot(spot(square(0, 0, 2)), spot(square(1, 0, 2)))).toBe(true);
    expect(sameZoneSpot(spot(square(0, 0, 2)), spot(square(1.2, 0, 2)))).toBe(false);
    expect(sameZoneSpot(spot(square(0, 0, 2)), spot(square(5, 5, 2)))).toBe(false);
    // 넓은 구역 안에 든 작은 구역은 다른 구역이다
    expect(sameZoneSpot(spot(square(0, 0, 4)), spot(square(1, 1, 1)))).toBe(false);
    // 높이 범위가 겹치지 않으면 다른 자리, 높이가 없으면 겹친다고 본다
    expect(sameZoneSpot(spot(square(0, 0, 2), 0, 0.4), spot(square(0, 0, 2), 1, 2))).toBe(false);
    expect(sameZoneSpot(spot(square(0, 0, 2), null, null), spot(square(0, 0, 2), 1, 2))).toBe(true);
  });

  const [opening, surface] = buildDefaultZoneDraftItems().map((d) =>
    zoneDraftItemSchema.parse(d),
  ) as [ZoneDraftItem, ZoneDraftItem];
  const base = readZones(MOCK_ZONES)[0]!;
  const zoneAt = (zoneId: string, polygon: readonly (readonly [number, number])[]): Zone => ({
    ...base,
    zoneId,
    polygon,
    zBounds: [0, 2],
  });
  const openingSpot = draftZoneFootprint(opening).polygon;
  const shifted = openingSpot.map(([x, y]) => [x + 0.3, y] as const);

  it('초안 하나는 가장 많이 겹친 이어 온 구역 하나와만 묶고, 새로 그린 구역·먼 구역은 묶지 않는다', () => {
    const pairs = pairDraftsWithCarried(
      [opening, surface],
      [
        zoneAt('z-shifted', shifted),
        zoneAt('z-same', openingSpot),
        zoneAt(`${SETUP_NEW_ZONE_PREFIX}0`, openingSpot),
        zoneAt('z-far', square(20, 20, 1)),
      ],
    );
    expect([...pairs.keys()]).toEqual(['z-same']);
    expect(pairs.get('z-same')?.candidate_id).toBe(opening.candidate_id);
    expect(pairDraftsWithCarried([], [zoneAt('z-same', openingSpot)]).size).toBe(0);
  });

  describe('묶인 항목에서 하나만 남기기(useSetupZoneReview)', () => {
    const carriedItem = (zoneId: string): SetupZonePlanItem => ({
      zone_id: zoneId,
      source: 'MANUAL',
      candidate_id: null,
      zone: null,
      surface: null,
      needs_review: true,
    });
    async function pairedSession() {
      const sessionId = await readySession({ mode: 'NEW', world_anchor: { accepted: true } });
      setupMock.zonePlans.set(sessionId, {
        items: [carriedItem('z-04'), carriedItem('z-02')],
        revision: 1,
        updatedAt: 0,
      });
      const result = renderHook(
        () => ({ review: useSetupZoneReview(sessionId), plan: useSetupZonePlanQuery(sessionId) }),
        { wrapper: wrapperFor(sessionId) },
      ).result;
      await waitFor(() => expect(result.current.plan.data?.items).toHaveLength(2));
      return { sessionId, result };
    }
    const storedItems = (sessionId: string) =>
      (setupMock.zonePlans.get(sessionId)?.items ?? []) as SetupZonePlanItem[];

    it('「이전 것 유지」는 그 구역을 확인하고 초안을 버린다', async () => {
      const { sessionId, result } = await pairedSession();
      act(() => result.current.review.keepCarried('z-04', opening.candidate_id));
      await waitFor(() =>
        expect(useSetupFlowStore.getState().discardedDraftIds).toEqual([opening.candidate_id]),
      );
      const items = storedItems(sessionId);
      expect(items.find((i) => i.zone_id === 'z-04')?.needs_review).toBe(false);
      expect(items.find((i) => i.zone_id === 'z-02')?.needs_review).toBe(true);
      expect(useSetupFlowStore.getState().acceptedDraftIds).toEqual([]);
    });

    it('「AI 초안으로」는 저장 한 번으로 이어 온 구역을 빼고 초안 구역을 더하며 초안을 수락한 것으로 남긴다', async () => {
      const { sessionId, result } = await pairedSession();
      act(() =>
        result.current.review.replaceWithDraft('z-04', opening, readZones(MOCK_ZONES).slice(1)),
      );
      await waitFor(() =>
        expect(useSetupFlowStore.getState().acceptedDraftIds).toEqual([opening.candidate_id]),
      );
      expect(
        requests.filter((r) => r === `PUT /api/setup-sessions/${sessionId}/zones`),
      ).toHaveLength(1);
      const items = storedItems(sessionId);
      expect(items.map((i) => i.zone_id ?? null)).toEqual(['z-02', null]);
      expect(items[1]).toMatchObject({ source: 'AI', candidate_id: opening.candidate_id });
      expect(items[1]?.needs_review ?? false).toBe(false);
      expect(items[1]?.zone?.name).toBe(opening.recommended_name);
    });
  });
});

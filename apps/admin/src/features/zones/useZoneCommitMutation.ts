import {
  requestSetupZonePlan,
  saveSetupZonePlan,
  setupSessionKey,
  setupZonePlanKey,
} from '@/features/setup/api';
import { markSetupZonesCommitted } from '@/features/setup/setup.store';
import { applyCommitToPlan, type PlanItemOrigin } from '@/features/setup/setupZonePlan';
import type { SetupLayoutSync } from '@/features/setup/useSetupLayoutSync';
import { requestStaticObjects, STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import type { WorkSurface } from '@/features/surfaces/types';
import { commitZone, requestZones, ZONES_KEY } from '@/features/zones/api';
import {
  applyCommitted,
  invalidateCommitted,
  SURFACE_ID_FIELD,
  ZONE_ID_FIELD,
} from '@/features/zones/commitCache';
import { CommitBlockedError, CommitInFlightError } from '@/features/zones/commitErrors';
import type { Zone, ZoneCommitRequest, ZoneCommitResult } from '@/features/zones/types';
import { useZoneSource, type SetupZoneSource } from '@/features/zones/zoneSource';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { fieldOf, needsRefetch } from '@/lib/writeFailure';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback } from 'react';

/** 저장 mutation 키. */
const COMMIT_MUTATION_KEY = [...ZONES_KEY, 'commit'] as const;

/**
 * 지금 저장을 보내고 있는 화면(QueryClient). 14차 로비에서 같은 새 구역이 2.3 s 간격으로 두 번 만들어졌다(cfg-67·68). 저장 단추마다
 * 한 번에 하나만 보내지만(useExclusiveRun) 훅 인스턴스가 다르면(관제 편집 패널·세팅 초안 수락·구역 목록 이름 바꾸기) 서로 모르므로,
 * 화면 단위로 한 번 더 막는다.
 */
const committing = new WeakSet<QueryClient>();

/** 서버가 구성 묶음을 만들지 못해 구역·작업면 저장까지 모두 되돌린 오류 이름(ProblemDetail code). */
const BUNDLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'CURRENT_CALIBRATION_MISSING',
  'CALIBRATION_MISSING',
  'RULES_MISSING',
  'PUBLIC_URL_NOT_SET',
]);

/** 저장 직전에 서버의 지금 버전을 확인할 목록(구역·작업면). */
interface VersionedList {
  target: CommitBlockedError['target'];
  key: QueryKey;
  load: (signal?: AbortSignal) => Promise<unknown[]>;
  idField: string;
  versionField: string;
}

const ZONE_LIST: VersionedList = {
  target: 'zone',
  key: ZONES_KEY,
  load: (signal) => requestZones(api, signal),
  idField: ZONE_ID_FIELD,
  versionField: 'zone_version',
};

const SURFACE_LIST: VersionedList = {
  target: 'surface',
  key: STATIC_OBJECTS_KEY,
  load: (signal) => requestStaticObjects(api, signal),
  idField: SURFACE_ID_FIELD,
  versionField: 'object_version',
};

/**
 * 서버는 고치기 시작한 버전을 받지 않고 기록을 통째로 바꾼다. 그 사이 다른 관리자가 새 버전을 저장했으면 그 변경을
 * 덮지 않도록 보내기 전에 지금 버전을 다시 받아 보고 멈춘다(받은 목록은 화면에 들어간다). 같은 순간 부딪친 저장은 서버가 409 로 막는다.
 */
async function assertNotChanged(
  queryClient: QueryClient,
  list: VersionedList,
  id: string,
  version: number,
) {
  const latest = await queryClient
    .fetchQuery({
      queryKey: list.key,
      queryFn: ({ signal }) => list.load(signal),
      staleTime: 0,
    })
    .catch((cause: unknown) => {
      throw new CommitBlockedError(list.target, 'UNCHECKED', { cause });
    });
  const current = fieldOf(
    latest.find((item) => fieldOf(item, list.idField) === id),
    list.versionField,
  );
  if (typeof current === 'number' && current !== version) {
    throw new CommitBlockedError(list.target, 'CHANGED');
  }
}

export interface CommitInput {
  request: ZoneCommitRequest;
  /** 고치기 시작한 구역(새 구역이면 null)과 이은 작업면. 요청이 덮거나 보관하는 것만 버전을 맞춰 본다. */
  zone: Zone | null;
  linked: WorkSurface | null;
  /** 세팅 구역 목록에 새 항목으로 넣을 때의 출처(AI 초안 수락). 없으면 MANUAL. */
  origin?: PlanItemOrigin;
}

/** 요청이 덮거나 보관하는 구역·작업면의 버전을 서버의 지금 버전과 맞춰 본다(KEEP·CREATE 는 덮지 않는다). */
async function assertUnchanged(queryClient: QueryClient, { request, zone, linked }: CommitInput) {
  const zoneOp = request.zone.op;
  const checks: Promise<void>[] = [];
  if (zone && (zoneOp === 'UPDATE' || zoneOp === 'ARCHIVE')) {
    checks.push(assertNotChanged(queryClient, ZONE_LIST, zone.zoneId, zone.version));
  }
  if (linked && request.surface && request.surface.op !== 'CREATE') {
    checks.push(assertNotChanged(queryClient, SURFACE_LIST, linked.objectId, linked.version));
  }
  await Promise.all(checks);
}

export interface CommitDone {
  result: ZoneCommitResult;
  /** 묶음을 만들지 못해 저장만 한 경우의 오류. 묶음까지 만들었으면 null. */
  publishError: ApiError | null;
}

/**
 * 구성 묶음까지 한 번에 보낸다. 묶음을 만들 수 없는 현장(보정 문서 없음, 공개 주소 미설정)에서는 서버가 구역·작업면 저장도
 * 되돌리므로, 같은 본문을 묶음 없이(publish: false) 한 번 더 보내 저장만 한다.
 */
async function send(request: ZoneCommitRequest): Promise<CommitDone> {
  try {
    return { result: await commitZone(api, { ...request, publish: true }), publishError: null };
  } catch (error) {
    if (!(error instanceof ApiError) || !BUNDLE_FAILURE_CODES.has(error.code ?? '')) throw error;
    return { result: await commitZone(api, { ...request, publish: false }), publishError: error };
  }
}

/** 세팅 구역 목록에서 다시 받아야 하는 저장 실패: 다른 곳에서 먼저 고침(revision), 세팅 완료·작업 시작으로 닫힘. */
const PLAN_REFETCH_CODES: ReadonlySet<string> = new Set([
  'SETUP_ZONE_PLAN_CONFLICT',
  'SETUP_ZONES_CLOSED',
]);

/**
 * 세팅 구역 단계(-615): 관제 구역을 바꾸지 않고 세션 구역 목록을 고쳐 통째로 저장한다(PUT, revision 낙관적 잠금).
 * 마지막으로 읽은 목록(없으면 지금 받은 목록)에 요청을 적용한다. 화면이 같은 모양으로 다룰 수 있게 zones/commit 응답 모양을 돌려준다.
 */
async function saveToPlan(
  queryClient: QueryClient,
  source: SetupZoneSource,
  input: CommitInput,
): Promise<CommitDone> {
  const key = setupZonePlanKey(source.sessionId);
  const plan = await queryClient.ensureQueryData({
    queryKey: key,
    queryFn: ({ signal }) => requestSetupZonePlan(api, source.sessionId, signal),
  });
  const liveZones = queryClient.getQueryData<unknown[]>(ZONES_KEY);
  const { items, result } = applyCommitToPlan(plan, liveZones, input.request, input.origin);
  const saved = await saveSetupZonePlan(api, source.sessionId, items, plan.revision);
  queryClient.setQueryData(key, saved);
  return { result, publishError: null };
}

/**
 * 구역·작업면 저장을 요청 하나로 보낸다(POST /api/zones/commit). 서버가 한 트랜잭션으로 처리해 실패하면 아무것도 바뀌지
 * 않는다. 낙관적 갱신을 하지 않고 응답(새 버전·묶음)으로 목록을 바꾼다(CONVENTION). 결과를 알 수 없는 실패(연결 끊김·시간
 * 초과·응답 오류·서버 오류)면 이미 저장됐을 수 있어 세 목록을 다시 받는다.
 */
export function useZoneCommitMutation(
  setup?: SetupLayoutSync,
  explicitSource?: SetupZoneSource | null,
) {
  const queryClient = useQueryClient();
  const planSource = useZoneSource(explicitSource);
  const mutation = useMutation({
    mutationKey: COMMIT_MUTATION_KEY,
    mutationFn: async (input: CommitInput): Promise<CommitDone> => {
      if (planSource) return saveToPlan(queryClient, planSource, input);
      await assertUnchanged(queryClient, input);
      const request =
        setup && input.request.zone.op === 'CREATE'
          ? { ...input.request, setup_session_id: setup.sessionId }
          : input.request;
      return send(request);
    },
    onSuccess: async ({ result, publishError }, { request }) => {
      if (planSource) {
        // 세션 목록은 저장 응답으로 이미 바꿨다. 관제 구역·묶음·레이아웃은 세팅 완료 때 바뀐다
        markSetupZonesCommitted();
        return;
      }
      applyCommitted(queryClient, request, result);
      if (!publishError) {
        markSetupZonesCommitted();
        if (setup && request.zone.op !== 'ARCHIVE')
          await setup.sync(result.zone_id, request.zone.op !== 'CREATE');
      }
    },
    onError: (error) => {
      if (planSource) {
        if (error instanceof ApiError && PLAN_REFETCH_CODES.has(error.code ?? '')) {
          void queryClient.invalidateQueries({ queryKey: setupZonePlanKey(planSource.sessionId) });
          // 닫혔으면(세팅 완료) 세션을 다시 받아 편집을 끈다
          void queryClient.invalidateQueries({ queryKey: setupSessionKey(planSource.sessionId) });
        }
        return;
      }
      if (needsRefetch(error)) invalidateCommitted(queryClient);
    },
  });
  const mutate = mutation.mutateAsync;
  /** 앞 저장이 끝나지 않았으면 보내지 않고 CommitInFlightError 를 던진다(받은 쪽은 알림 없이 무시한다). */
  const mutateAsync = useCallback(
    async (input: CommitInput): Promise<CommitDone> => {
      if (committing.has(queryClient)) throw new CommitInFlightError();
      committing.add(queryClient);
      try {
        return await mutate(input);
      } finally {
        committing.delete(queryClient);
      }
    },
    [queryClient, mutate],
  );
  return { ...mutation, mutateAsync };
}

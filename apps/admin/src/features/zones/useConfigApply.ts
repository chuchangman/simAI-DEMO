import { markSetupZonesCommitted } from '@/features/setup/setup.store';
import type { WorkSurface } from '@/features/surfaces/types';
import { BUNDLES_KEY, publishBundle, ZONES_KEY } from '@/features/zones/api';
import { putBundle } from '@/features/zones/commitCache';
import type { BundleItem, ConfigBundle, Zone } from '@/features/zones/types';
import { useRecentBundles } from '@/features/zones/useRecentBundles';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { HTTP_FORBIDDEN } from '@/lib/writeFailure';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

export { readBundles } from '@/features/zones/useRecentBundles';

/** 발행 mutation 키. */
const PUBLISH_MUTATION_KEY = [...BUNDLES_KEY, 'publish'] as const;

/** 저장은 했지만 구성 묶음을 현장으로 보내지 못했을 때의 문구(다시 보내기 버튼과 함께 보인다). */
export const UNPUBLISHED_TEXT = '반영했지만 현장 판정으로 보내지 못했습니다.';

const FORBIDDEN_TEXT = '현장에 반영할 권한이 없습니다.';
const FALLBACK_TEXT = '현장에 반영하지 못했습니다. 다시 시도하세요.';

/** 서버가 정한 오류 이름(ProblemDetail code)별 발행 실패 안내. */
const CODE_TEXT = new Map<string, string>([
  ['CALIBRATION_MISSING', '보정 문서가 없어 현장에 반영할 수 없습니다.'],
  ['CURRENT_CALIBRATION_MISSING', '유효한 보정 문서가 없어 현장에 반영할 수 없습니다.'],
  ['RULES_MISSING', '유효한 규칙 버전이 없어 현장에 반영할 수 없습니다.'],
  ['SITE_NOT_SINGLE', '현장이 하나로 정해지지 않아 현장에 반영할 수 없습니다.'],
  ['PUBLIC_URL_NOT_SET', '서버 공개 주소가 설정되지 않아 현장에 반영할 수 없습니다.'],
]);

/**
 * 발행 실패 문구. 이유(서버 오류 코드)와 보내지 못했다는 것만 말한다. 연결 실패·시간 초과·그 밖의 오류는 한 문구다.
 * 서버가 자체 문구를 줘도 보이지 않는다(서버 내부 정보가 섞일 수 있다).
 */
export function publishErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return FALLBACK_TEXT;
  if (error.status === HTTP_FORBIDDEN) return FORBIDDEN_TEXT;
  return CODE_TEXT.get(error.code ?? '') ?? FALLBACK_TEXT;
}

/** 발행 전 판단에 쓰는 작업면 칸(features/surfaces 의 WorkSurface). */
export type PublishableSurface = Pick<WorkSurface, 'objectId' | 'version'>;

/**
 * 발행 전 판단의 공통 규칙(구역·작업면). 마지막 묶음의 항목(items)에 같은 종류·같은 ID·같은 버전이 있으면 발행한 것이고,
 * 없으면(새로 만들었거나 새 버전을 저장했다) 발행 전이다. 묶음이 없으면(null) 모두 발행 전이고, 묶음 목록을 아직
 * 모르면(undefined) null 이다. 시각은 보지 않는다(서버가 발행 때 실은 항목이 기준이다).
 */
function unpublishedOf(
  entries: readonly { id: string; version: number }[],
  itemType: BundleItem['item_type'],
  latest: ConfigBundle | null | undefined,
): Set<string> | null {
  if (latest === undefined) return null;
  const published = new Set(
    (latest?.items ?? [])
      .filter((item) => item.item_type === itemType)
      .map((item) => `${item.item_version}:${item.item_id}`),
  );
  return new Set(entries.filter((e) => !published.has(`${e.version}:${e.id}`)).map((e) => e.id));
}

/** 마지막 묶음에 이 버전이 실리지 않은 구역 ID(발행 전). 묶음이 없으면 모두, 묶음 목록을 모르면 null. */
export function unpublishedZoneIds(
  zones: readonly Pick<Zone, 'zoneId' | 'version'>[],
  latest: ConfigBundle | null | undefined,
): Set<string> | null {
  return unpublishedOf(
    zones.map((z) => ({ id: z.zoneId, version: z.version })),
    'ZONE',
    latest,
  );
}

/** 마지막 묶음에 이 버전이 실리지 않은 작업면 ID(발행 전). 묶음이 없으면 모두, 묶음 목록을 모르면 null. */
export function unpublishedSurfaceIds(
  surfaces: readonly PublishableSurface[],
  latest: ConfigBundle | null | undefined,
): Set<string> | null {
  return unpublishedOf(
    surfaces.map((s) => ({ id: s.objectId, version: s.version })),
    'STATIC_OBJECT',
    latest,
  );
}

/**
 * 마지막 묶음에는 실렸지만 지금 목록에는 없는 구역·작업면 수(묶음 뒤에 보관해 다음 발행에서 빠질 것). 현장은 다음 발행
 * 전까지 그 항목을 그대로 쓴다. 묶음을 모르거나(undefined) 없으면(null) 0 이다. 작업면 목록을 모르면(undefined) 작업면은
 * 세지 않는다. 장애물(OBSTACLE)은 작업면 목록에 없으므로 세지 않는다(kind 가 없으면 작업면으로 본다). 목록은 받은 뒤의
 * 것이어야 한다(받기 전의 빈 목록은 전부 보관된 것으로 센다).
 */
export function removedItemCount(
  zones: readonly Pick<Zone, 'zoneId'>[],
  surfaces: readonly Pick<WorkSurface, 'objectId'>[] | undefined,
  latest: ConfigBundle | null | undefined,
): number {
  if (!latest) return 0;
  const zoneIds = new Set(zones.map((z) => z.zoneId));
  const surfaceIds = surfaces && new Set(surfaces.map((s) => s.objectId));
  return latest.items.filter((item) => {
    if (item.item_type === 'ZONE') return !zoneIds.has(item.item_id);
    if (item.item_type !== 'STATIC_OBJECT' || surfaceIds === undefined) return false;
    return (item.kind ?? 'WORK_SURFACE') === 'WORK_SURFACE' && !surfaceIds.has(item.item_id);
  }).length;
}

/** 구성 묶음 발행(POST /api/config-bundles). 응답(새 묶음, 적용 대기)은 묶음 목록 맨 앞에 넣는다. */
export function usePublishBundle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PUBLISH_MUTATION_KEY,
    mutationFn: () => publishBundle(api),
    onSuccess: (bundle) => {
      putBundle(queryClient, bundle);
      markSetupZonesCommitted();
    },
  });
}

/**
 * 현장 적용 상태와 발행. 상태는 최근 묶음 목록(GET /api/config-bundles)의 첫 묶음으로 보이고, 적용 대기 동안 다시 받는다.
 * 발행 응답(새 묶음, 적용 대기)은 목록 맨 앞에 넣는다(응답 뒤에 그린다, 낙관적 갱신 아님).
 * 발행 전은 마지막 묶음의 항목(items)에 그 ID·버전이 없는 구역(unpublished)·작업면(unpublishedSurfaces)이고, removed 는 묶음에는
 * 있지만 이미 보관한 구역·작업면 수다(발행하면 현장에서도 빠진다). surfaces 는 구역·작업면 발행이 함께 나가므로 주면 따로 센다.
 * 모르면(undefined) 작업면은 세지 않아 발행을 막지 않는다. 작업면 목록은 이 훅이 받지 않는다(작업면 화면이 받는다).
 */
export function useConfigApply(zones: readonly Zone[], surfaces?: readonly PublishableSurface[]) {
  const queryClient = useQueryClient();
  // 구역 목록은 로그인마다 한 번만 받는다. 다른 관리자가 저장한 새 버전도 발행 전으로 보이게 화면에 들어올 때 다시 받는다
  // (이미 받는 중이면 그 응답을 쓴다).
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ZONES_KEY }, { cancelRefetch: false });
  }, [queryClient]);
  const query = useRecentBundles();
  const latest = query.data ? (query.data[0] ?? null) : undefined;
  const publish = usePublishBundle();
  const unpublished = useMemo(() => unpublishedZoneIds(zones, latest), [zones, latest]);
  const unpublishedSurfaces = useMemo(
    () => (surfaces === undefined ? null : unpublishedSurfaceIds(surfaces, latest)),
    [surfaces, latest],
  );
  const removed = useMemo(
    () => removedItemCount(zones, surfaces, latest),
    [zones, surfaces, latest],
  );
  // 발행 전 구역·작업면이나 보관해 묶음에서 빠질 항목이 있거나, 마지막 묶음이 거부·불일치라 현장이 이전 묶음을 쓰면
  // (다시) 발행할 수 있다. 묶음 목록을 모르면 막지 않는다.
  const canPublish =
    unpublished === null ||
    unpublished.size > 0 ||
    (unpublishedSurfaces?.size ?? 0) > 0 ||
    removed > 0 ||
    latest?.status === 'REJECTED' ||
    latest?.status === 'MISMATCH';
  return { latest, unpublished, unpublishedSurfaces, removed, canPublish, publish };
}

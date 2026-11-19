import type { SpatialViewMode } from '@/features/layout/spatialHost/useViewerMode';
import { useRequestedAt } from '@/features/layout/useRequestedAt';
import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { useStaticObjectsQuery } from '@/features/surfaces/useWorkSurfaces';
import type { ExternalSpatialSource, SnapshotPushOptions } from '@/features/viewer3d';
import { ZONES_KEY } from '@/features/zones/api';
import type { ViewerZones } from '@/features/zones/types';
import { useCallback, useEffect } from 'react';

/**
 * 형상 응답(구역·정적 객체)을 Source 에 넘길 때 다는 선택 정보. 조회를 시작한 시각이 있으면 늦은 응답을 거르게 달고,
 * 범위(scope)는 Source 가 범위를 정했을 때만 같은 값을 단다(lib/stomp 는 세션마다 Source 를 새로 만들어 범위가 없다).
 * 달 것이 없으면 undefined 라 옵션 없이 부른다.
 */
function snapshotOptions(
  source: ExternalSpatialSource,
  requestedAt: number | undefined,
): SnapshotPushOptions | undefined {
  const scope = source.scope ?? undefined;
  if (requestedAt === undefined && scope === undefined) return undefined;
  return {
    ...(requestedAt === undefined ? {} : { requestedAt }),
    ...(scope === undefined ? {} : { scope }),
  };
}

function pushSnapshot(
  source: ExternalSpatialSource,
  channel: 'pushZones' | 'pushWorkSurfaces',
  raw: unknown,
  requestedAt: number | undefined,
) {
  const result = { ok: true as const, raw };
  const options = snapshotOptions(source, requestedAt);
  if (options) source[channel](result, undefined, options);
  else source[channel](result);
}

/**
 * 구역·정적 객체(작업면·장애물) 응답 원문을 3D Source(관제는 실시간 Source, 세팅의 구역 단계는 그 화면의 Source)에
 * 넘긴다. 3D 를 보이는 동안 응답이 바뀔 때마다 넣고, 돌려주는 함수는 3D 가 준비됐을 때 둘 다 다시 넣는다. 받기 전·실패면
 * 넘기지 않아 구역·사람은 그대로 보인다(다시 받는다). 정적 객체는 모든 화면에서 이 틀이 한 곳에서 넣는다. 작업면 등록 화면은 넣지 않는다(같은 채널에 작업면만 담은 묶음을 넣으면
 * 장애물이 사라지고, 요청 시각 없는 응답과 섞이면 늦은 응답을 거르지 못한다).
 */
export function useSpatialSnapshots(
  source: ExternalSpatialSource | null,
  view: SpatialViewMode,
  zonesRaw: ViewerZones | undefined,
) {
  const { data: staticObjects } = useStaticObjectsQuery();
  const zonesRequestedAt = useRequestedAt(ZONES_KEY);
  const staticObjectsRequestedAt = useRequestedAt(STATIC_OBJECTS_KEY);

  const pushZones = useCallback(() => {
    if (source && zonesRaw) pushSnapshot(source, 'pushZones', zonesRaw, zonesRequestedAt());
  }, [source, zonesRaw, zonesRequestedAt]);

  const pushStaticObjects = useCallback(() => {
    if (source && staticObjects !== undefined) {
      pushSnapshot(source, 'pushWorkSurfaces', staticObjects, staticObjectsRequestedAt());
    }
  }, [source, staticObjects, staticObjectsRequestedAt]);

  useEffect(() => {
    if (view === '3d') pushZones();
  }, [view, pushZones]);

  useEffect(() => {
    if (view === '3d') pushStaticObjects();
  }, [view, pushStaticObjects]);

  return useCallback(() => {
    pushZones();
    pushStaticObjects();
  }, [pushZones, pushStaticObjects]);
}

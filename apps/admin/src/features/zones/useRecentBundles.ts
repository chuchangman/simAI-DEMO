import { BUNDLES_KEY, requestBundles } from '@/features/zones/api';
import { configBundleSchema, type ConfigBundle } from '@/features/zones/types';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

/** 발행 직후 이 시간(ms) 동안은 적용 대기의 적용 상태를 짧은 간격으로 다시 받는다. */
const PENDING_FAST_WINDOW_MS = 60_000;
/** 짧은 간격(ms). 서버는 Tier 0 의 config_ack 를 받으면 묶음 상태를 바꾼다. */
const PENDING_FAST_POLL_MS = 3_000;
/**
 * 그 뒤의 긴 간격(ms). 적용·거부는 /topic/health 의 config 가 바로 알려 주고(bindConfigCache 가 묶음을 다시 받는다),
 * Tier 0 가 꺼져 있으면 적용 대기가 끝없이 이어지기 때문이다. 긴 조회를 남기는 이유는 Tier 0 의 거부 알림이 서버의 상태 기록보다
 * 먼저 와 health 로 다시 받아도 아직 적용 대기일 수 있어서다.
 */
const PENDING_SLOW_POLL_MS = 60_000;

/**
 * 마지막 묶음의 다시 받기 간격(ms). 적용 대기가 아니면 받지 않는다. issued_at 은 서버 시각이라 이 브라우저 시계가 크게 틀리면
 * 짧은 간격이 길어지거나 짧아질 뿐이다.
 */
export function pendingPollMs(
  latest: Pick<ConfigBundle, 'status' | 'issued_at'> | undefined,
  now: number,
): number | false {
  if (latest?.status !== 'PENDING') return false;
  return now - latest.issued_at < PENDING_FAST_WINDOW_MS
    ? PENDING_FAST_POLL_MS
    : PENDING_SLOW_POLL_MS;
}

/** 받은 묶음 목록(새것부터)에서 형식이 맞는 것만 고른다. */
export function readBundles(items: readonly unknown[]): ConfigBundle[] {
  return items.flatMap((item) => {
    const parsed = configBundleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * 최근 구성 묶음(GET /api/config-bundles, 새것부터 20개). 마지막 묶음이 적용 대기면 다시 받는다(pendingPollMs). 구역 발행 상태·
 * PPE 요구 미수신·R9 해소 구분이 같은 캐시를 쓴다. enabled 가 false 면 받지 않고 캐시에 있는 것만 돌려준다.
 */
export function useRecentBundles(enabled = true) {
  return useQuery({
    queryKey: BUNDLES_KEY,
    queryFn: ({ signal }) => requestBundles(api, signal),
    select: readBundles,
    enabled,
    refetchInterval: (q) => pendingPollMs(readBundles(q.state.data ?? [])[0], Date.now()),
  });
}

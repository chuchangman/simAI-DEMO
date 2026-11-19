import type { FloorPlanData } from '@/features/plan/floorPlanData';

// 평면도를 다시 받는 시각 계산. 서명 주소는 5분짜리라 만료되기 전에 새로 받는다. 화면 없이 시험한다.

/** 서명 주소가 만료되기 이 시간(ms) 전에 새로 받는다. EC2 와 이 브라우저의 시계 차이를 넉넉히 본다. */
export const REFRESH_MARGIN_MS = 60_000;
/** 새로 받는 간격의 하한(ms). 만료 시각이 잘못 와도 요청이 몰리지 않게 한다. */
export const MIN_RELOAD_MS = 5_000;
/** 평면도를 새로 만드는 중이면 이 간격(ms)으로 확인한다. */
export const PENDING_RELOAD_MS = 10_000;
/** 평면도가 없거나 받지 못했을 때, 만료 시각을 모를 때 다시 시도하는 간격(ms). */
export const RETRY_MS = 15_000;

/** 서명 주소를 새로 받아야 할 때까지(ms). 만료 시각을 모르면 RETRY_MS. */
function untilRefresh(plan: FloorPlanData, now: number): number {
  const expiresAt = plan.image_url_expires_at_ms;
  return expiresAt == null ? RETRY_MS : expiresAt - now - REFRESH_MARGIN_MS;
}

/** 다음에 받을 때까지(ms). 받아 둔 평면도가 없으면 RETRY_MS. */
export function nextReloadMs(plan: FloorPlanData | undefined, now: number): number {
  if (!plan) return RETRY_MS;
  const wait = Math.max(MIN_RELOAD_MS, untilRefresh(plan, now));
  return plan.pending ? Math.min(wait, PENDING_RELOAD_MS) : wait;
}
